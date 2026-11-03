import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Project {
    /** Same for every clone and worktree of a repo: its remote, else its git dir, else the cwd. */
    key: string;
    name: string;
}

/** `git@github.com:owner/repo.git`, `https://user@github.com/owner/repo` and `ssh://git@host:22/owner/repo` → `host/owner/repo`. */
export function normalizeRemote(url: string): string | undefined {
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    let rest: string;
    const scheme = trimmed.match(/^[a-z+]+:\/\/(.*)$/i);
    if (scheme) {
        rest = scheme[1]!.replace(/^[^@/]*@/, "").replace(/^([^/:]+):\d+\//, "$1/");
    } else {
        const scp = trimmed.match(/^(?:[^@/]+@)?([^:/]+):(.*)$/);
        if (!scp) return trimmed.replace(/\.git$/, "").replace(/\/+$/, "");
        rest = `${scp[1]}/${scp[2]}`;
    }
    return rest
        .replace(/\/+$/, "")
        .replace(/\.git$/, "")
        .toLowerCase();
}

async function git(cwd: string, args: string[]): Promise<string | undefined> {
    try {
        const { stdout } = await run("git", ["-C", cwd, ...args], { timeout: 3000 });
        return stdout.trim() || undefined;
    } catch {
        return undefined;
    }
}

/** The remote URL to identify the repo by: `origin`, else the first remote. */
function pickRemote(config: string | undefined): string | undefined {
    if (!config) return undefined;
    const remotes = config.split("\n").map((line) => {
        const [key, ...value] = line.split(" ");
        return { name: key!.replace(/^remote\./, "").replace(/\.url$/, ""), url: value.join(" ") };
    });
    return (remotes.find((remote) => remote.name === "origin") ?? remotes[0])?.url;
}

export async function projectOf(cwd: string): Promise<Project> {
    const [commonDir, remotes] = await Promise.all([
        git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]),
        git(cwd, ["config", "--get-regexp", "^remote\\..*\\.url$"]),
    ]);
    const remote = normalizeRemote(pickRemote(remotes) ?? "");
    if (remote) return { key: remote, name: remote.split("/").pop()! };
    if (commonDir) {
        const root = basename(commonDir) === ".git" ? dirname(commonDir) : commonDir;
        return { key: commonDir, name: basename(root) };
    }
    return { key: cwd, name: basename(cwd) || cwd };
}
