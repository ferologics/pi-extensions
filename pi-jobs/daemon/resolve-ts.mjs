// Lets Node's built-in type stripping run the daemon and the TypeScript packages it imports, with no build step:
// - a relative `.js` import that does not exist resolves to `.ts` (the convention pi-web and Pi extensions use);
// - `.ts` files under node_modules, which Node refuses to strip itself, have their types stripped here.
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (!specifier.startsWith(".") || !specifier.endsWith(".js")) return nextResolve(specifier, context);
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
            return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
        }
    },
    load(url, context, nextLoad) {
        if (!url.startsWith("file:") || !url.endsWith(".ts") || !url.includes("/node_modules/")) {
            return nextLoad(url, context);
        }
        const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
        return { format: "module", source, shortCircuit: true };
    },
});
