import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const execFileAsyncMock =
    vi.fn<
        (file: string, args: string[], options: Record<string, unknown>) => Promise<{ stdout: string; stderr?: string }>
    >();

vi.mock("node:child_process", () => {
    const promisifyCustom = Symbol.for("nodejs.util.promisify.custom");
    const execFile = vi.fn();

    (execFile as unknown as Record<symbol, unknown>)[promisifyCustom] = (
        file: string,
        args: string[],
        options: Record<string, unknown>,
    ) => execFileAsyncMock(file, args, options);

    return { execFile };
});

type SessionStartHandler = (event: unknown, ctx: TestContext) => Promise<void> | void;

type TestContext = {
    hasUI: boolean;
    ui: {
        theme: { name: string | undefined };
        getAllThemes: () => Array<{ name: string; path?: string }>;
        setTheme: (theme: string) => { success: boolean; error?: string };
        notify: (message: string, level?: string) => void;
    };
};

const originalPlatform = process.platform;
const originalHome = process.env.HOME;
let testHome = "";
let setIntervalSpy: { mockRestore: () => void };
let clearIntervalSpy: { mockRestore: () => void };

function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: platform });
}

function getGSettingsKey(args: string[]): string {
    return args[2] ?? "";
}

function getRegistryValueName(args: string[]): string {
    return args[3] ?? "";
}

function getConfigPath(): string {
    return path.join(testHome, ".pi", "agent", "system-theme.json");
}

async function clearConfig(): Promise<void> {
    await rm(path.join(testHome, ".pi"), { recursive: true, force: true });
}

async function writeConfig(config: Record<string, unknown>): Promise<void> {
    const configPath = getConfigPath();
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 4)}\n`, "utf8");
}

async function createExtensionRuntime(): Promise<{ sessionStart: SessionStartHandler }> {
    const { default: systemThemeExtension } = await import("./index.js");

    let sessionStartHandler: SessionStartHandler | undefined;

    const pi = {
        on: (event: string, handler: SessionStartHandler) => {
            if (event === "session_start") {
                sessionStartHandler = handler;
            }
        },
        registerCommand: () => undefined,
    };

    systemThemeExtension(pi as never);

    if (!sessionStartHandler) {
        throw new Error("session_start handler was not registered");
    }

    return {
        sessionStart: sessionStartHandler,
    };
}

type CreateContextOptions = {
    hasUI?: boolean;
    themeName?: string;
    themes?: string[];
};

type CreatedContext = {
    ctx: TestContext;
    setThemeMock: ReturnType<typeof vi.fn>;
    notifyMock: ReturnType<typeof vi.fn>;
};

function createContext(options?: CreateContextOptions): CreatedContext {
    const hasUI = options?.hasUI ?? true;
    const theme = { name: options?.themeName ?? "dark" };
    const themes = options?.themes ?? ["dark", "light", "rose-pine", "rose-pine-dawn"];

    const notifyMock = vi.fn();
    const setThemeMock = vi.fn((nextTheme: string) => {
        theme.name = nextTheme;
        return { success: true };
    });

    const ctx: TestContext = {
        hasUI,
        ui: {
            theme,
            getAllThemes: () => themes.map((name) => ({ name })),
            setTheme: setThemeMock,
            notify: notifyMock,
        },
    };

    return {
        ctx,
        setThemeMock,
        notifyMock,
    };
}

beforeAll(async () => {
    testHome = await mkdtemp(path.join(os.tmpdir(), "pi-system-theme-test-"));
    process.env.HOME = testHome;
});

beforeEach(async () => {
    execFileAsyncMock.mockReset();
    execFileAsyncMock.mockImplementation(async (file) => {
        throw new Error(`Unexpected command: ${file}`);
    });

    await clearConfig();
    setPlatform(originalPlatform);

    setIntervalSpy = vi
        .spyOn(globalThis, "setInterval")
        .mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>);

    clearIntervalSpy = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);
});

afterEach(() => {
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
});

afterAll(async () => {
    await clearConfig();
    await rm(testHome, { recursive: true, force: true });

    if (originalHome === undefined) {
        delete process.env.HOME;
    } else {
        process.env.HOME = originalHome;
    }

    setPlatform(originalPlatform);
});

describe("pi-system-theme", () => {
    it("stays idle when UI is not available", async () => {
        setPlatform("darwin");

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock, notifyMock } = createContext({ hasUI: false });

        await sessionStart({}, ctx);

        expect(execFileAsyncMock).not.toHaveBeenCalled();
        expect(setThemeMock).not.toHaveBeenCalled();
        expect(notifyMock).not.toHaveBeenCalled();
    });

    it("does not override a custom theme when using default dark/light mapping", async () => {
        setPlatform("darwin");

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock, notifyMock } = createContext({ themeName: "rose-pine" });

        await sessionStart({}, ctx);
        await sessionStart({}, ctx);

        expect(execFileAsyncMock).not.toHaveBeenCalled();
        expect(setThemeMock).not.toHaveBeenCalled();
        expect(notifyMock).toHaveBeenCalledTimes(1);
        expect(String(notifyMock.mock.calls[0][0])).toContain("custom");
    });

    it("syncs even from a custom theme when explicit dark/light overrides are configured", async () => {
        setPlatform("darwin");

        await writeConfig({
            darkTheme: "rose-pine",
            lightTheme: "rose-pine-dawn",
        });

        execFileAsyncMock.mockImplementation(async (file) => {
            if (file !== "/usr/bin/defaults") {
                throw new Error(`Unexpected command: ${file}`);
            }

            return { stdout: "Dark\n" };
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock, notifyMock } = createContext({ themeName: "my-custom-theme" });

        await sessionStart({}, ctx);

        expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
        expect(setThemeMock).toHaveBeenCalledWith("rose-pine");
        expect(notifyMock).not.toHaveBeenCalled();
    });

    it("detects Linux appearance from GNOME color-scheme", async () => {
        setPlatform("linux");

        execFileAsyncMock.mockImplementation(async (file, args) => {
            if (file !== "gsettings") {
                throw new Error(`Unexpected command: ${file}`);
            }

            const key = getGSettingsKey(args);
            if (key === "color-scheme") {
                return { stdout: "'prefer-light'\n" };
            }

            throw new Error(`Unexpected gsettings key: ${key}`);
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "dark" });

        await sessionStart({}, ctx);

        expect(setThemeMock).toHaveBeenCalledWith("light");
        expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to gtk-theme detection on Linux", async () => {
        setPlatform("linux");

        execFileAsyncMock.mockImplementation(async (file, args) => {
            if (file !== "gsettings") {
                throw new Error(`Unexpected command: ${file}`);
            }

            const key = getGSettingsKey(args);
            if (key === "color-scheme") {
                return { stdout: "'default'\n" };
            }

            if (key === "gtk-theme") {
                return { stdout: "'Adwaita-dark'\n" };
            }

            throw new Error(`Unexpected gsettings key: ${key}`);
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "light" });

        await sessionStart({}, ctx);

        expect(execFileAsyncMock).toHaveBeenCalledTimes(2);
        expect(setThemeMock).toHaveBeenCalledWith("dark");
    });

    it("detects Windows dark appearance from AppsUseLightTheme=0x0", async () => {
        setPlatform("win32");

        execFileAsyncMock.mockImplementation(async (file, args) => {
            if (file !== "reg") {
                throw new Error(`Unexpected command: ${file}`);
            }

            const valueName = getRegistryValueName(args);
            if (valueName !== "AppsUseLightTheme") {
                throw new Error(`Unexpected registry value name: ${valueName}`);
            }

            return {
                stdout: "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\n    AppsUseLightTheme    REG_DWORD    0x0\n",
            };
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "light" });

        await sessionStart({}, ctx);

        expect(setThemeMock).toHaveBeenCalledWith("dark");
        expect(execFileAsyncMock).toHaveBeenCalledTimes(1);
    });

    it("detects Windows light appearance from AppsUseLightTheme=0x1", async () => {
        setPlatform("win32");

        execFileAsyncMock.mockImplementation(async (file) => {
            if (file !== "reg") {
                throw new Error(`Unexpected command: ${file}`);
            }

            return {
                stdout: "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize\n    AppsUseLightTheme    REG_DWORD    0x1\n",
            };
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "dark" });

        await sessionStart({}, ctx);

        expect(setThemeMock).toHaveBeenCalledWith("light");
    });

    it("does not change theme when Windows registry query fails", async () => {
        setPlatform("win32");

        execFileAsyncMock.mockRejectedValue(new Error("reg query failed"));

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "dark" });

        await sessionStart({}, ctx);

        expect(setThemeMock).not.toHaveBeenCalled();
    });

    it("treats missing AppleInterfaceStyle as light mode on macOS", async () => {
        setPlatform("darwin");

        execFileAsyncMock.mockRejectedValue({
            stderr: "The domain/default pair of (kCFPreferencesAnyApplication, AppleInterfaceStyle) does not exist",
        });

        const { sessionStart } = await createExtensionRuntime();
        const { ctx, setThemeMock } = createContext({ themeName: "dark" });

        await sessionStart({}, ctx);

        expect(setThemeMock).toHaveBeenCalledWith("light");
    });
});
