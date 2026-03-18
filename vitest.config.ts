import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@mariozechner/pi-ai":
                "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai",
            "@mariozechner/pi-coding-agent": "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent",
            "@mariozechner/pi-tui":
                "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-tui",
        },
    },
    test: {
        include: ["**/*.test.ts"],
    },
});
