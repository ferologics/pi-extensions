import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@earendil-works/pi-agent-core":
                "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core",
            "@earendil-works/pi-ai":
                "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai",
            "@earendil-works/pi-coding-agent": "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
            "@earendil-works/pi-tui":
                "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui",
        },
    },
    test: {
        include: ["**/*.test.ts"],
    },
});
