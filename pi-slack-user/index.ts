import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSlackThread } from "./format.js";
import { SlackUserClient } from "./slack.js";
import { buildSlackReplyPermalink, parseSlackPermalink } from "./url.js";

const READ_GUIDELINES = [
    "Use slack_read_url when the user provides a Slack message or thread permalink and asks for its contents or context.",
    "Slack content returned by slack_read_url may be sensitive; use only what is needed for the user's request.",
];

const WRITE_GUIDELINES = [
    "Use slack_post_reply_url only when the user explicitly asks to post a reply to Slack.",
    "Draft Slack text normally without slack_post_reply_url when the user asks only for wording or a draft.",
    "slack_post_reply_url always asks the user to confirm the exact destination and message before posting.",
];

const readUrlParameters = Type.Object({
    url: Type.String({
        description: "Slack message or thread permalink (https://<workspace>.slack.com/archives/...).",
    }),
    max_messages: Type.Optional(
        Type.Integer({
            description: "Maximum thread messages to return (1-200). Default 100.",
            minimum: 1,
            maximum: 200,
        }),
    ),
});

const postReplyParameters = Type.Object({
    url: Type.String({
        description: "Slack message or thread permalink to reply to.",
    }),
    text: Type.String({
        description: "Exact reply text to post. Slack mrkdwn is supported.",
        minLength: 1,
        maxLength: 12_000,
    }),
});

function getUserToken(): string {
    const token = process.env.SLACK_USER_TOKEN?.trim();
    if (!token) {
        throw new Error(
            "Missing SLACK_USER_TOKEN. Add a Slack User OAuth Token (xoxp-...) to the Pi environment and restart Pi.",
        );
    }
    return token;
}

function confirmationPreview(url: string, text: string): string {
    return `Reply to:\n${url}\n\nExact message:\n${text}`;
}

export default function piSlackUserExtension(pi: ExtensionAPI): void {
    let cachedClient: SlackUserClient | undefined;
    let cachedToken: string | undefined;

    function client(): SlackUserClient {
        const token = getUserToken();
        if (!cachedClient || token !== cachedToken) {
            cachedClient = new SlackUserClient(token);
            cachedToken = token;
        }
        return cachedClient;
    }

    pi.registerTool({
        name: "slack_read_url",
        label: "Slack Read URL",
        description:
            "Read a Slack message and its complete thread from a permalink using the authenticated user's access. " +
            "Requires SLACK_USER_TOKEN. Output is capped at 48KB.",
        promptSnippet: "Read a Slack message or thread permalink as the authenticated user",
        promptGuidelines: READ_GUIDELINES,
        parameters: readUrlParameters,
        async execute(_toolCallId, params, signal) {
            const target = parseSlackPermalink(params.url);
            const thread = await client().readThread(target, params.max_messages ?? 100, signal);
            const formatted = formatSlackThread(target, thread);

            return {
                content: [{ type: "text", text: formatted.text }],
                details: {
                    channel: target.channelId,
                    threadTs: target.threadTs,
                    count: thread.messages.length,
                    messageLimitReached: thread.truncatedByMessageLimit,
                    outputTruncated: formatted.outputTruncated,
                },
            };
        },
    });

    pi.registerTool({
        name: "slack_post_reply_url",
        label: "Slack Post Reply",
        description:
            "Post a reply to a Slack message/thread permalink as the authenticated user. Requires SLACK_USER_TOKEN " +
            "with chat:write and always requires interactive confirmation.",
        promptSnippet: "Post a confirmed reply to a Slack thread as the authenticated user",
        promptGuidelines: WRITE_GUIDELINES,
        parameters: postReplyParameters,
        async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            if (!ctx.hasUI) {
                throw new Error("Slack posting requires interactive UI confirmation.");
            }

            const text = params.text;
            if (!text.trim()) {
                throw new Error("Slack reply text cannot be empty.");
            }

            const target = parseSlackPermalink(params.url);
            const confirmed = await ctx.ui.confirm("Post Slack reply?", confirmationPreview(target.originalUrl, text));
            if (!confirmed) {
                return {
                    content: [{ type: "text", text: "Slack reply cancelled; nothing was posted." }],
                    details: { posted: false },
                };
            }

            const posted = await client().postReply(target, text, signal);
            const permalink = buildSlackReplyPermalink(target, posted.ts);
            return {
                content: [{ type: "text", text: `Posted Slack reply: ${permalink}` }],
                details: {
                    posted: true,
                    channel: posted.channel,
                    ts: posted.ts,
                    permalink,
                },
            };
        },
    });

    pi.registerCommand("slack-user", {
        description: "Check Slack user-token configuration and identity",
        handler: async (_args, ctx) => {
            if (!process.env.SLACK_USER_TOKEN?.trim()) {
                ctx.ui.notify(
                    "SLACK_USER_TOKEN is missing. Configure an xoxp User OAuth Token, then restart Pi.",
                    "warning",
                );
                return;
            }

            try {
                const identity = await client().authTest();
                const who = identity.user ? `@${identity.user}` : identity.userId || "unknown user";
                const workspace = identity.team || identity.workspaceUrl || identity.teamId || "unknown workspace";
                ctx.ui.notify(`Slack user token is valid: ${who} on ${workspace}.`, "info");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(message, "error");
            }
        },
    });
}
