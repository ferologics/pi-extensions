import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGuard, DEFAULT_HIDE, envFileKeys, loadConfig, parseConfig, refill, stripEnv } from "./index.js";

function tempFile(name: string, text: string): string {
    const path = join(mkdtempSync(join(tmpdir(), "pi-env-guard-")), name);
    writeFileSync(path, text);
    return path;
}

describe("config", () => {
    it("uses the default patterns without a config file", () => {
        expect(loadConfig(join(tmpdir(), "pi-env-guard-missing.json"))).toEqual({
            hide: DEFAULT_HIDE,
            envFiles: [],
            allow: [],
        });
    });

    it("rejects unknown keys and non-string lists", () => {
        expect(() => parseConfig({ hidden: [] })).toThrow(/unknown config key "hidden"/);
        expect(() => parseConfig({ allow: "GH_TOKEN" })).toThrow(/"allow" must be an array/);
        expect(() => parseConfig({ refill: [] })).toThrow(/must name a command/);
    });
});

describe("guard", () => {
    it("drops default-pattern and env-file keys, keeps allowed ones", () => {
        const envFile = tempFile(
            "env.op",
            "# refs\nOPENAI_API_KEY=op://Pi/OpenAI/key\nDB_URL=op://Pi/DB/url\n\nnot a key\n",
        );
        const guard = createGuard(parseConfig({ envFiles: [envFile], allow: ["DB_URL", "GH_*"] }));
        const env = stripEnv(guard, {
            PATH: "/usr/bin",
            OPENAI_API_KEY: "a",
            SLACK_USER_TOKEN: "b",
            OP_SERVICE_ACCOUNT_TOKEN: "c",
            DB_URL: "d",
            GH_TOKEN: "e",
        });
        expect(env).toEqual({ PATH: "/usr/bin", DB_URL: "d", GH_TOKEN: "e" });
        expect(guard.named).toEqual(["OPENAI_API_KEY"]);
    });

    it("reads env-file keys the way the fish bootstrap does", () => {
        const envFile = tempFile(
            "env.op",
            "A_KEY=op://x\n# B_KEY=op://y\nC_KEY = op://z\n9BAD=op://w\nA_KEY=op://dup\n",
        );
        expect(envFileKeys(envFile)).toEqual(["A_KEY", "C_KEY"]);
        expect(envFileKeys(join(tmpdir(), "pi-env-guard-missing.op"))).toEqual([]);
    });
});

describe("refill", () => {
    it("fills named keys a process started without and leaves set ones alone", () => {
        const guard = createGuard(parseConfig({ hide: ["A_KEY", "B_KEY", "*TOKEN*"] }));
        const env: NodeJS.ProcessEnv = { B_KEY: "kept" };
        refill(guard, ["/usr/bin/printf", "value-of-{name}"], env);
        expect(env).toEqual({ A_KEY: "value-of-A_KEY", B_KEY: "kept" });
    });

    it("leaves a key unset when the command fails", () => {
        const guard = createGuard(parseConfig({ hide: ["A_KEY"] }));
        const env: NodeJS.ProcessEnv = {};
        refill(guard, ["/usr/bin/false"], env);
        expect(env).toEqual({});
    });
});
