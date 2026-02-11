import type { BudgetFitInput, BudgetFitResult, RankedRelatedCandidate } from "./types.js";

const DEFAULT_CLOSE_TEST_RESERVE_RATIO = 0.25;
const DEFAULT_CLOSE_TEST_RESERVE_MIN_TOKENS = 4096;

interface PartialFitResult {
    included: RankedRelatedCandidate[];
    omitted: RankedRelatedCandidate[];
    remainingBudget: number;
    usedTokenEstimate: number;
}

export interface CloseTestPreferenceBudgetFitInput extends BudgetFitInput {
    isCloseTestCandidate: (candidate: RankedRelatedCandidate) => boolean;
    closeTestReserveRatio?: number;
    closeTestReserveMinTokens?: number;
}

function candidateTokenEstimate(candidate: RankedRelatedCandidate): number {
    return candidate.estimatedTokens ?? Number.MAX_SAFE_INTEGER;
}

function sortByRankThenPath(candidates: RankedRelatedCandidate[]): RankedRelatedCandidate[] {
    return candidates.slice().sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path));
}

function fitCandidatesWithinRemainingBudget(
    remainingBudget: number,
    candidates: RankedRelatedCandidate[],
): PartialFitResult {
    let remaining = Math.max(0, remainingBudget);
    let usedTokenEstimate = 0;

    const included: RankedRelatedCandidate[] = [];
    const omitted: RankedRelatedCandidate[] = [];

    for (const candidate of candidates) {
        const tokenEstimate = candidateTokenEstimate(candidate);

        if (tokenEstimate <= remaining) {
            included.push(candidate);
            remaining -= tokenEstimate;
            usedTokenEstimate += tokenEstimate;
            continue;
        }

        omitted.push(candidate);
    }

    return {
        included,
        omitted,
        remainingBudget: remaining,
        usedTokenEstimate,
    };
}

function computeCloseTestReserve(
    relatedBudget: number,
    hasCloseTests: boolean,
    reserveRatio: number,
    reserveMinTokens: number,
): number {
    if (!hasCloseTests || relatedBudget <= 0) {
        return 0;
    }

    const clampedRatio = Math.min(1, Math.max(0, reserveRatio));
    const ratioReserve = Math.floor(relatedBudget * clampedRatio);
    const minReserve = Math.min(relatedBudget, Math.max(0, reserveMinTokens));

    return Math.min(relatedBudget, Math.max(minReserve, ratioReserve));
}

export function fitRelatedCandidatesWithCloseTestPreference(input: CloseTestPreferenceBudgetFitInput): BudgetFitResult {
    const relatedBudget = Math.max(0, input.budget - input.baselineTokens);

    const closeTests = sortByRankThenPath(
        input.candidates.filter((candidate) => input.isCloseTestCandidate(candidate)),
    );
    const nonTests = sortByRankThenPath(input.candidates.filter((candidate) => !input.isCloseTestCandidate(candidate)));

    const closeReserve = computeCloseTestReserve(
        relatedBudget,
        closeTests.length > 0,
        input.closeTestReserveRatio ?? DEFAULT_CLOSE_TEST_RESERVE_RATIO,
        input.closeTestReserveMinTokens ?? DEFAULT_CLOSE_TEST_RESERVE_MIN_TOKENS,
    );

    const nonTestFirstPassBudget = Math.max(0, relatedBudget - closeReserve);
    const nonTestFirstPass = fitCandidatesWithinRemainingBudget(nonTestFirstPassBudget, nonTests);

    const remainingAfterNonTests = Math.max(0, relatedBudget - nonTestFirstPass.usedTokenEstimate);
    const closeTestPass = fitCandidatesWithinRemainingBudget(remainingAfterNonTests, closeTests);
    const nonTestSecondPass = fitCandidatesWithinRemainingBudget(
        closeTestPass.remainingBudget,
        nonTestFirstPass.omitted,
    );

    const included = sortByRankThenPath([
        ...nonTestFirstPass.included,
        ...closeTestPass.included,
        ...nonTestSecondPass.included,
    ]);

    const omitted = sortByRankThenPath([...closeTestPass.omitted, ...nonTestSecondPass.omitted]).map((candidate) => ({
        candidate,
        reason: "over-budget" as const,
    }));

    const includedTokenEstimate = included.reduce((sum, candidate) => {
        const estimate = candidateTokenEstimate(candidate);
        return sum + estimate;
    }, 0);

    const finalTokensEstimate = input.baselineTokens + includedTokenEstimate;

    return {
        included,
        omitted,
        finalTokensEstimate,
        remainingBudgetEstimate: Math.max(0, input.budget - finalTokensEstimate),
    };
}

export function fitRelatedCandidatesToBudget(input: BudgetFitInput): BudgetFitResult {
    const relatedBudget = Math.max(0, input.budget - input.baselineTokens);
    const fit = fitCandidatesWithinRemainingBudget(relatedBudget, input.candidates);

    return {
        included: fit.included,
        omitted: fit.omitted.map((candidate) => ({ candidate, reason: "over-budget" })),
        finalTokensEstimate: input.baselineTokens + fit.usedTokenEstimate,
        remainingBudgetEstimate: fit.remainingBudget,
    };
}
