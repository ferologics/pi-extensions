// Lets Node's built-in type stripping load TypeScript sources that import siblings as `./x.js`
// (the convention pi-web and Pi extensions use): a relative `.js` import that does not exist resolves to `.ts`.
import { registerHooks } from "node:module";

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
});
