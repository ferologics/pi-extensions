import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
    ContextPackOptions,
    ContextPackRepoContext,
    RelatedCandidate,
    ScribeRecallResult,
    ScribeTargetRequest,
    ScribeTargetResult,
} from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 256 * 1024 * 1024;
const MODERN_SCRIBE_PACKAGE = "@sibyllinesoft/scribe@1.0.4";

type ScribeCommand = {
    command: "npx";
    baseArgs: string[];
};

function decodeXml(value: string): string {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
}

function extractTagValue(xml: string, tag: string): string | undefined {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = xml.match(regex);
    if (!match) {
        return undefined;
    }

    return decodeXml(match[1]);
}

function relationWeightForReason(reason: string): number {
    switch (reason) {
        case "TargetFile":
            return 100;
        case "DirectDependency":
        case "DirectDependent":
            return 90;
        case "Dependency":
        case "Dependent":
            return 70;
        default:
            return 50;
    }
}

function toRepoRelativePath(absPath: string, repoRoot: string): string | undefined {
    const normalizedRepo = repoRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedAbs = absPath.replace(/\\/g, "/");

    if (!normalizedAbs.startsWith(`${normalizedRepo}/`)) {
        return undefined;
    }

    return normalizedAbs.slice(normalizedRepo.length + 1);
}

function parseScribeXml(target: string, xml: string, repoRoot: string): ScribeTargetResult {
    const fileBlocks = [...xml.matchAll(/<file>([\s\S]*?)<\/file>/g)];

    const candidates: RelatedCandidate[] = [];

    for (const match of fileBlocks) {
        const block = match[1];
        const absPath = extractTagValue(block, "path");

        if (!absPath) {
            continue;
        }

        const repoRelativePath = toRepoRelativePath(absPath, repoRoot);
        if (!repoRelativePath) {
            continue;
        }

        if (repoRelativePath === target) {
            continue;
        }

        const reason = extractTagValue(block, "reason") ?? "Unknown";
        const distanceRaw = extractTagValue(block, "distance") ?? "0";
        const distanceNumber = Number(distanceRaw);

        candidates.push({
            path: repoRelativePath,
            reason,
            distance: Number.isFinite(distanceNumber) ? Math.max(0, distanceNumber) : 0,
            frequency: 1,
            relationWeight: relationWeightForReason(reason),
        });
    }

    const limitsRaw = extractTagValue(xml, "limits_reached") ?? "false";
    const maxDepthRaw = extractTagValue(xml, "max_depth_reached");
    const maxDepthParsed = maxDepthRaw !== undefined ? Number(maxDepthRaw) : undefined;

    return {
        row: {
            target,
            status: "ok",
            totalPaths: fileBlocks.length,
            eligiblePaths: candidates.length,
            limitsReached: limitsRaw.toLowerCase() === "true",
            maxDepthReached: Number.isFinite(maxDepthParsed) ? maxDepthParsed : undefined,
            note: undefined,
        },
        candidates,
        omitted: [],
    };
}

function summarizeScribeError(raw: string): string {
    const normalized = raw.replace(/\r/g, "\n");
    const lines = normalized
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const errorLine = lines.find((line) => line.toLowerCase().startsWith("error:"));
    if (errorLine) {
        return errorLine;
    }

    return lines[0] ?? "unknown scribe error";
}

async function commandExists(command: string): Promise<boolean> {
    try {
        await execFileAsync(command, ["--version"], { maxBuffer: 1024 * 1024 });
        return true;
    } catch {
        return false;
    }
}

async function runCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
        const { stdout, stderr } = await execFileAsync(command, args, {
            maxBuffer: EXEC_MAX_BUFFER,
        });
        return { stdout, stderr };
    } catch (error) {
        const execError = error as Error & { stdout?: string; stderr?: string };
        throw new Error((execError.stderr || execError.stdout || execError.message || "").trim());
    }
}

async function readHelp(candidate: ScribeCommand): Promise<string | undefined> {
    try {
        const { stdout, stderr } = await runCommand(candidate.command, [...candidate.baseArgs, "--help"]);
        return `${stdout}\n${stderr}`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return message;
    }
}

function isModernHelp(helpText: string): boolean {
    return helpText.includes("--covering-set") && helpText.includes("--granularity") && helpText.includes("--stdout");
}

async function resolveScribeCommand(): Promise<ScribeCommand | null> {
    if (!(await commandExists("npx"))) {
        return null;
    }

    const candidate: ScribeCommand = {
        command: "npx",
        baseArgs: ["-y", MODERN_SCRIBE_PACKAGE],
    };

    const helpText = (await readHelp(candidate)) ?? "";
    if (!isModernHelp(helpText)) {
        return null;
    }

    return candidate;
}

async function runScribeCommand(command: ScribeCommand, args: string[]): Promise<string> {
    const { stdout } = await runCommand(command.command, [...command.baseArgs, ...args]);
    return stdout;
}

function skippedResults(targets: ScribeTargetRequest[], note: string): ScribeTargetResult[] {
    return targets.map((targetRequest) => ({
        row: {
            target: targetRequest.target,
            status: "skipped",
            totalPaths: 0,
            eligiblePaths: 0,
            limitsReached: false,
            note,
        },
        candidates: [],
        omitted: [],
    }));
}

export async function runScribeRecall(
    context: ContextPackRepoContext,
    targets: ScribeTargetRequest[],
    options: ContextPackOptions,
): Promise<ScribeRecallResult> {
    if (targets.length === 0) {
        return {
            targets: [],
            warnings: [],
        };
    }

    const command = await resolveScribeCommand();

    if (!command) {
        return {
            targets: skippedResults(targets, "scribe-modern-unavailable"),
            warnings: [
                `Modern scribe is unavailable. Install/use ${MODERN_SCRIBE_PACKAGE} via npx; skipping related expansion.`,
            ],
        };
    }

    const results: ScribeTargetResult[] = [];
    const warnings: string[] = [];

    for (const targetRequest of targets) {
        const args = [context.repoRoot, "--covering-set", targetRequest.target, "--granularity", "file", "--stdout"];

        if (options.includeDependents && targetRequest.includeDependents) {
            args.push("--include-dependents");
        }

        try {
            const output = await runScribeCommand(command, args);
            results.push(parseScribeXml(targetRequest.target, output, context.repoRoot));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            warnings.push(`Scribe query failed for target ${targetRequest.target}: ${summarizeScribeError(message)}`);
            results.push({
                row: {
                    target: targetRequest.target,
                    status: "failed",
                    totalPaths: 0,
                    eligiblePaths: 0,
                    limitsReached: false,
                    note: "scribe-error",
                },
                candidates: [],
                omitted: [],
            });
        }
    }

    return {
        targets: results,
        warnings,
    };
}
