import { copyToClipboard, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type CopyBlock, describeBlock, latestResponseBlocks } from "./blocks.js";

const SHORTCUT = "ctrl+shift+x";

async function pickBlock(ctx: ExtensionContext, blocks: CopyBlock[]): Promise<CopyBlock | undefined> {
    if (blocks.length === 1) return blocks[0];

    const labels = blocks.map((block, index) => `${index + 1}. ${describeBlock(block)}`);
    const choice = await ctx.ui.select("Copy which block? (newest first)", labels);
    return choice === undefined ? undefined : blocks[labels.indexOf(choice)];
}

async function copyLatestBlock(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    const blocks = latestResponseBlocks(ctx.sessionManager.getBranch());
    if (blocks.length === 0) {
        ctx.ui.notify("No quoted or fenced blocks in the last response. Ctrl+X copies the whole message.", "warning");
        return;
    }

    const block = await pickBlock(ctx, blocks);
    if (!block) return;

    try {
        await copyToClipboard(block.text);
        ctx.ui.notify(`Copied ${describeBlock(block)}`, "info");
    } catch (error) {
        ctx.ui.notify(`Copy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
}

export default function piQuoteCopyExtension(pi: ExtensionAPI): void {
    pi.registerCommand("quote", {
        description: "Copy a quoted or fenced block from the last response as raw Markdown",
        handler: async (_args, ctx) => copyLatestBlock(ctx),
    });

    pi.registerShortcut(SHORTCUT, {
        description: "Copy a quoted or fenced block from the last response",
        handler: copyLatestBlock,
    });
}
