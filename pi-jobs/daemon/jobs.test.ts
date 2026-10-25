import { describe, expect, it } from "vitest";
import { latestSlot, nextSlot, parseJob } from "./jobs.js";

describe("parseJob", () => {
    it("reads frontmatter and the prompt body", () => {
        const job = parseJob(
            "/jobs/mac-studio.md",
            '---\nschedule: "0 */6 * * *" # every 6h\nmodel: anthropic/claude-haiku-5-5\nthinking: low\n---\nCheck the page.\n',
        );
        expect(job).toMatchObject({
            name: "mac-studio",
            schedule: "0 */6 * * *",
            model: { provider: "anthropic", modelId: "claude-haiku-5-5" },
            thinking: "low",
            enabled: true,
            tools: ["web_search", "web_fetch", "notify"],
            prompt: "Check the page.",
        });
        expect(job.command).toBeUndefined();
    });

    it("puts job_command first for a command job and keeps only the listed tools", () => {
        const job = parseJob(
            "/jobs/agent-audit.md",
            "---\nschedule: 0 9 * * 1\ncommand: /usr/bin/python3 ~/audit.py --days 8\ntools: notify\n---\nTriage.",
        );
        expect(job.command).toBe("/usr/bin/python3 ~/audit.py --days 8");
        expect(job.tools).toEqual(["job_command", "notify"]);
    });

    it("rejects unknown keys and bad schedules", () => {
        expect(() => parseJob("/jobs/a.md", "---\nschedule: 0 9 * * *\ncron: x\n---\nx")).toThrow(
            /unknown frontmatter key/,
        );
        expect(() => parseJob("/jobs/a.md", "---\nschedule: every 6h\n---\nx")).toThrow(/5-field/);
        expect(() => parseJob("/jobs/Bad.md", "---\nschedule: 0 9 * * *\n---\nx")).toThrow(/file name/);
        expect(() => parseJob("/jobs/a.md", "---\nschedule: 0 9 * * *\ntools: notify, bash\n---\nx")).toThrow(
            /unknown tool "bash"/,
        );
    });
});

describe("slots", () => {
    it("returns the latest slot at or before now and the next one after", () => {
        const now = new Date(2026, 9, 25, 14, 30, 0);
        expect(latestSlot("0 */6 * * *", now)).toEqual(new Date(2026, 9, 25, 12, 0, 0));
        expect(nextSlot("0 */6 * * *", now)).toEqual(new Date(2026, 9, 25, 18, 0, 0));
        expect(latestSlot("30 14 * * *", now)).toEqual(now);
    });
});
