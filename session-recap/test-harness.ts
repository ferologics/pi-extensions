import { registerApiProvider } from "@earendil-works/pi-ai/compat";
import { buildSessionProjection, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import sessionRecap from "./index.js";

/** Gives draft entries the ids, parent links, and timestamps of one linear branch. */
export function completeBranch(entries: any[]): SessionEntry[] {
    let parentId: string | null = null;
    return entries.map((entry, index) => {
        const id = entry.id ?? `entry-${index}`;
        const result = {
            ...entry,
            id,
            parentId,
            timestamp: entry.timestamp ?? new Date(index * 1000).toISOString(),
        };
        parentId = id;
        return result;
    });
}

export function userEntry(content: string) {
    return { type: "message", message: { role: "user", content, timestamp: 1 } };
}

export function assistantEntry(text: string) {
    return { type: "message", message: { role: "assistant", content: [{ type: "text", text }], timestamp: 2 } };
}

/** A finished exchange with enough activity (30+ assistant words) for an automatic recap. */
export const exchange = [
    userEntry("Please fix the bridge integration."),
    assistantEntry(
        "I inspected the bridge integration and found that the adapter drops events when the socket reconnects. " +
            "I prepared a change that buffers events during the reconnect and replays them once the socket is back.",
    ),
];

export type StubCall = { kind: "stream" | "streamSimple"; options: any };

/** Registers a fake provider API. `respond` returns the assistant message for each request. */
export function stubApi(api: string, respond: () => any = () => recapResponse("Recap text.")): StubCall[] {
    const calls: StubCall[] = [];
    const stub = (kind: StubCall["kind"]) => (_model: unknown, _context: unknown, options: unknown) => {
        calls.push({ kind, options });
        return { result: async () => respond() };
    };
    registerApiProvider({ api, stream: stub("stream"), streamSimple: stub("streamSimple") } as any);
    return calls;
}

export function recapResponse(text: string, stopReason = "stop", extra: object = {}) {
    return { role: "assistant", content: [{ type: "text", text }], stopReason, ...extra };
}

export function testModel(api: string, provider = "test", id = "test-model") {
    return {
        id,
        name: id,
        api,
        provider,
        baseUrl: "http://localhost.invalid",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 4096,
    };
}

/** Loads the extension into a fake Pi with one in-memory session branch. */
export function loadRecap(options: { model: object; branch: any[] }) {
    const branch = completeBranch(options.branch);
    const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
    const handlers = new Map<string, (event: unknown, ctx: unknown) => void>();
    const flags = new Map<string, unknown>();
    const widgets: unknown[] = [];
    const notices: [string, string][] = [];
    let idle = true;

    const pi = {
        on: (event: string, handler: (event: unknown, ctx: unknown) => void) => handlers.set(event, handler),
        registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
            commands.set(name, command.handler),
        registerFlag: (name: string, flag: { default?: unknown }) => flags.set(name, flag.default),
        getFlag: (name: string) => flags.get(name),
        appendEntry: (customType: string, data: unknown) => {
            branch.push({
                type: "custom",
                customType,
                data,
                id: `entry-${branch.length}`,
                parentId: branch.at(-1)?.id ?? null,
                timestamp: new Date().toISOString(),
            });
        },
    };
    sessionRecap(pi as unknown as ExtensionAPI);

    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
    const ctx = {
        hasUI: true,
        model: options.model,
        isIdle: () => idle,
        modelRegistry: {
            find: () => undefined,
            getAvailable: () => [],
            getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "unused" }),
        },
        sessionManager: {
            getBranch: () => branch,
            buildSessionProjection: () => buildSessionProjection(branch),
        },
        ui: {
            theme,
            setStatus() {},
            notify: (message: string, type: string) => notices.push([message, type]),
            // Regular (non-fullscreen) TUI: showRecap ends with a plain-lines widget above the editor.
            setWidget: (_key: string, content: unknown) => {
                if (typeof content === "function") content({ mode: "regular", children: [] }, theme);
                else if (content !== undefined) widgets.push(content);
            },
        },
    };

    return {
        branch,
        widgets,
        notices,
        recap: () => commands.get("recap")!("", ctx),
        startSession: (reason: string) => handlers.get("session_start")!({ type: "session_start", reason }, ctx),
        setIdle: (value: boolean) => {
            idle = value;
        },
        savedRecaps: () =>
            branch.flatMap((entry) =>
                entry.type === "custom" && entry.customType === "session-recap" ? [entry.data] : [],
            ),
    };
}
