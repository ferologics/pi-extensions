import { describe, expect, it } from "vitest";
import type { RunTranscript } from "./api.js";
import { transcriptMarkdown } from "./transcript.js";

describe("transcriptMarkdown", () => {
    it("fences tool output with a fence longer than any backtick run inside it", () => {
        const transcript: RunTranscript = {
            job: "agent-audit",
            run: {
                requestId: "agent-audit@manual-1",
                submissionId: 7,
                trigger: "manual",
                startedAt: "2026-10-25T17:05:45.818Z",
                status: "done",
            },
            durable: { statePath: "/state/jobs.sqlite", conversationId: 22 },
            items: [
                { type: "tool_call", tool: "job_command", text: "{}" },
                { type: "tool_result", tool: "job_command", text: "report\n```\nquoted\n```", isError: false },
                { type: "assistant", text: "Nothing new." },
            ],
            truncated: false,
        };
        const markdown = transcriptMarkdown(transcript);
        expect(markdown).toContain("- Pi Durable: conversation 22, submission 7, in /state/jobs.sqlite");
        expect(markdown).toContain("## Tool result: job_command\n\n````text\nreport\n```\nquoted\n```\n````");
        expect(markdown.endsWith("## Assistant\n\nNothing new.")).toBe(true);
    });
});
