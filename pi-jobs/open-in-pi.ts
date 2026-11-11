import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RunTranscript } from "./api.js";
import { transcriptMarkdown } from "./transcript.js";

const run = promisify(execFile);

/** A new tab in this Rex session with an interactive shell that runs `input`, so the shell's startup (Pi secrets
 * included) runs first and the shell stays when Pi exits. */
const NEW_TAB_SCRIPT = `
local _, err = rex.session.new_window{
  layout = rex.layout.block{
    flavor = "com.superlogical.terminal.shell",
    options = { cwd = rex.args.cwd, initial_input = rex.args.input },
  },
}
if err ~= nil then error(err, 0) end
`;

/**
 * Write the run's transcript to a file and start a fresh Pi session on it in a new Rex tab. Returns the shell
 * command; throws with that command outside Rex, so it can be run by hand.
 */
export async function openInPi(transcript: RunTranscript): Promise<string> {
    const directory = join(tmpdir(), "pi-jobs");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${transcript.job}-${transcript.run.requestId.replace(/[^a-zA-Z0-9-]+/g, "-")}.md`);
    await writeFile(file, transcriptMarkdown(transcript), "utf8");
    const prompt = `This file is a run of my pi-jobs job ${transcript.job}. Read it and help me act on what it found.`;
    const command = `pi @'${file}' '${prompt}'`;
    const bin = process.env.REX_BIN_DIR;
    if (process.env.TERM_PROGRAM !== "rex" || !bin) {
        throw new Error(`Open in Pi needs Rex. Run it yourself: ${command}`);
    }
    // --autostart=false: a server started from here would hand this process's environment to every terminal in it.
    const args = JSON.stringify({ cwd: homedir(), input: `${command}\n` });
    await run(join(bin, "rex"), ["--autostart=false", "do", "-e", NEW_TAB_SCRIPT, "--args", args], { timeout: 5000 });
    return command;
}
