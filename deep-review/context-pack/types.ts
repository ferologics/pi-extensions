export const CONTEXT_PACK_REPORT_VERSION = 1 as const;

export type ContextPackReportVersion = typeof CONTEXT_PACK_REPORT_VERSION;

export type ContextPackReportStatus = "ok" | "core-over-budget" | "error";

export type ContextPackOmissionReason =
    | "filtered:lockfile"
    | "filtered:env"
    | "filtered:secret"
    | "filtered:binary"
    | "filtered:docs"
    | "filtered:tests"
    | "filtered:tests-not-close"
    | "filtered:generated-cache"
    | "filtered:missing"
    | "filtered:unknown"
    | "over-budget"
    | "scribe-target-failed"
    | "scribe-limits-reached";

export type ScribeTargetStatus = "ok" | "failed" | "skipped";

export interface ContextPackOptions {
    projectDir: string;
    baseRef?: string;
    budget: number;
    outputName: string;
    tmpOutput: boolean;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
    includeLockfiles: boolean;
    includeEnv: boolean;
    includeSecrets: boolean;
    diffContext: number;
    includePrDescription: boolean;
    prRef?: string;
    noClipboard: boolean;
    failOverBudget: boolean;
    debug: boolean;
}

export interface ContextPackRepoContext {
    projectDir: string;
    repoRoot: string;
    baseRef: string;
    baseCommit: string;
    headCommit: string;
}

export interface ChangedFileRecord {
    path: string;
    status: string;
}

export interface ContextPackGitSnapshot {
    changedFiles: ChangedFileRecord[];
    nameStatusText: string;
    diffText: string;
}

export interface RelatedCandidate {
    path: string;
    reason: string;
    distance: number;
    frequency: number;
    relationWeight: number;
    estimatedTokens?: number;
}

export interface RankedRelatedCandidate extends RelatedCandidate {
    rank: number;
}

export interface RelatedSelectionRow {
    path: string;
    frequency: number;
    tokensEstimate?: number;
    decision: "included" | "omitted";
    reason: ContextPackOmissionReason | "within-budget";
}

export interface ScribeTargetRow {
    target: string;
    status: ScribeTargetStatus;
    totalPaths: number;
    eligiblePaths: number;
    limitsReached: boolean;
    maxDepthReached?: number;
    note?: string;
}

export interface ContextPackTokenSummary {
    baseline: number;
    final: number;
    remaining: number;
    encoding: "o200k-base";
}

export interface ContextPackCountSummary {
    changed: number;
    relatedCandidates: number;
    relatedIncluded: number;
    relatedOmitted: number;
    scribeTargets: number;
    scribeFailedTargets: number;
    scribeLimitSignals: number;
}

export interface ContextPackReportPaths {
    outputDir: string;
    pack: string;
    changedManifest: string;
    relatedManifest: string;
    omittedManifest: string;
    relatedOmittedManifest: string;
    relatedSelectionManifest: string;
    scribeTargetsManifest: string;
    reportPath: string;
}

export interface ContextPackReportError {
    code: "core-over-budget" | "scribe-failure" | "git-error" | "token-error" | "unknown";
    message: string;
    details?: string;
}

export interface ContextPackReportV1 {
    version: ContextPackReportVersion;
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
    paths: Partial<ContextPackReportPaths>;
    warnings: string[];
    error?: ContextPackReportError;
}

export interface ContextPackBuildSuccess {
    ok: true;
    packPath: string;
    paths: ContextPackReportPaths;
    report: ContextPackReportV1;
}

export interface ContextPackBuildFailure {
    ok: false;
    reason: "core-over-budget" | "error";
    report: ContextPackReportV1;
}

export type ContextPackBuildResult = ContextPackBuildSuccess | ContextPackBuildFailure;

export interface ScribeTargetRequest {
    target: string;
    includeDependents: boolean;
}

export interface ScribeTargetResult {
    row: ScribeTargetRow;
    candidates: RelatedCandidate[];
    omitted: Array<{ path: string; reason: ContextPackOmissionReason }>;
}

export interface ScribeRecallResult {
    targets: ScribeTargetResult[];
    warnings: string[];
}

export interface BudgetFitInput {
    budget: number;
    baselineTokens: number;
    candidates: RankedRelatedCandidate[];
}

export interface BudgetFitResult {
    included: RankedRelatedCandidate[];
    omitted: Array<{ candidate: RankedRelatedCandidate; reason: ContextPackOmissionReason }>;
    finalTokensEstimate: number;
    remainingBudgetEstimate: number;
}
