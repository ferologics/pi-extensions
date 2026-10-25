import type { RunTranscript, TranscriptItem } from "./api.js";

/** A code fence longer than any backtick run inside `text`, so tool output cannot close it early. */
function fenced(text: string, lang = ""): string {
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${fence}${lang}\n${text}\n${fence}`;
}

function itemMarkdown(item: TranscriptItem): string {
    switch (item.type) {
        case "handoff":
            return `## Handoff note\n\n${item.text}`;
        case "user":
            return `## Run message\n\n${item.text}`;
        case "assistant":
            return `## Assistant\n\n${item.text}`;
        case "tool_call":
            return `## Tool call: ${item.tool}\n\n${fenced(item.text, "json")}`;
        case "tool_result":
            return `## Tool result: ${item.tool}${item.isError ? " (error)" : ""}\n\n${fenced(item.text, "text")}`;
    }
}

/** A run as Markdown: header with its Pi Durable location, then every step in order. */
export function transcriptMarkdown(transcript: RunTranscript): string {
    const { run, durable } = transcript;
    const trigger = run.slot ? `${run.trigger}, slot ${run.slot}` : run.trigger;
    const header = [
        `# pi-jobs run: ${transcript.job}`,
        "",
        `- Status: ${run.status} (${trigger})`,
        `- Started: ${run.startedAt}${run.finishedAt ? `, finished: ${run.finishedAt}` : ""}`,
        `- Request: ${run.requestId}`,
        `- Pi Durable: conversation ${durable.conversationId}, submission ${run.submissionId}, in ${durable.statePath}`,
        ...(run.error ? [`- Error: ${run.error}`] : []),
    ].join("\n");
    const notifications = (run.notifications ?? []).map(
        (item) => `- **${item.title}** (${item.at}): ${item.message}${item.url ? ` ${item.url}` : ""}`,
    );
    const steps = transcript.items.length > 0 ? transcript.items.map(itemMarkdown) : ["_No transcript entries found._"];
    if (transcript.truncated) steps.push("_Transcript truncated: the run has more entries than the daemon returns._");
    const notified = notifications.length > 0 ? [`## Notifications\n\n${notifications.join("\n")}`] : [];
    return [header, ...notified, ...steps].join("\n\n");
}
