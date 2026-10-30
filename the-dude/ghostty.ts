// The window layer: Ghostty on macOS through its AppleScript API. Everything here returns undefined
// elsewhere, so other terminals and platforms can slot in behind the same functions.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GhosttyWindow {
    id: string;
    /** Terminal ids per tab, in tab order. A tab has more than one when it is split. */
    tabs: string[][];
}

export function inGhostty(): boolean {
    return process.platform === "darwin" && process.env.TERM_PROGRAM === "ghostty";
}

async function jxa(script: string, ...args: string[]): Promise<string> {
    const { stdout } = await run("osascript", ["-l", "JavaScript", "-e", script, ...args], { timeout: 5000 });
    return stdout.trim();
}

/** This process's terminal: Ghostty's `id` is the surface UUID it keeps across restarts. */
export async function lookupTerminalId(): Promise<string | undefined> {
    if (!inGhostty()) return undefined;
    try {
        const { stdout: tty } = await run("ps", ["-o", "tty=", "-p", String(process.pid)]);
        const ids = await jxa(
            "function run([tty]) { return Application('Ghostty').terminals.whose({ tty }).id().join('\\n'); }",
            `/dev/${tty.trim()}`,
        );
        return ids.split("\n")[0] || undefined;
    } catch {
        return undefined;
    }
}

/** Windows front to back, with their tabs' terminals. Bulk property reads keep this to a few Apple events. */
export async function readLayout(): Promise<GhosttyWindow[] | undefined> {
    if (process.platform !== "darwin") return undefined;
    try {
        const output = await jxa(
            [
                "function run() {",
                "  const app = Application('Ghostty');",
                "  if (!app.running()) return '[]';",
                "  const ids = app.windows.id();",
                "  const tabs = app.windows.tabs.terminals.id();",
                "  return JSON.stringify(ids.map((id, i) => ({ id, tabs: tabs[i] })));",
                "}",
            ].join("\n"),
        );
        return JSON.parse(output) as GhosttyWindow[];
    } catch {
        return undefined;
    }
}

/** Bring a terminal's window to the front, select its tab and focus it. */
export async function focusTerminal(id: string): Promise<void> {
    await jxa(
        [
            "function run([id]) {",
            "  const app = Application('Ghostty');",
            "  app.activate();",
            "  app.focus(app.terminals.byId(id));",
            "}",
        ].join("\n"),
        id,
    );
}
