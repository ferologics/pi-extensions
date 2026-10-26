import { Container } from "@earendil-works/pi-tui";
import { expect, it } from "vitest";
import { showRecap } from "./index.js";

function createUi(mode: string) {
    const document = new Container();
    for (let i = 0; i < 3; i++) document.addChild(new Container());
    const tui = { mode, children: [document] };
    const theme = { fg: (_name: string, text: string) => text, bold: (text: string) => text };
    const widgets = new Map<string, { content: unknown; component: any; options: any }>();
    const ui = {
        theme,
        setWidget(key: string, content: unknown, options: unknown) {
            widgets.get(key)?.component?.dispose?.();
            widgets.delete(key);
            if (content === undefined) return;
            const component = typeof content === "function" ? content(tui, theme) : undefined;
            widgets.set(key, { content, component, options });
        },
    };
    return { ctx: { ui } as any, document, widgets };
}

it("parks the fullscreen recap as temporary transcript content", () => {
    const { ctx, document, widgets } = createUi("fullscreen");
    showRecap(ctx, "Temporary recap text.");

    expect(document.children).toHaveLength(4);
    expect(document.children[3]!.render(80).join("\n")).toMatch(/Temporary recap text/);
    expect(widgets.get("session-recap")!.options.placement).toBe("belowEditor");
    expect(widgets.get("session-recap")!.component.render(80)).toEqual([]);

    ctx.ui.setWidget("session-recap", undefined);
    expect(document.children).toHaveLength(3);
});

it("keeps the recap above the editor in regular mode", () => {
    const { ctx, document, widgets } = createUi("regular");
    showRecap(ctx, "Temporary recap text.");

    expect(document.children).toHaveLength(3);
    expect(widgets.get("session-recap")!.options.placement).toBe("aboveEditor");
    expect(widgets.get("session-recap")!.content).toEqual(["✦ recap", "Temporary recap text."]);
});
