import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const execFileAsync = promisify(execFile);
const GHOSTTY_APPLESCRIPT = "Ghostty";
const HUNK_BINARY = "hunk";
const HUNK_COMMAND = `${HUNK_BINARY} diff`;

function buildAppleScript(workingDirectory: string, shellCommand: string): string {
    const workingDirectoryLiteral = JSON.stringify(workingDirectory);
    const shellCommandLiteral = JSON.stringify(`${shellCommand}\n`);

    return [
        `tell application ${JSON.stringify(GHOSTTY_APPLESCRIPT)}`,
        "    activate",
        "    set cfg to new surface configuration",
        `    set initial working directory of cfg to ${workingDirectoryLiteral}`,
        `    set initial input of cfg to ${shellCommandLiteral}`,
        "    new window with configuration cfg",
        "end tell",
    ].join("\n");
}

async function runAppleScript(script: string): Promise<void> {
    await execFileAsync("osascript", ["-e", script]);
}

async function runGit(ctx: ExtensionCommandContext, args: string[]): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync("git", args, {
            cwd: ctx.cwd,
            env: process.env,
        });
        const trimmed = stdout.trim();
        return trimmed.length > 0 ? trimmed : null;
    } catch {
        return null;
    }
}

async function getRepoRoot(ctx: ExtensionCommandContext): Promise<string | null> {
    return runGit(ctx, ["rev-parse", "--show-toplevel"]);
}

async function hasHunk(): Promise<boolean> {
    try {
        await execFileAsync("which", [HUNK_BINARY], {
            env: process.env,
        });
        return true;
    } catch {
        return false;
    }
}

function ensureGhosttyEnvironment(): string | null {
    if (process.platform !== "darwin") {
        return "pi-ghostty-hunk supports Ghostty AppleScript on macOS only.";
    }

    if (!process.env.GHOSTTY_RESOURCES_DIR && process.env.TERM_PROGRAM !== "ghostty") {
        return "pi-ghostty-hunk must be run from a Ghostty session.";
    }

    return null;
}

export default function piGhosttyHunkExtension(pi: ExtensionAPI): void {
    pi.registerCommand("hunk", {
        description: "Open Hunk in a new Ghostty window at the repo root",
        handler: async (_rawArgs, ctx) => {
            const ghosttyError = ensureGhosttyEnvironment();
            if (ghosttyError) {
                ctx.ui.notify(ghosttyError, "error");
                return;
            }

            if (!(await hasHunk())) {
                ctx.ui.notify("hunk is not available in PATH.", "error");
                return;
            }

            const repoRoot = await getRepoRoot(ctx);
            if (!repoRoot) {
                ctx.ui.notify("/hunk must be run inside a git repository.", "error");
                return;
            }

            try {
                await runAppleScript(buildAppleScript(repoRoot, HUNK_COMMAND));
                ctx.ui.notify("Opened Hunk in a new Ghostty window.", "info");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`Failed to open Ghostty window: ${message}`, "error");
            }
        },
    });
}
