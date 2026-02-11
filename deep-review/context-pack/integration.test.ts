import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextPack, type ContextPackOptions } from "./index.js";

const execFileAsync = promisify(execFile);

async function run(cwd: string, command: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync(command, args, {
        cwd,
        maxBuffer: 32 * 1024 * 1024,
    });

    return stdout;
}

async function initTempGitRepo(): Promise<string> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "deep-review-pack-test-"));

    await run(tempRoot, "git", ["init", "-q"]);
    await run(tempRoot, "git", ["checkout", "-b", "main"]);

    return tempRoot;
}

async function commitAll(repoDir: string, message: string): Promise<void> {
    await run(repoDir, "git", ["add", "."]);
    await run(repoDir, "git", ["-c", "user.name=Pi Test", "-c", "user.email=pi@test", "commit", "-q", "-m", message]);
}

function baseOptions(projectDir: string, budget: number): ContextPackOptions {
    return {
        projectDir,
        budget,
        outputName: "pr-context.txt",
        tmpOutput: true,
        includeDependents: true,
        includeDocs: false,
        includeTests: true,
        includeLockfiles: false,
        includeEnv: false,
        includeSecrets: false,
        diffContext: 3,
        includePrDescription: false,
        noClipboard: true,
        failOverBudget: false,
        debug: false,
    };
}

const cleanupPaths: string[] = [];

afterEach(async () => {
    while (cleanupPaths.length > 0) {
        const target = cleanupPaths.pop();
        if (!target) {
            continue;
        }

        await rm(target, { recursive: true, force: true });
    }
});

describe("buildContextPack integration", () => {
    it("builds a context pack from git diff using TS engine", async () => {
        const repoDir = await initTempGitRepo();
        cleanupPaths.push(repoDir);

        await writeFile(path.join(repoDir, "notes.md"), "hello\n", "utf8");
        await commitAll(repoDir, "initial");

        await run(repoDir, "git", ["checkout", "-b", "feature/test-pack"]);
        await writeFile(path.join(repoDir, "notes.md"), "hello\nworld\n", "utf8");
        await commitAll(repoDir, "feature change");

        const result = await buildContextPack(baseOptions(repoDir, 100000));

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }

        const packText = await readFile(result.packPath, "utf8");

        expect(packText).toContain("# PR Context Pack");
        expect(packText).toContain("notes.md");
        expect(result.report.counts.changed).toBe(1);
        expect(result.report.counts.scribeTargets).toBe(0);
        expect(result.report.status).toBe("ok");
    });

    it("returns core-over-budget when baseline exceeds budget", async () => {
        const repoDir = await initTempGitRepo();
        cleanupPaths.push(repoDir);

        await writeFile(path.join(repoDir, "notes.md"), "A\n", "utf8");
        await commitAll(repoDir, "initial");

        await run(repoDir, "git", ["checkout", "-b", "feature/test-over-budget"]);

        const longBody = `${"x".repeat(2000)}\n${"y".repeat(2000)}\n`;
        await writeFile(path.join(repoDir, "notes.md"), longBody, "utf8");
        await commitAll(repoDir, "large change");

        const result = await buildContextPack(baseOptions(repoDir, 100));

        expect(result.ok).toBe(false);
        if (result.ok) {
            return;
        }

        expect(result.reason).toBe("core-over-budget");
        expect(result.report.status).toBe("core-over-budget");
        expect(result.report.error?.code).toBe("core-over-budget");
    });
});
