import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RunTranscript } from "./api.js";
import { transcriptMarkdown } from "./transcript.js";

const run = promisify(execFile);

/** The same Ghostty AppleScript pi-ghostty-hunk uses: a new window that types `input` into its shell. */
function ghosttyWindowScript(directory: string, input: string): string {
    return [
        'tell application "Ghostty"',
        "    activate",
        "    set cfg to new surface configuration",
        `    set initial working directory of cfg to ${JSON.stringify(directory)}`,
        `    set initial input of cfg to ${JSON.stringify(`${input}\n`)}`,
        "    new window with configuration cfg",
        "end tell",
    ].join("\n");
}

/**
 * Write the run's transcript to a file and start a fresh Pi session on it in a new Ghostty window. Returns the shell
 * command; throws with that command outside Ghostty on macOS, so it can be run by hand.
 */
export async function openInPi(transcript: RunTranscript): Promise<string> {
    const directory = join(tmpdir(), "pi-jobs");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${transcript.job}-${transcript.run.requestId.replace(/[^a-zA-Z0-9-]+/g, "-")}.md`);
    await writeFile(file, transcriptMarkdown(transcript), "utf8");
    const prompt = `This file is a run of my pi-jobs job ${transcript.job}. Read it and help me act on what it found.`;
    const command = `pi @'${file}' '${prompt}'`;
    const inGhostty = process.env.GHOSTTY_RESOURCES_DIR !== undefined || process.env.TERM_PROGRAM === "ghostty";
    if (process.platform !== "darwin" || !inGhostty) {
        throw new Error(`Open in Pi needs Ghostty on macOS. Run it yourself: ${command}`);
    }
    await run("osascript", ["-e", ghosttyWindowScript(homedir(), command)]);
    return command;
}
