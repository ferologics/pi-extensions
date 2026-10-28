import { expect, it } from "vitest";
import { selectRecapModel } from "./index.js";

type TestModel = { provider: string; id: string };

const model = (provider: string, id: string): TestModel => ({ provider, id });
const select = (active: TestModel, available: TestModel[], override?: string) =>
    selectRecapModel(active as any, override, {
        find: (provider, id) =>
            available.find((candidate) => candidate.provider === provider && candidate.id === id) as any,
        getAvailable: () => available as any,
    });

it("lets an explicit recap model win", () => {
    const active = model("anthropic", "claude-opus-4-6");
    const override = model("openrouter", "google/gemini-3-flash");
    expect(select(active, [override], "openrouter/google/gemini-3-flash")).toBe(override);
    expect(select(active, [], "openrouter/missing-model")).toBe(active);
});

it("uses Codex GPT-5.6 Luna for Anthropic sessions", () => {
    const active = model("anthropic", "claude-opus-4-6");
    const haiku = model("anthropic", "claude-haiku-4-5");
    const luna = model("openai-codex", "gpt-5.6-luna");
    expect(select(active, [haiku, luna])).toBe(luna);
});

it("skips the recap for Anthropic sessions without a Codex login", () => {
    const active = model("anthropic", "claude-opus-4-6");
    expect(select(active, [active, model("anthropic", "claude-haiku-4-5")])).toBeUndefined();
});

it.each([
    ["openai-codex", "gpt-5.6-sol", "gpt-5.6-luna"],
    ["openrouter", "openai/gpt-5.6-sol", "openai/gpt-5.6-luna"],
    ["cursor", "gpt-5-6-sol@1m", "gpt-5-6-luna@1m"],
])("uses GPT-5.6 Luna for %s GPT sessions", (provider, activeId, lunaId) => {
    const active = model(provider, activeId);
    const luna = model(provider, lunaId);
    expect(select(active, [luna])).toBe(luna);
});

it("keeps the active model for non-GPT sessions outside Anthropic", () => {
    const active = model("openrouter", "anthropic/claude-opus-4.6");
    const haiku = model("openrouter", "anthropic/claude-haiku-4.5");
    const luna = model("openrouter", "openai/gpt-5.6-luna");
    expect(select(active, [haiku, luna])).toBe(active);
});

it("falls back to the active model when the cheaper model is unavailable", () => {
    const active = model("openai-codex", "gpt-5.6-sol");
    expect(select(active, [])).toBe(active);
});
