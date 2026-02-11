import { writeFile } from "node:fs/promises";
import {
    CONTEXT_PACK_REPORT_VERSION,
    type ContextPackCountSummary,
    type ContextPackReportError,
    type ContextPackReportPaths,
    type ContextPackReportStatus,
    type ContextPackReportV1,
    type ContextPackTokenSummary,
} from "./types.js";

export interface CreateContextPackReportInput {
    generatedAt: string;
    status: ContextPackReportStatus;
    projectDir: string;
    repoRoot: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string;
    budget: number;
    tokens: ContextPackTokenSummary;
    counts: ContextPackCountSummary;
    paths?: Partial<ContextPackReportPaths>;
    warnings?: string[];
    error?: ContextPackReportError;
}

export function createContextPackReportV1(input: CreateContextPackReportInput): ContextPackReportV1 {
    return {
        version: CONTEXT_PACK_REPORT_VERSION,
        generatedAt: input.generatedAt,
        status: input.status,
        projectDir: input.projectDir,
        repoRoot: input.repoRoot,
        baseRef: input.baseRef,
        baseCommit: input.baseCommit,
        headCommit: input.headCommit,
        budget: input.budget,
        tokens: input.tokens,
        counts: input.counts,
        paths: input.paths ?? {},
        warnings: input.warnings ?? [],
        error: input.error,
    };
}

export function isContextPackReportV1(value: unknown): value is ContextPackReportV1 {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const candidate = value as Partial<ContextPackReportV1>;

    return (
        candidate.version === CONTEXT_PACK_REPORT_VERSION &&
        typeof candidate.generatedAt === "string" &&
        typeof candidate.status === "string" &&
        typeof candidate.projectDir === "string" &&
        typeof candidate.repoRoot === "string" &&
        typeof candidate.baseRef === "string" &&
        typeof candidate.baseCommit === "string" &&
        typeof candidate.headCommit === "string" &&
        typeof candidate.budget === "number"
    );
}

export async function writeContextPackReport(reportPath: string, report: ContextPackReportV1): Promise<void> {
    const content = `${JSON.stringify(report, null, 4)}\n`;
    await writeFile(reportPath, content, "utf8");
}
