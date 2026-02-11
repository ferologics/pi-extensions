export interface RenderFileBlock {
    path: string;
    content: string;
}

export interface RenderOmittedItem {
    path: string;
    reason?: string;
}

export interface RenderContextPackMarkdownInput {
    headerLines: string[];
    changedFiles: RenderFileBlock[];
    relatedFiles: RenderFileBlock[];
    omittedChangedFiles: RenderOmittedItem[];
}

export function renderFileBlockMarkdown(file: RenderFileBlock): string {
    const lines = [`### ${file.path}`, "", "```", file.content];

    if (!file.content.endsWith("\n")) {
        lines.push("");
    }

    lines.push("```", "");

    return lines.join("\n");
}

function renderFileBlocks(title: string, files: RenderFileBlock[]): string {
    const lines: string[] = [title, ""];

    for (const file of files) {
        lines.push(renderFileBlockMarkdown(file));
    }

    if (files.length === 0) {
        lines.push("None");
        lines.push("");
    }

    return lines.join("\n");
}

export function renderContextPackMarkdown(input: RenderContextPackMarkdownInput): string {
    const lines: string[] = [];

    lines.push("# PR Context Pack");
    lines.push("");
    lines.push(...input.headerLines);
    lines.push("");

    lines.push(
        renderFileBlocks(`## Full current code: changed files (${input.changedFiles.length})`, input.changedFiles),
    );
    lines.push(
        renderFileBlocks(`## Full current code: related files (${input.relatedFiles.length})`, input.relatedFiles),
    );

    lines.push(`## Omitted changed files (${input.omittedChangedFiles.length})`);
    lines.push("");

    if (input.omittedChangedFiles.length === 0) {
        lines.push("None");
    } else {
        for (const omitted of input.omittedChangedFiles) {
            if (omitted.reason) {
                lines.push(`- ${omitted.path} — ${omitted.reason}`);
            } else {
                lines.push(`- ${omitted.path}`);
            }
        }
    }

    lines.push("");

    return lines.join("\n");
}
