import type { RankedRelatedCandidate, RelatedCandidate } from "./types.js";

function compareCandidates(left: RelatedCandidate, right: RelatedCandidate): number {
    if (left.relationWeight !== right.relationWeight) {
        return right.relationWeight - left.relationWeight;
    }

    if (left.frequency !== right.frequency) {
        return right.frequency - left.frequency;
    }

    if (left.distance !== right.distance) {
        return left.distance - right.distance;
    }

    const leftEstimatedTokens = left.estimatedTokens ?? Number.MAX_SAFE_INTEGER;
    const rightEstimatedTokens = right.estimatedTokens ?? Number.MAX_SAFE_INTEGER;

    if (leftEstimatedTokens !== rightEstimatedTokens) {
        return leftEstimatedTokens - rightEstimatedTokens;
    }

    return left.path.localeCompare(right.path);
}

export function rankRelatedCandidates(candidates: RelatedCandidate[]): RankedRelatedCandidate[] {
    const sorted = [...candidates].sort(compareCandidates);

    return sorted.map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
    }));
}
