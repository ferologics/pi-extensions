import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { normalizeExcludePattern } from "./patterns.js";
import type { ContextPackConfigReport } from "./types.js";

interface DeepReviewConfigRepoEntry {
    exclude?: unknown;
}

interface DeepReviewConfigContextPack {
    exclude?: unknown;
    repos?: unknown;
}

export interface DeepReviewConfigFile {
    contextPack?: DeepReviewConfigContextPack;
}

const CONFIG_PATH = path.join(os.homedir(), ".pi", "deep-review.json");

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandHome(value: string): string {
    if (value === "~") {
        return os.homedir();
    }

    if (value.startsWith("~/")) {
        return path.join(os.homedir(), value.slice(2));
    }

    return value;
}

function normalizeAbsolutePath(value: string): string {
    return path.resolve(expandHome(value));
}

function parseStringArray(value: unknown, label: string): string[] {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(`${label} must be an array of strings`);
    }

    return value.map((entry) => normalizeExcludePattern(entry)).filter((entry) => entry.length > 0);
}

function parseConfigFile(raw: string, configPath: string): DeepReviewConfigFile {
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!isRecord(parsed)) {
            throw new Error("root must be an object");
        }

        return parsed as DeepReviewConfigFile;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid deep-review config at ${configPath}: ${message}`);
    }
}

function uniquePatterns(patterns: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const pattern of patterns) {
        if (seen.has(pattern)) {
            continue;
        }

        seen.add(pattern);
        result.push(pattern);
    }

    return result;
}

export function resolveContextPackConfig(
    config: DeepReviewConfigFile,
    repoRoot: string,
    configPath?: string,
): ContextPackConfigReport {
    const contextPack = config.contextPack;
    if (contextPack === undefined) {
        return { path: configPath, excludePatterns: [] };
    }

    if (!isRecord(contextPack)) {
        throw new Error("contextPack must be an object");
    }

    const globalExcludes = parseStringArray(contextPack.exclude, "contextPack.exclude");
    const normalizedRepoRoot = normalizeAbsolutePath(repoRoot);
    let matchedRepoPath: string | undefined;
    let repoExcludes: string[] = [];

    if (contextPack.repos !== undefined) {
        if (!isRecord(contextPack.repos)) {
            throw new Error("contextPack.repos must be an object keyed by absolute repo path");
        }

        for (const [repoPath, value] of Object.entries(contextPack.repos)) {
            if (normalizeAbsolutePath(repoPath) !== normalizedRepoRoot) {
                continue;
            }

            if (!isRecord(value)) {
                throw new Error(`contextPack.repos[${JSON.stringify(repoPath)}] must be an object`);
            }

            const repoEntry = value as DeepReviewConfigRepoEntry;
            matchedRepoPath = repoPath;
            repoExcludes = parseStringArray(
                repoEntry.exclude,
                `contextPack.repos[${JSON.stringify(repoPath)}].exclude`,
            );
            break;
        }
    }

    return {
        path: configPath,
        matchedRepoPath,
        excludePatterns: uniquePatterns([...globalExcludes, ...repoExcludes]),
    };
}

export async function loadContextPackConfig(repoRoot: string): Promise<ContextPackConfigReport> {
    let raw: string;

    try {
        raw = await readFile(CONFIG_PATH, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { excludePatterns: [] };
        }

        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read deep-review config at ${CONFIG_PATH}: ${message}`);
    }

    return resolveContextPackConfig(parseConfigFile(raw, CONFIG_PATH), repoRoot, CONFIG_PATH);
}
