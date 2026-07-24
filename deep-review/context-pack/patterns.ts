function normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").trim();
}

export function normalizeExcludePattern(pattern: string): string {
    const normalized = normalizePath(pattern);
    if (!normalized) {
        return "";
    }

    if (normalized.endsWith("/")) {
        return `${normalized}**`;
    }

    return normalized;
}

function escapeRegExp(value: string): string {
    return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function segmentPatternToRegExp(segment: string): RegExp {
    const source = [...segment]
        .map((character) => {
            if (character === "*") {
                return "[^/]*";
            }

            if (character === "?") {
                return "[^/]";
            }

            return escapeRegExp(character);
        })
        .join("");

    return new RegExp(`^${source}$`);
}

function matchSegments(pathSegments: string[], patternSegments: string[], pathIndex = 0, patternIndex = 0): boolean {
    if (patternIndex === patternSegments.length) {
        return pathIndex === pathSegments.length;
    }

    const patternSegment = patternSegments[patternIndex];

    if (patternSegment === "**") {
        if (patternIndex === patternSegments.length - 1) {
            return true;
        }

        for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex++) {
            if (matchSegments(pathSegments, patternSegments, nextPathIndex, patternIndex + 1)) {
                return true;
            }
        }

        return false;
    }

    if (pathIndex >= pathSegments.length) {
        return false;
    }

    return (
        segmentPatternToRegExp(patternSegment).test(pathSegments[pathIndex]) &&
        matchSegments(pathSegments, patternSegments, pathIndex + 1, patternIndex + 1)
    );
}

export function matchesExcludePattern(relativePath: string, pattern: string): boolean {
    const normalizedPath = normalizePath(relativePath);
    const normalizedPattern = normalizeExcludePattern(pattern);

    if (!normalizedPath || !normalizedPattern) {
        return false;
    }

    return matchSegments(normalizedPath.split("/"), normalizedPattern.split("/"));
}

export function matchesAnyExcludePattern(relativePath: string, patterns: string[]): boolean {
    return patterns.some((pattern) => matchesExcludePattern(relativePath, pattern));
}
