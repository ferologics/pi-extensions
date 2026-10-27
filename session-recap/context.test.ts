import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { buildRecapContext, hasMeaningfulActivity } from "./index.js";
import { completeBranch } from "./test-harness.js";

const initialTask = `Build a session recap that preserves the user's task framing. ${"context ".repeat(100)}`.trim();
const summary =
    `The recap extension now works, but its output lacks the original task context. ${"detail ".repeat(120)}`.trim();
const toolResult = `The implementation still flattens and truncates the conversation. ${"output ".repeat(1000)}`;

function recap(entries: any[]) {
    const branch = completeBranch(entries);
    return buildRecapContext(buildSessionProjection(branch).entries, branch);
}

const initialEntry = {
    type: "message",
    message: { role: "user", content: initialTask, timestamp: 1 },
};
const currentEntries = [
    {
        type: "branch_summary",
        fromId: "old-leaf",
        summary,
    },
    {
        type: "message",
        message: { role: "user", content: "Make it match Claude Code more closely.", timestamp: 2 },
    },
    {
        type: "message",
        message: {
            role: "assistant",
            content: [
                { type: "text", text: "I am comparing the two implementations." },
                { type: "toolCall", id: "call-1", name: "read", arguments: { path: "src/services/awaySummary.ts" } },
            ],
            timestamp: 3,
        },
    },
    {
        type: "message",
        message: {
            role: "toolResult",
            toolCallId: "call-1",
            toolName: "read",
            content: [{ type: "text", text: toolResult }],
            isError: false,
            timestamp: 4,
        },
    },
];

it("keeps broad task framing and recent projected messages", () => {
    const context: any = recap([initialEntry, ...currentEntries]);

    expect(context.broaderContext).toBe(`Session summary:\n${summary}`);
    expect(context.messages.map((message: any) => message.role)).toEqual(["user", "user", "assistant", "toolResult"]);
    expect(context.messages[0].content).toBe(initialTask);
    expect(context.messages[3].content[0].text).toBe(
        `${toolResult.slice(0, 2000)}\n… [tool result truncated for recap] …\n${toolResult.slice(-2000)}`,
    );
});

it("uses a 30-message recent window and bounds initial framing", () => {
    const initialRequest = `Start of request. ${"detail ".repeat(1500)}End of request.`;
    const branch = [];
    for (let i = 1; i <= 16; i++) {
        branch.push(
            { type: "message", message: { role: "user", content: i === 1 ? initialRequest : `User request ${i}` } },
            { type: "message", message: { role: "assistant", content: [{ type: "text", text: `Response ${i}` }] } },
        );
    }

    const context: any = recap(branch);
    expect(context.messages).toHaveLength(30);
    expect(context.messages[0].content).toBe("User request 2");
    expect(context.broaderContext.startsWith("Initial user request:\nStart of request.")).toBe(true);
    expect(context.broaderContext).toMatch(/\[middle of initial request omitted for recap\]/);
    expect(context.broaderContext.endsWith("End of request.")).toBe(true);
});

it("adds a user boundary before an assistant-led window", () => {
    const branch: any[] = [{ type: "message", message: { role: "user", content: "Investigate the failing build." } }];
    for (let i = 1; i <= 16; i++) {
        branch.push(
            {
                type: "message",
                message: {
                    role: "assistant",
                    content: [{ type: "toolCall", id: `call-${i}`, name: "read", arguments: { path: `file-${i}` } }],
                },
            },
            {
                type: "message",
                message: {
                    role: "toolResult",
                    toolCallId: `call-${i}`,
                    toolName: "read",
                    content: [{ type: "text", text: `file ${i} contents` }],
                },
            },
        );
    }

    const context: any = recap(branch);
    expect(context.messages[0].role).toBe("user");
    expect(context.messages[0].content).toBe("(Earlier conversation omitted.)");
    expect(context.messages[1].role).toBe("assistant");
});

it("leaves out the session's system prompt and tools", () => {
    const tool = { name: "read", description: "Read a file", parameters: { type: "object", properties: {} } };
    const context = recap([
        {
            type: "message",
            message: {
                role: "system",
                content: "You are an expert coding assistant operating inside pi.",
                sections: { project: "<project_context>Project rules</project_context>" },
                toolsAdded: [tool],
                timestamp: 1,
            },
        },
        { type: "message", message: { role: "user", content: "Fix the login form.", timestamp: 2 } },
        {
            type: "message",
            message: {
                role: "system",
                content: "Additional instructions.",
                toolsRemoved: [{ name: "read" }],
                timestamp: 3,
            },
        },
        {
            type: "message",
            message: { role: "assistant", content: [{ type: "text", text: "Looking." }], timestamp: 4 },
        },
    ]);

    expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(context)).not.toMatch(
        /expert coding assistant|Project rules|Additional instructions|Read a file/,
    );
});

it("does not repeat a recent initial request", () => {
    expect(recap([initialEntry]).broaderContext).toBeUndefined();
});

it("takes messages from the canonical context-edit projection", () => {
    const context = recap([
        { ...initialEntry, id: "initial" },
        {
            type: "context_edit",
            targetId: "initial",
            replacement: { content: "Build the corrected projected task." },
        },
    ]);

    expect(context.messages.map((message) => message.content)).toEqual(["Build the corrected projected task."]);
    expect(JSON.stringify(context)).not.toMatch(/preserves the user's task framing/);
});

it("leaves edited-out messages out of initial-task and activity logic", () => {
    const entries = [
        { type: "message", id: "old-user", message: { role: "user", content: "Discarded task" } },
        {
            type: "message",
            id: "old-assistant",
            message: {
                role: "assistant",
                content: [{ type: "toolCall", id: "call-old", name: "read", arguments: { path: "old.ts" } }],
            },
        },
        { type: "context_edit", targetId: "old-user", replacement: null },
        { type: "context_edit", targetId: "old-assistant", replacement: null },
        { type: "message", message: { role: "user", content: "Current task" } },
    ];
    const projection = buildSessionProjection(completeBranch(entries)).entries;
    const context = recap(entries);

    expect(context.messages.map((message) => message.content)).toEqual(["Current task"]);
    expect(context.broaderContext).toBeUndefined();
    expect(hasMeaningfulActivity(projection)).toBe(false);
});

it("selects the active compaction when older compactions are retained after it", () => {
    const context = recap([
        { ...initialEntry, id: "initial" },
        {
            type: "compaction",
            id: "old-compaction",
            summary: "Stale compaction summary",
            firstKeptEntryId: "initial",
            tokensBefore: 100,
        },
        { type: "message", message: { role: "user", content: "Retained request" } },
        {
            type: "compaction",
            id: "active-compaction",
            summary: "Active compaction summary",
            firstKeptEntryId: "old-compaction",
            tokensBefore: 200,
        },
        { type: "message", message: { role: "user", content: "Current request" } },
    ]);
    expect(context.broaderContext).toMatch(/Session summary:\nActive compaction summary/);
    expect(context.broaderContext).not.toMatch(/Stale compaction summary/);
});

it("retains the edited original request after compaction", () => {
    const context = recap([
        { ...initialEntry, id: "initial" },
        {
            type: "compaction",
            id: "compaction",
            summary: "Work continues after compaction.",
            firstKeptEntryId: "compaction",
            tokensBefore: 100,
        },
        {
            type: "context_edit",
            targetId: "initial",
            replacement: { content: "Build the corrected original request." },
        },
        { type: "message", message: { role: "user", content: "Continue from the summary." } },
    ]);

    expect(context.broaderContext).toMatch(/Initial user request:\nBuild the corrected original request\./);
    expect(context.broaderContext).not.toMatch(/preserves the user's task framing/);
});

it("does not restore an omitted original request after compaction", () => {
    const context = recap([
        { ...initialEntry, id: "initial" },
        { type: "message", message: { role: "user", content: "Use this surviving task instead." } },
        {
            type: "compaction",
            id: "compaction",
            summary: "Work continues after compaction.",
            firstKeptEntryId: "compaction",
            tokensBefore: 100,
        },
        { type: "context_edit", targetId: "initial", replacement: null },
        { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Continuing." }] } },
    ]);

    expect(context.broaderContext).toMatch(/Initial user request:\nUse this surviving task instead\./);
    expect(context.broaderContext).not.toMatch(/preserves the user's task framing/);
});
