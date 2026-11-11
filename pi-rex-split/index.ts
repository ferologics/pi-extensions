// /hunk and /lg in Rex: open Hunk or lazygit at the repo root in a pane to the right of this Pi, or focus the one this
// tab already has. Calls the `rex` CLI of the server this Pi runs under, never starting one: a server started from
// here would hand this process's environment to every terminal in it.

import { execFile } from "node:child_process";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const run = promisify(execFile);

const TOOLS = [
    { command: "hunk", name: "Hunk", label: "hunk", argv: ["hunk", "diff"] },
    { command: "lg", name: "lazygit", label: "lazygit", argv: ["lazygit"] },
];

interface Block {
    block_id: string;
    label: string;
    window_id?: string;
}

async function rex(...args: string[]): Promise<string> {
    const { stdout } = await run(join(process.env.REX_BIN_DIR!, "rex"), ["--autostart=false", ...args], {
        timeout: 5000,
    });
    return stdout;
}

/**
 * The pane with this label in this Pi's tab, while it still runs its tool. A server restart brings the pane back as a
 * plain shell; that one is closed, so the tool opens fresh.
 */
async function openPane(label: string): Promise<string | undefined> {
    const { blocks } = JSON.parse(await rex("block", "ls", "--json")) as { blocks: Block[] | null };
    const tab = blocks?.find((block) => block.block_id === process.env.REX_BLOCK)?.window_id;
    const pane = blocks?.find((block) => block.window_id === tab && block.label === label);
    if (!pane) return undefined;
    const running = JSON.parse(await rex("block", "call", "-b", pane.block_id, "process")) as {
        foreground?: { name?: string };
    };
    if (running.foreground?.name !== basename(process.env.SHELL ?? "")) return pane.block_id;
    await rex("block", "close", pane.block_id);
    return undefined;
}

export default function piRexSplit(pi: ExtensionAPI): void {
    for (const tool of TOOLS) {
        pi.registerCommand(tool.command, {
            description: `Open ${tool.name} at the repo root in a Rex pane to the right`,
            handler: async (_args, ctx) => {
                const block = process.env.REX_BLOCK;
                if (process.env.TERM_PROGRAM !== "rex" || !block || !process.env.REX_BIN_DIR) {
                    ctx.ui.notify(`/${tool.command} needs Rex.`, "error");
                    return;
                }
                let root: string;
                try {
                    root = (await run("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd })).stdout.trim();
                } catch {
                    ctx.ui.notify(`/${tool.command} must be run inside a git repository.`, "error");
                    return;
                }
                try {
                    const pane = await openPane(tool.label);
                    if (pane) await rex("focus", pane);
                    else
                        await rex(
                            "split",
                            "-b",
                            block,
                            "--split=right",
                            "--label",
                            tool.label,
                            "-c",
                            root,
                            "--",
                            ...tool.argv,
                        );
                } catch (error) {
                    ctx.ui.notify(
                        `Couldn't open ${tool.name}: ${error instanceof Error ? error.message : error}`,
                        "error",
                    );
                }
            },
        });
    }
}
