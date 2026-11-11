// The window layer: Rex, through the `rex` CLI of the server this Pi runs under. A Rex session is a group in the app's
// sidebar, its windows are tabs, and its blocks are panes. Outside Rex everything here is undefined. Failures throw.

import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface RexSession {
    id: string;
    label: string;
    /** Tabs in order, each with its blocks (panes) in layout order. */
    tabs: { id: string; label: string; blocks: string[] }[];
}

/** This process's terminal: the Rex block it runs in. Rex keeps the id across server restarts. */
export function terminalId(): string | undefined {
    return process.env.TERM_PROGRAM === "rex" ? process.env.REX_BLOCK : undefined;
}

/** The `rex` of the server this terminal belongs to. Never starts a server: one started from here would hand this
 * process's environment to every terminal in it. */
async function rex(...args: string[]): Promise<string> {
    const bin = process.env.REX_BIN_DIR;
    if (!bin) throw new Error("not in a Rex terminal");
    const { stdout } = await run(join(bin, "rex"), ["--autostart=false", ...args], { timeout: 5000 });
    return stdout.trim();
}

// A script may read a session only after attaching to it.
const LAYOUT_SCRIPT = `
local out = {}
local list, err = rex.call("session.list")
if err ~= nil then error(err, 0) end
for _, s in ipairs(list.sessions or {}) do
  rex.session.attach{ session_id = s.session_id }
  local view, verr = rex.call("session.view", { session_id = s.session_id })
  if verr ~= nil then error(verr, 0) end
  local tabs = {}
  for _, w in ipairs(view.windows or {}) do
    local blocks = {}
    for _, layer in ipairs(w.layers or {}) do
      for _, b in ipairs(layer.blocks or {}) do blocks[#blocks + 1] = b.block_id end
    end
    tabs[#tabs + 1] = { id = w.window_id, label = w.label, blocks = blocks }
  end
  out[#out + 1] = { id = s.session_id, label = s.label, tabs = tabs }
end
return out
`;

const FOCUS_SCRIPT = `
local a = rex.args
rex.session.attach{ session_id = a.session }
local _, err = rex.call("session.focus_block", { session_id = a.session, block_id = a.block })
if err ~= nil then error(err, 0) end
rex.client.queue("session.select", { session_id = a.session, window_id = a.window })
`;

/** Lua encodes an empty table as an object, so an empty list may arrive as {}. */
function list<T>(value: unknown): T[] {
    return Array.isArray(value) ? (value as T[]) : [];
}

/** Every session in sidebar order, with its tabs and their blocks. Undefined outside Rex. */
export async function readLayout(): Promise<RexSession[] | undefined> {
    if (!terminalId()) return undefined;
    const sessions = list<RexSession>(JSON.parse((await rex("do", "-e", LAYOUT_SCRIPT)) || "[]"));
    return sessions.map((session) => ({
        ...session,
        tabs: list<RexSession["tabs"][number]>(session.tabs).map((tab) => ({ ...tab, blocks: list(tab.blocks) })),
    }));
}

/** Show a block's session and tab in the app and focus the block. Needs Remote Control on in Rex's settings. */
export async function focusTerminal(block: string): Promise<void> {
    for (const session of (await readLayout()) ?? []) {
        const tab = session.tabs.find((candidate) => candidate.blocks.includes(block));
        if (!tab) continue;
        await rex("do", "-e", FOCUS_SCRIPT, "--args", JSON.stringify({ session: session.id, window: tab.id, block }));
        return;
    }
    throw new Error("its Rex pane is gone");
}

/** Label the tab this process runs in; an empty label gives it back Rex's default. */
export async function labelTab(label: string): Promise<void> {
    await rex("window", "rename", "--", label);
}
