import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangedFileRecord, ContextPackGitSnapshot, ContextPackOptions, ContextPackRepoContext } from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

async function runGit(cwd: string, args: string[]): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
            maxBuffer: EXEC_MAX_BUFFER,
        });
        return stdout;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${message}`);
    }
}

async function verifyRef(cwd: string, ref: string): Promise<boolean> {
    try {
        await runGit(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
        return true;
    } catch {
        return false;
    }
}

function parseNameStatus(raw: string): ChangedFileRecord[] {
    const map = new Map<string, string>();

    for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) {
            continue;
        }

        const parts = line.split("\t");
        if (parts.length < 2) {
            continue;
        }

        const status = parts[0].trim();
        let filePath = parts[1].trim();

        if ((status.startsWith("R") || status.startsWith("C")) && parts[2]) {
            filePath = parts[2].trim();
        }

        if (!filePath) {
            continue;
        }

        map.set(filePath, status);
    }

    return [...map.entries()]
        .map(([path, status]) => ({ path, status }))
        .sort((left, right) => left.path.localeCompare(right.path));
}

export async function resolveRepoContext(options: ContextPackOptions): Promise<ContextPackRepoContext> {
    const insideWorkTree = (await runGit(options.projectDir, ["rev-parse", "--is-inside-work-tree"]))
        .trim()
        .toLowerCase();

    if (insideWorkTree !== "true") {
        throw new Error(`Not a git repository: ${options.projectDir}`);
    }

    const repoRoot = (await runGit(options.projectDir, ["rev-parse", "--show-toplevel"])).trim().replace(/\r?\n+$/, "");

    let baseRef = options.baseRef?.trim();

    if (baseRef) {
        if (!(await verifyRef(repoRoot, baseRef))) {
            throw new Error(`Base ref not found: ${baseRef}`);
        }
    } else {
        const candidates = ["origin/main", "origin/master", "main", "master", "HEAD~1"];
        baseRef = "";

        for (const candidate of candidates) {
            if (await verifyRef(repoRoot, candidate)) {
                baseRef = candidate;
                break;
            }
        }

        if (!baseRef) {
            throw new Error("Could not auto-detect base ref (origin/main, origin/master, main, master, HEAD~1)");
        }
    }

    const baseCommit = (await runGit(repoRoot, ["merge-base", "HEAD", baseRef])).trim();
    const headCommit = (await runGit(repoRoot, ["rev-parse", "HEAD"])).trim();

    return {
        projectDir: options.projectDir,
        repoRoot,
        baseRef,
        baseCommit,
        headCommit,
    };
}

export async function collectGitSnapshot(
    context: ContextPackRepoContext,
    diffContext = 3,
): Promise<ContextPackGitSnapshot> {
    const range = `${context.baseCommit}...HEAD`;

    const changedRaw = await runGit(context.repoRoot, ["diff", "--name-only", "--diff-filter=ACMR", range]);

    if (!changedRaw.trim()) {
        throw new Error(`No changed files found between ${context.baseRef} and HEAD`);
    }

    const nameStatusText = await runGit(context.repoRoot, ["diff", "--name-status", range]);
    const diffText = await runGit(context.repoRoot, ["diff", "--no-color", `--unified=${diffContext}`, range]);
    const changedFiles = parseNameStatus(nameStatusText);

    if (changedFiles.length === 0) {
        throw new Error(`No parseable changed files found between ${context.baseRef} and HEAD`);
    }

    return {
        changedFiles,
        nameStatusText,
        diffText,
    };
}
