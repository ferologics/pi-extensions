import { describe, expect, it } from "vitest";
import { groupSessions } from "./groups.js";
import { resolveTarget } from "./index.js";
import type { LiveSession, Priority } from "./live.js";
import { currentBranch, tailParts } from "./peek.js";

function session(
    pid: number,
    fields: Omit<Partial<LiveSession>, "project"> & { project?: string; priority?: Priority } = {},
): LiveSession {
    const { project = "pi-shit", ...rest } = fields;
    return {
        v: 1,
        pid,
        sessionId: `0000000${pid}-aaaa-bbbb-cccc-dddddddddddd`,
        cwd: `/repo/${project}`,
        project: { key: `github.com/me/${project}`, name: project },
        label: `session ${pid}`,
        status: "idle",
        statusSince: "2026-10-28T10:00:00.000Z",
        startedAt: `2026-10-28T10:00:0${pid}.000Z`,
        updatedAt: "2026-10-28T10:00:00.000Z",
        ...rest,
    };
}

describe("groupSessions", () => {
    const layout = [
        { id: "w1", tabs: [["t3"], ["t1", "t2"]] },
        { id: "w2", tabs: [["t4"]] },
    ];

    it("groups by Ghostty window in tab order, with windows sorted by their best priority", () => {
        const groups = groupSessions(
            [
                session(1, { terminalId: "t1" }),
                session(2, { terminalId: "t2", project: "dotfiles" }),
                session(3, { terminalId: "t3" }),
                session(4, { terminalId: "t4", priority: 0 }),
            ],
            layout,
        );
        expect(groups.map((group) => group.title)).toEqual(["pi-shit", "pi-shit · dotfiles"]);
        expect(groups[0]!.priority).toBe(0);
        expect(groups[1]!.sessions.map((member) => member.pid)).toEqual([3, 1, 2]);
    });

    it("groups sessions outside Ghostty by project, after the windows", () => {
        const groups = groupSessions(
            [
                session(1, { terminalId: "t1" }),
                session(2, { project: "mobile" }),
                session(3, { project: "mobile" }),
                session(5, { terminalId: "gone" }),
            ],
            layout,
        );
        expect(groups.map((group) => [group.title, group.sessions.map((member) => member.pid)])).toEqual([
            ["pi-shit", [1]],
            ["mobile", [2, 3]],
            ["pi-shit", [5]],
        ]);
    });

    it("groups everything by project when there is no Ghostty layout", () => {
        const groups = groupSessions([session(1, { terminalId: "t1" }), session(2, { project: "mobile" })], undefined);
        expect(groups.map((group) => group.title)).toEqual(["mobile", "pi-shit"]);
    });
});

describe("resolveTarget", () => {
    const sessions = [
        session(1, { label: "fix the e2e login test" }),
        session(2, { label: "e2e flaky checkout" }),
        session(3, { label: "release pi-web" }),
    ];

    it("finds a session by id prefix, exact label or unique label substring", () => {
        expect(resolveTarget(sessions, "00000003-aaaa")).toMatchObject({ pid: 3 });
        expect(resolveTarget(sessions, "Release pi-web")).toMatchObject({ pid: 3 });
        expect(resolveTarget(sessions, "checkout")).toMatchObject({ pid: 2 });
    });

    it("lists the live sessions when the target is ambiguous or unknown", () => {
        expect(resolveTarget(sessions, "e2e")).toContain("matches more than one session");
        const unknown = resolveTarget(sessions, "nope");
        expect(unknown).toContain("matches no live session");
        expect(unknown).toContain('"release pi-web"');
    });
});

describe("peek", () => {
    it("shows the last two user turns with replies and tool calls on the current branch", () => {
        const at = "2026-10-28T10:00:00.000Z";
        const user = (id: string, parentId: string | null, text: string) => ({
            type: "message" as const,
            id,
            parentId,
            timestamp: at,
            message: { role: "user" as const, content: text, timestamp: 0 },
        });
        const assistant = (id: string, parentId: string, content: unknown[], stopReason = "stop") => ({
            type: "message" as const,
            id,
            parentId,
            timestamp: at,
            message: { role: "assistant", content, stopReason, timestamp: 0 },
        });
        const entries = [
            { type: "session", version: 3, id: "s", timestamp: at, cwd: "/" },
            user("u1", null, "first task"),
            assistant("a1", "u1", [{ type: "text", text: "done one" }]),
            user("u2", "a1", "second task"),
            assistant("a2", "u2", [
                { type: "text", text: "looking" },
                { type: "toolCall", id: "c", name: "bash", arguments: { command: "git status\nmore" } },
            ]),
            user("u3", "a2", "third task"),
            assistant("a3", "u3", [], "error"),
            // An abandoned branch that is not the leaf's ancestor.
            user("x", "a1", "abandoned"),
            user("u4", "a3", "fourth"),
        ] as unknown as Parameters<typeof currentBranch>[0];

        const markdown = tailParts(currentBranch(entries)).join("\n\n");
        expect(markdown).not.toContain("second task");
        expect(markdown).not.toContain("abandoned");
        expect(markdown).toContain("**You:** third task");
        expect(markdown).toContain("**Error:** the request failed");
        expect(markdown).toContain("**You:** fourth");
    });
});
