import { describe, expect, it } from "vitest";
import { createContextPackReportV1, isContextPackReportV1 } from "./artifacts.js";
import { fitRelatedCandidatesToBudget, fitRelatedCandidatesWithCloseTestPreference } from "./budget.js";
import { evaluateChangedFile, evaluateRelatedFile } from "./filters.js";
import { rankRelatedCandidates } from "./rank.js";
import type { ContextPackOptions } from "./types.js";

describe("rankRelatedCandidates", () => {
    it("sorts by relationWeight, frequency, distance, estimatedTokens, then path", () => {
        const ranked = rankRelatedCandidates([
            {
                path: "z.ts",
                reason: "Dependency",
                distance: 2,
                frequency: 2,
                relationWeight: 70,
                estimatedTokens: 100,
            },
            {
                path: "a.ts",
                reason: "DirectDependency",
                distance: 2,
                frequency: 2,
                relationWeight: 90,
                estimatedTokens: 500,
            },
            {
                path: "b.ts",
                reason: "DirectDependency",
                distance: 1,
                frequency: 2,
                relationWeight: 90,
                estimatedTokens: 600,
            },
            {
                path: "c.ts",
                reason: "DirectDependency",
                distance: 1,
                frequency: 3,
                relationWeight: 90,
                estimatedTokens: 600,
            },
        ]);

        expect(ranked.map((candidate) => candidate.path)).toEqual(["c.ts", "b.ts", "a.ts", "z.ts"]);
        expect(ranked[0].rank).toBe(1);
        expect(ranked[3].rank).toBe(4);
    });
});

describe("filters", () => {
    const baseOptions: ContextPackOptions = {
        projectDir: "/repo",
        budget: 272000,
        outputName: "pr-context.txt",
        tmpOutput: true,
        includeDependents: true,
        includeDocs: false,
        includeTests: true,
        includeLockfiles: false,
        includeEnv: false,
        includeSecrets: false,
        diffContext: 3,
        includePrDescription: true,
        noClipboard: true,
        failOverBudget: false,
        debug: false,
    };

    it("filters env files by default", () => {
        const changed = evaluateChangedFile(".env", baseOptions);
        const related = evaluateRelatedFile(".env.local", baseOptions);

        expect(changed).toEqual({ include: false, reason: "filtered:env" });
        expect(related).toEqual({ include: false, reason: "filtered:env" });
    });

    it("filters docs for related files when includeDocs is false", () => {
        const related = evaluateRelatedFile("docs/guide.md", baseOptions);
        expect(related).toEqual({ include: false, reason: "filtered:docs" });
    });

    it("keeps changed files permissive for unknown extensions", () => {
        const changed = evaluateChangedFile("some/path/no-extension", baseOptions);
        expect(changed).toEqual({ include: true });
    });
});

describe("fitRelatedCandidatesToBudget", () => {
    it("includes candidates greedily while budget remains", () => {
        const result = fitRelatedCandidatesToBudget({
            budget: 100,
            baselineTokens: 40,
            candidates: [
                {
                    path: "one.ts",
                    reason: "DirectDependency",
                    distance: 1,
                    frequency: 3,
                    relationWeight: 90,
                    estimatedTokens: 10,
                    rank: 1,
                },
                {
                    path: "two.ts",
                    reason: "Dependency",
                    distance: 2,
                    frequency: 2,
                    relationWeight: 70,
                    estimatedTokens: 30,
                    rank: 2,
                },
                {
                    path: "three.ts",
                    reason: "Dependency",
                    distance: 3,
                    frequency: 1,
                    relationWeight: 50,
                    estimatedTokens: 25,
                    rank: 3,
                },
            ],
        });

        expect(result.included.map((candidate) => candidate.path)).toEqual(["one.ts", "two.ts"]);
        expect(result.omitted.map((entry) => entry.candidate.path)).toEqual(["three.ts"]);
        expect(result.finalTokensEstimate).toBe(80);
        expect(result.remainingBudgetEstimate).toBe(20);
    });
});

describe("fitRelatedCandidatesWithCloseTestPreference", () => {
    it("reserves budget for close tests so they are not starved by runtime files", () => {
        const result = fitRelatedCandidatesWithCloseTestPreference({
            budget: 100,
            baselineTokens: 40,
            candidates: [
                {
                    path: "src/runtime/core.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 9,
                    relationWeight: 90,
                    estimatedTokens: 35,
                    rank: 1,
                },
                {
                    path: "src/runtime/utils.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 8,
                    relationWeight: 90,
                    estimatedTokens: 25,
                    rank: 2,
                },
                {
                    path: "src/runtime/__tests__/core.test.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 8,
                    relationWeight: 90,
                    estimatedTokens: 20,
                    rank: 3,
                },
            ],
            isCloseTestCandidate: (candidate) => candidate.path.includes("__tests__/"),
            closeTestReserveRatio: 0.34,
            closeTestReserveMinTokens: 0,
        });

        expect(result.included.map((candidate) => candidate.path)).toEqual([
            "src/runtime/core.ts",
            "src/runtime/__tests__/core.test.ts",
        ]);
        expect(result.omitted.map((entry) => entry.candidate.path)).toEqual(["src/runtime/utils.ts"]);
        expect(result.finalTokensEstimate).toBe(95);
        expect(result.remainingBudgetEstimate).toBe(5);
    });

    it("returns unused reserve to non-test candidates in a second pass", () => {
        const result = fitRelatedCandidatesWithCloseTestPreference({
            budget: 100,
            baselineTokens: 40,
            candidates: [
                {
                    path: "src/runtime/core.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 9,
                    relationWeight: 90,
                    estimatedTokens: 30,
                    rank: 1,
                },
                {
                    path: "src/runtime/utils.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 8,
                    relationWeight: 90,
                    estimatedTokens: 20,
                    rank: 2,
                },
                {
                    path: "src/runtime/__tests__/core.test.ts",
                    reason: "Dependency",
                    distance: 1,
                    frequency: 8,
                    relationWeight: 90,
                    estimatedTokens: 5,
                    rank: 3,
                },
            ],
            isCloseTestCandidate: (candidate) => candidate.path.includes("__tests__/"),
            closeTestReserveRatio: 0.5,
            closeTestReserveMinTokens: 0,
        });

        expect(result.included.map((candidate) => candidate.path)).toEqual([
            "src/runtime/core.ts",
            "src/runtime/utils.ts",
            "src/runtime/__tests__/core.test.ts",
        ]);
        expect(result.omitted).toEqual([]);
        expect(result.finalTokensEstimate).toBe(95);
        expect(result.remainingBudgetEstimate).toBe(5);
    });
});

describe("context-pack report schema", () => {
    it("creates a v1 report and validates shape", () => {
        const report = createContextPackReportV1({
            generatedAt: "2026-02-11T00:00:00.000Z",
            status: "ok",
            projectDir: "/repo",
            repoRoot: "/repo",
            baseRef: "origin/main",
            baseCommit: "abc",
            headCommit: "def",
            budget: 272000,
            tokens: {
                baseline: 100,
                final: 120,
                remaining: 271880,
                encoding: "o200k-base",
            },
            counts: {
                changed: 1,
                relatedCandidates: 2,
                relatedIncluded: 1,
                relatedOmitted: 1,
                scribeTargets: 1,
                scribeFailedTargets: 0,
                scribeLimitSignals: 0,
            },
            warnings: [],
            paths: {
                pack: "/tmp/pr-context.txt",
            },
        });

        expect(isContextPackReportV1(report)).toBe(true);
    });
});
