import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { createContextPackReportV1, writeContextPackReport } from "./artifacts.js";
import { fitRelatedCandidatesWithCloseTestPreference } from "./budget.js";
import { evaluateChangedFile, evaluateRelatedFile } from "./filters.js";
import { collectGitSnapshot, resolveRepoContext } from "./git.js";
import { rankRelatedCandidates } from "./rank.js";
import { renderContextPackMarkdown, renderFileBlockMarkdown } from "./render.js";
import { runScribeRecall } from "./scribe.js";
import type {
    ContextPackBuildResult,
    ContextPackCountSummary,
    ContextPackOmissionReason,
    ContextPackOptions,
    ContextPackReportPaths,
    ContextPackReportV1,
    ContextPackTokenSummary,
    RankedRelatedCandidate,
    RelatedSelectionRow,
    ScribeTargetRow,
} from "./types.js";

export * from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 128 * 1024 * 1024;
const TOKEN_ENCODING = "o200k-base" as const;

const SCRIBE_TARGET_EXTENSIONS = new Set([".rs", ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".go"]);
const RELATED_TEST_CLOSE_SHARED_SEGMENTS = 4;
const RELATED_TEST_CLOSE_MAX_DISTANCE = 2;

type OmittedEntry = {
    path: string;
    reason: ContextPackOmissionReason;
};

type FileBlock = {
    path: string;
    content: string;
};

const RELATED_SELECTION_HEADER = "path\tfrequency\ttokens_estimate\tdecision\treason";
const SCRIBE_TARGETS_HEADER = "target\tstatus\ttotal_paths\teligible_paths\tlimits_reached\tmax_depth_reached\tnote";

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function toPathSegmentsLower(value: string): string[] {
    return normalizePath(value)
        .toLowerCase()
        .split("/")
        .filter((segment) => segment.length > 0);
}

function sharedPrefixLength(left: string[], right: string[]): number {
    const limit = Math.min(left.length, right.length);
    let index = 0;

    while (index < limit && left[index] === right[index]) {
        index += 1;
    }

    return index;
}

function maxSharedPrefixSegments(candidatePath: string, changedPathSegments: string[][]): number {
    const candidateSegments = toPathSegmentsLower(candidatePath);
    let maxShared = 0;

    for (const changedSegments of changedPathSegments) {
        const shared = sharedPrefixLength(candidateSegments, changedSegments);
        if (shared > maxShared) {
            maxShared = shared;
        }
    }

    return maxShared;
}

function pathBasename(value: string): string {
    const normalized = normalizePath(value);
    const slashIndex = normalized.lastIndexOf("/");
    return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function isRelatedTestPath(value: string): boolean {
    const normalized = normalizePath(value).toLowerCase();
    const segments = normalized.split("/");

    if (segments.includes("__tests__") || segments.includes("test") || segments.includes("tests")) {
        return true;
    }

    const base = pathBasename(normalized);
    return base.includes(".test.") || base.includes(".spec.") || base.includes("_test.") || base.startsWith("test_");
}

function isRelatedTestDataPath(value: string): boolean {
    const segments = toPathSegmentsLower(value);
    return segments.includes("test_data") || segments.includes("test-data") || segments.includes("testdata");
}

function isRelatedTestLikePath(value: string): boolean {
    return isRelatedTestPath(value) || isRelatedTestDataPath(value);
}

function isCloseRelatedTestCandidate(candidate: RankedRelatedCandidate, changedPathSegments: string[][]): boolean {
    if (candidate.distance <= RELATED_TEST_CLOSE_MAX_DISTANCE) {
        return true;
    }

    return maxSharedPrefixSegments(candidate.path, changedPathSegments) >= RELATED_TEST_CLOSE_SHARED_SEGMENTS;
}

function fileExtension(value: string): string {
    const normalized = normalizePath(value);
    const index = normalized.lastIndexOf(".");
    return index >= 0 ? normalized.slice(index).toLowerCase() : "";
}

function isScribeTargetCandidate(value: string): boolean {
    return SCRIBE_TARGET_EXTENSIONS.has(fileExtension(value));
}

function nowIso(): string {
    return new Date().toISOString();
}

function dateStampForPath(date = new Date()): string {
    const pad2 = (n: number) => String(n).padStart(2, "0");

    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        "-",
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
    ].join("");
}

function sanitizeRepoSlug(repoRoot: string): string {
    const raw = path.basename(repoRoot);
    const normalized = raw.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    return normalized.length > 0 ? normalized : "repo";
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function fileIsLikelyText(filePath: string): Promise<boolean> {
    try {
        const handle = await open(filePath, "r");
        try {
            const buffer = Buffer.alloc(8192);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);

            for (let index = 0; index < bytesRead; index++) {
                if (buffer[index] === 0) {
                    return false;
                }
            }

            return true;
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
}

async function commandExists(command: string): Promise<boolean> {
    try {
        await execFileAsync(command, ["--version"], {
            maxBuffer: 1024 * 1024,
        });
        return true;
    } catch {
        return false;
    }
}

async function countTokensForPath(filePath: string, includeExt: string): Promise<number> {
    let stdout: string;

    try {
        const response = await execFileAsync(
            "tokencount",
            ["--encoding", TOKEN_ENCODING, "--include-ext", includeExt, filePath],
            {
                maxBuffer: EXEC_MAX_BUFFER,
            },
        );

        stdout = response.stdout;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`tokencount failed for ${filePath}: ${message}`);
    }

    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
    const firstToken = firstLine.trim().split(/\s+/)[0] ?? "";
    const value = Number(firstToken);

    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Could not parse tokencount output for ${filePath}: ${stdout.trim()}`);
    }

    return Math.floor(value);
}

async function ensureTokencount(): Promise<void> {
    if (!(await commandExists("tokencount"))) {
        throw new Error("tokencount not found. Install with: cargo install tokencount");
    }
}

function outputBaseName(outputName: string): string {
    const ext = path.extname(outputName);
    const base = ext ? outputName.slice(0, -ext.length) : outputName;
    return base.length > 0 ? base : "pr-context";
}

function outputExtension(outputName: string): string {
    const ext = path.extname(outputName).replace(/^\./, "");
    return ext.length > 0 ? ext : "txt";
}

async function resolveOutputPaths(options: ContextPackOptions, repoRoot: string): Promise<ContextPackReportPaths> {
    const outputDir = options.tmpOutput
        ? path.join(os.tmpdir(), "context-packer", `pr-${sanitizeRepoSlug(repoRoot)}-${dateStampForPath()}`)
        : path.join(repoRoot, "prompt");

    await mkdir(outputDir, { recursive: true });

    const baseName = outputBaseName(options.outputName);
    const pack = path.join(outputDir, options.outputName);

    return {
        outputDir,
        pack,
        changedManifest: path.join(outputDir, `${baseName}.changed.files.txt`),
        relatedManifest: path.join(outputDir, `${baseName}.related.files.txt`),
        omittedManifest: path.join(outputDir, `${baseName}.omitted.files.txt`),
        relatedOmittedManifest: path.join(outputDir, `${baseName}.related.omitted.files.txt`),
        relatedSelectionManifest: path.join(outputDir, `${baseName}.related.selection.tsv`),
        scribeTargetsManifest: path.join(outputDir, `${baseName}.scribe.targets.tsv`),
        reportPath: path.join(outputDir, `${baseName}.report.json`),
    };
}

async function loadFileBlock(repoRoot: string, relativePath: string): Promise<FileBlock> {
    const absolutePath = path.join(repoRoot, relativePath);
    const content = await readFile(absolutePath, "utf8");
    return { path: relativePath, content };
}

function addOmittedReason(
    map: Map<string, ContextPackOmissionReason>,
    relativePath: string,
    reason: ContextPackOmissionReason,
): void {
    if (!map.has(relativePath)) {
        map.set(relativePath, reason);
    }
}

function parsePrDescriptionMarkdown(jsonText: string): string | undefined {
    try {
        const parsed = JSON.parse(jsonText) as {
            number?: number;
            title?: string;
            body?: string;
            url?: string;
            state?: string;
            baseRefName?: string;
            headRefName?: string;
            author?: { login?: string };
        };

        const lines = [
            "## PR Description",
            "",
            `- PR: #${parsed.number ?? ""}`,
            `- Title: ${parsed.title ?? ""}`,
            `- URL: ${parsed.url ?? ""}`,
            `- State: ${parsed.state ?? ""}`,
            `- Base: ${parsed.baseRefName ?? ""}`,
            `- Head: ${parsed.headRefName ?? ""}`,
            `- Author: ${parsed.author?.login ?? ""}`,
            "",
            "### Body",
            "",
            (parsed.body ?? "(no description)").trimEnd(),
            "",
            "---",
            "",
        ];

        return lines.join("\n");
    } catch {
        return undefined;
    }
}

async function maybeLoadPrDescriptionSection(
    repoRoot: string,
    prRef: string | undefined,
    includePrDescription: boolean,
): Promise<string | undefined> {
    if (!includePrDescription) {
        return undefined;
    }

    if (!(await commandExists("gh"))) {
        return undefined;
    }

    const args = [
        "pr",
        "view",
        ...(prRef ? [prRef] : []),
        "--json",
        "number,title,body,url,baseRefName,headRefName,state,author",
    ];

    try {
        const { stdout } = await execFileAsync("gh", args, {
            cwd: repoRoot,
            maxBuffer: EXEC_MAX_BUFFER,
        });

        return parsePrDescriptionMarkdown(stdout);
    } catch {
        return undefined;
    }
}

function buildHeaderLines(params: {
    generatedAt: string;
    repoRoot: string;
    projectDir: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string;
    budget: number;
    nameStatusText: string;
    diffText: string;
    scribeTargets: ScribeTargetRow[];
    prDescriptionSection?: string;
}): string[] {
    const lines: string[] = [];

    if (params.prDescriptionSection) {
        lines.push(...params.prDescriptionSection.split(/\r?\n/));
    }

    const queried = params.scribeTargets.filter((row) => row.status === "ok").length;
    const eligible = params.scribeTargets.length;

    lines.push(`- Generated: ${params.generatedAt}`);
    lines.push(`- Repo root: ${params.repoRoot}`);
    lines.push(`- Working dir: ${params.projectDir}`);
    lines.push(`- Base ref: ${params.baseRef}`);
    lines.push(`- Base commit: ${params.baseCommit}`);
    lines.push(`- Head commit: ${params.headCommit}`);
    lines.push(`- Scribe targets queried: ${queried}/${eligible}`);
    lines.push(`- Token budget: ${params.budget}`);
    lines.push("");

    lines.push("## Changed files (git name-status)");
    lines.push("");
    lines.push("```text");
    lines.push(params.nameStatusText.trimEnd());
    lines.push("```");
    lines.push("");

    lines.push(`## Git diff (${params.baseCommit}...${params.headCommit})`);
    lines.push("");
    lines.push("```diff");
    lines.push(params.diffText.trimEnd());
    lines.push("```");
    lines.push("");

    return lines;
}

function formatOmittedEntries(entries: OmittedEntry[]): string[] {
    if (entries.length === 0) {
        return [];
    }

    return entries
        .slice()
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => `${entry.path}\t${entry.reason}`);
}

function formatOmittedReasonMapLines(omittedReasons: Map<string, ContextPackOmissionReason>): string[] {
    return [...omittedReasons.entries()]
        .map(([entryPath, reason]) => ({ path: entryPath, reason }))
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => `${entry.path}\t${entry.reason}`);
}

function formatRelatedSelectionRows(selectionRows: RelatedSelectionRow[]): string[] {
    return [RELATED_SELECTION_HEADER].concat(
        selectionRows.map(
            (row) => `${row.path}\t${row.frequency}\t${row.tokensEstimate ?? "-"}\t${row.decision}\t${row.reason}`,
        ),
    );
}

function formatScribeTargetRows(scribeTargetRows: ScribeTargetRow[]): string[] {
    return [SCRIBE_TARGETS_HEADER].concat(
        scribeTargetRows.map(
            (row) =>
                `${row.target}\t${row.status}\t${row.totalPaths}\t${row.eligiblePaths}\t${row.limitsReached}\t${row.maxDepthReached ?? ""}\t${row.note ?? ""}`,
        ),
    );
}

function toSelectionRows(
    rankedCandidates: RankedRelatedCandidate[],
    includedSet: Set<string>,
    omittedReasons: Map<string, ContextPackOmissionReason>,
): RelatedSelectionRow[] {
    const rows: RelatedSelectionRow[] = rankedCandidates.map((candidate) => {
        const included = includedSet.has(candidate.path);

        return {
            path: candidate.path,
            frequency: candidate.frequency,
            tokensEstimate: candidate.estimatedTokens,
            decision: included ? "included" : "omitted",
            reason: included ? "within-budget" : (omittedReasons.get(candidate.path) ?? "over-budget"),
        };
    });

    const rankedSet = new Set(rankedCandidates.map((candidate) => candidate.path));

    for (const [omittedPath, reason] of omittedReasons.entries()) {
        if (rankedSet.has(omittedPath)) {
            continue;
        }

        rows.push({
            path: omittedPath,
            frequency: 0,
            tokensEstimate: undefined,
            decision: "omitted",
            reason,
        });
    }

    return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function writeLinesFile(filePath: string, lines: string[]): Promise<void> {
    const content = lines.length > 0 ? `${lines.join("\n")}\n` : "";
    await writeFile(filePath, content, "utf8");
}

async function writeContextPackManifests(params: {
    outputPaths: ContextPackReportPaths;
    changedIncluded: string[];
    includedRelated: string[];
    omittedChanged: OmittedEntry[];
    omittedRelatedReasons: Map<string, ContextPackOmissionReason>;
    selectionRows: RelatedSelectionRow[];
    scribeTargetRows: ScribeTargetRow[];
}): Promise<void> {
    await writeLinesFile(params.outputPaths.changedManifest, params.changedIncluded);
    await writeLinesFile(params.outputPaths.relatedManifest, params.includedRelated);
    await writeLinesFile(params.outputPaths.omittedManifest, formatOmittedEntries(params.omittedChanged));
    await writeLinesFile(
        params.outputPaths.relatedOmittedManifest,
        formatOmittedReasonMapLines(params.omittedRelatedReasons),
    );
    await writeLinesFile(params.outputPaths.relatedSelectionManifest, formatRelatedSelectionRows(params.selectionRows));
    await writeLinesFile(params.outputPaths.scribeTargetsManifest, formatScribeTargetRows(params.scribeTargetRows));
}

function buildCountSummary(params: {
    changed: number;
    relatedCandidates: number;
    relatedIncluded: number;
    relatedOmitted: number;
    scribeTargets: ScribeTargetRow[];
}): ContextPackCountSummary {
    return {
        changed: params.changed,
        relatedCandidates: params.relatedCandidates,
        relatedIncluded: params.relatedIncluded,
        relatedOmitted: params.relatedOmitted,
        scribeTargets: params.scribeTargets.length,
        scribeFailedTargets: params.scribeTargets.filter((row) => row.status === "failed").length,
        scribeLimitSignals: params.scribeTargets.filter((row) => row.limitsReached).length,
    };
}

function buildTokenSummary(baseline: number, final: number, budget: number): ContextPackTokenSummary {
    return {
        baseline,
        final,
        remaining: budget - final,
        encoding: TOKEN_ENCODING,
    };
}

async function estimateRelatedCandidateTokens(
    candidate: RankedRelatedCandidate,
    contentByPath: Map<string, string>,
    scratchPath: string,
): Promise<number> {
    const content = contentByPath.get(candidate.path);
    if (content === undefined) {
        return Number.MAX_SAFE_INTEGER;
    }

    const markdown = renderFileBlockMarkdown({ path: candidate.path, content });
    await writeFile(scratchPath, markdown, "utf8");
    return await countTokensForPath(scratchPath, "txt");
}

function reportForError(options: ContextPackOptions, message: string, details?: string): ContextPackReportV1 {
    return createContextPackReportV1({
        generatedAt: nowIso(),
        status: "error",
        projectDir: options.projectDir,
        repoRoot: options.projectDir,
        baseRef: options.baseRef ?? "",
        baseCommit: "",
        headCommit: "",
        budget: options.budget,
        tokens: buildTokenSummary(0, 0, options.budget),
        counts: {
            changed: 0,
            relatedCandidates: 0,
            relatedIncluded: 0,
            relatedOmitted: 0,
            scribeTargets: 0,
            scribeFailedTargets: 0,
            scribeLimitSignals: 0,
        },
        warnings: [],
        error: {
            code: "unknown",
            message,
            details,
        },
    });
}

export async function buildContextPack(options: ContextPackOptions): Promise<ContextPackBuildResult> {
    try {
        await ensureTokencount();

        const context = await resolveRepoContext(options);
        const snapshot = await collectGitSnapshot(context, options.diffContext);
        const outputPaths = await resolveOutputPaths(options, context.repoRoot);

        const changedIncluded: string[] = [];
        const omittedChanged: OmittedEntry[] = [];

        for (const changedFile of snapshot.changedFiles) {
            const relativePath = normalizePath(changedFile.path);
            const absolutePath = path.join(context.repoRoot, relativePath);

            if (!(await pathExists(absolutePath))) {
                omittedChanged.push({ path: relativePath, reason: "filtered:missing" });
                continue;
            }

            const decision = evaluateChangedFile(relativePath, options);
            if (!decision.include) {
                omittedChanged.push({ path: relativePath, reason: decision.reason ?? "filtered:unknown" });
                continue;
            }

            if (!(await fileIsLikelyText(absolutePath))) {
                omittedChanged.push({ path: relativePath, reason: "filtered:binary" });
                continue;
            }

            changedIncluded.push(relativePath);
        }

        if (changedIncluded.length === 0) {
            throw new Error("No eligible changed files after filtering");
        }

        const scribeTargets = changedIncluded
            .filter((relativePath) => isScribeTargetCandidate(relativePath))
            .map((target) => ({
                target,
                includeDependents: true,
            }));

        const recall = await runScribeRecall(context, scribeTargets, options);
        const relatedOmittedReasons = new Map<string, ContextPackOmissionReason>();
        const mergedCandidates = new Map<string, RankedRelatedCandidate>();
        const contentCache = new Map<string, string>();
        const warnings = [...recall.warnings];

        const changedSet = new Set(changedIncluded);

        for (const targetResult of recall.targets) {
            if (targetResult.row.limitsReached) {
                warnings.push(`Scribe limits reached for target: ${targetResult.row.target}`);
            }

            for (const candidate of targetResult.candidates) {
                const relativePath = normalizePath(candidate.path);

                if (changedSet.has(relativePath)) {
                    continue;
                }

                const decision = evaluateRelatedFile(relativePath, options);
                if (!decision.include) {
                    addOmittedReason(relatedOmittedReasons, relativePath, decision.reason ?? "filtered:unknown");
                    continue;
                }

                const absolutePath = path.join(context.repoRoot, relativePath);
                if (!(await pathExists(absolutePath))) {
                    addOmittedReason(relatedOmittedReasons, relativePath, "filtered:missing");
                    continue;
                }

                if (!(await fileIsLikelyText(absolutePath))) {
                    addOmittedReason(relatedOmittedReasons, relativePath, "filtered:binary");
                    continue;
                }

                if (!contentCache.has(relativePath)) {
                    contentCache.set(relativePath, await readFile(absolutePath, "utf8"));
                }

                const existing = mergedCandidates.get(relativePath);
                if (existing) {
                    existing.frequency += 1;
                    existing.distance = Math.min(existing.distance, candidate.distance);
                    existing.relationWeight = Math.max(existing.relationWeight, candidate.relationWeight);
                    continue;
                }

                mergedCandidates.set(relativePath, {
                    ...candidate,
                    path: relativePath,
                    rank: 0,
                });
            }
        }

        const changedPathSegments = changedIncluded.map((relativePath) => toPathSegmentsLower(relativePath));
        const eligibleCandidates: RankedRelatedCandidate[] = [];

        for (const candidate of mergedCandidates.values()) {
            if (isRelatedTestLikePath(candidate.path) && !isCloseRelatedTestCandidate(candidate, changedPathSegments)) {
                addOmittedReason(relatedOmittedReasons, candidate.path, "filtered:tests-not-close");
                continue;
            }

            eligibleCandidates.push(candidate);
        }

        let rankedCandidates = rankRelatedCandidates(eligibleCandidates);

        const scratchDir = await mkdtemp(path.join(os.tmpdir(), "deep-review-context-pack-"));
        const tokenScratchPath = path.join(scratchDir, "candidate-token-estimate.txt");

        const reEstimatedCandidates: RankedRelatedCandidate[] = [];
        for (const candidate of rankedCandidates) {
            const estimate = await estimateRelatedCandidateTokens(candidate, contentCache, tokenScratchPath);
            reEstimatedCandidates.push({
                ...candidate,
                estimatedTokens: estimate,
            });
        }

        rankedCandidates = rankRelatedCandidates(reEstimatedCandidates);

        const changedBlocks = await Promise.all(
            changedIncluded.map((relativePath) => loadFileBlock(context.repoRoot, relativePath)),
        );

        const prDescriptionSection = await maybeLoadPrDescriptionSection(
            context.repoRoot,
            options.prRef,
            options.includePrDescription,
        );

        if (options.includePrDescription && !prDescriptionSection) {
            warnings.push("PR description unavailable via gh (missing gh, auth, or matching PR)");
        }

        const headerLines = buildHeaderLines({
            generatedAt: nowIso(),
            repoRoot: context.repoRoot,
            projectDir: options.projectDir,
            baseRef: context.baseRef,
            baseCommit: context.baseCommit,
            headCommit: context.headCommit,
            budget: options.budget,
            nameStatusText: snapshot.nameStatusText,
            diffText: snapshot.diffText,
            scribeTargets: recall.targets.map((targetResult) => targetResult.row),
            prDescriptionSection,
        });

        const baselineMarkdown = renderContextPackMarkdown({
            headerLines,
            changedFiles: changedBlocks,
            relatedFiles: [],
            omittedChangedFiles: omittedChanged,
        });

        await writeFile(outputPaths.pack, `${baselineMarkdown}\n`, "utf8");

        const includeExt = outputExtension(options.outputName);
        const baselineTokens = await countTokensForPath(outputPaths.pack, includeExt);

        if (baselineTokens > options.budget) {
            const selectionRows = toSelectionRows(rankedCandidates, new Set<string>(), relatedOmittedReasons);

            await writeContextPackManifests({
                outputPaths,
                changedIncluded,
                includedRelated: [],
                omittedChanged,
                omittedRelatedReasons: relatedOmittedReasons,
                selectionRows,
                scribeTargetRows: recall.targets.map((targetResult) => targetResult.row),
            });

            const report = createContextPackReportV1({
                generatedAt: nowIso(),
                status: "core-over-budget",
                projectDir: context.projectDir,
                repoRoot: context.repoRoot,
                baseRef: context.baseRef,
                baseCommit: context.baseCommit,
                headCommit: context.headCommit,
                budget: options.budget,
                tokens: buildTokenSummary(baselineTokens, baselineTokens, options.budget),
                counts: buildCountSummary({
                    changed: changedIncluded.length,
                    relatedCandidates: rankedCandidates.length,
                    relatedIncluded: 0,
                    relatedOmitted: relatedOmittedReasons.size,
                    scribeTargets: recall.targets.map((targetResult) => targetResult.row),
                }),
                paths: outputPaths,
                warnings,
                error: {
                    code: "core-over-budget",
                    message: `Core context exceeds budget by ${baselineTokens - options.budget} tokens`,
                },
            });

            await writeContextPackReport(outputPaths.reportPath, report);

            return {
                ok: false,
                reason: "core-over-budget",
                report,
            };
        }

        const budgetFit = fitRelatedCandidatesWithCloseTestPreference({
            budget: options.budget,
            baselineTokens,
            candidates: rankedCandidates,
            isCloseTestCandidate: (candidate) => isRelatedTestLikePath(candidate.path),
        });

        const includedCandidates = [...budgetFit.included];
        for (const omitted of budgetFit.omitted) {
            addOmittedReason(relatedOmittedReasons, omitted.candidate.path, omitted.reason);
        }

        let finalMarkdown = baselineMarkdown;
        let finalTokens = baselineTokens;

        while (true) {
            const includedBlocks = includedCandidates
                .map((candidate) => {
                    const content = contentCache.get(candidate.path);
                    if (content === undefined) {
                        return undefined;
                    }
                    return { path: candidate.path, content };
                })
                .filter((value): value is FileBlock => value !== undefined);

            finalMarkdown = renderContextPackMarkdown({
                headerLines,
                changedFiles: changedBlocks,
                relatedFiles: includedBlocks,
                omittedChangedFiles: omittedChanged,
            });

            await writeFile(outputPaths.pack, `${finalMarkdown}\n`, "utf8");
            finalTokens = await countTokensForPath(outputPaths.pack, includeExt);

            if (finalTokens <= options.budget) {
                break;
            }

            const dropped = includedCandidates.pop();
            if (!dropped) {
                break;
            }

            addOmittedReason(relatedOmittedReasons, dropped.path, "over-budget");
        }

        const includedSet = new Set(includedCandidates.map((candidate) => candidate.path));
        const selectionRows = toSelectionRows(rankedCandidates, includedSet, relatedOmittedReasons);

        const scribeTargetRows = recall.targets.map((targetResult) => targetResult.row);

        await writeContextPackManifests({
            outputPaths,
            changedIncluded,
            includedRelated: includedCandidates.map((candidate) => candidate.path),
            omittedChanged,
            omittedRelatedReasons: relatedOmittedReasons,
            selectionRows,
            scribeTargetRows,
        });

        const report = createContextPackReportV1({
            generatedAt: nowIso(),
            status: "ok",
            projectDir: context.projectDir,
            repoRoot: context.repoRoot,
            baseRef: context.baseRef,
            baseCommit: context.baseCommit,
            headCommit: context.headCommit,
            budget: options.budget,
            tokens: buildTokenSummary(baselineTokens, finalTokens, options.budget),
            counts: buildCountSummary({
                changed: changedIncluded.length,
                relatedCandidates: rankedCandidates.length,
                relatedIncluded: includedCandidates.length,
                relatedOmitted: relatedOmittedReasons.size,
                scribeTargets: scribeTargetRows,
            }),
            paths: outputPaths,
            warnings,
        });

        await writeContextPackReport(outputPaths.reportPath, report);

        return {
            ok: true,
            packPath: outputPaths.pack,
            paths: outputPaths,
            report,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
            ok: false,
            reason: "error",
            report: reportForError(options, message),
        };
    }
}
