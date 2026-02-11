import type { ContextPackOmissionReason, ContextPackOptions } from "./types.js";

export interface FilterDecision {
    include: boolean;
    reason?: ContextPackOmissionReason;
}

const ALLOWED_EXTENSIONS = new Set([
    ".rs",
    ".zig",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cc",
    ".hh",
    ".m",
    ".mm",
    ".swift",
    ".kt",
    ".kts",
    ".java",
    ".py",
    ".go",
    ".rb",
    ".php",
    ".cs",
    ".fs",
    ".lua",
    ".r",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".svelte",
    ".vue",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".html",
    ".htm",
    ".svg",
    ".xml",
    ".xsd",
    ".xsl",
    ".json",
    ".jsonc",
    ".toml",
    ".yaml",
    ".yml",
    ".ini",
    ".cfg",
    ".conf",
    ".properties",
    ".md",
    ".mdx",
    ".rst",
    ".txt",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".proto",
    ".tf",
    ".tfvars",
    ".cmake",
    ".gradle",
]);

const EXPLICIT_INCLUDE_BASENAMES = new Set([
    "Dockerfile",
    "Containerfile",
    "Makefile",
    "GNUmakefile",
    "justfile",
    "Justfile",
    "Procfile",
    "Brewfile",
    "Gemfile",
    "Rakefile",
    "Vagrantfile",
    "CMakeLists.txt",
    "meson.build",
    "meson_options.txt",
    "BUILD",
    "BUILD.bazel",
    "WORKSPACE",
    "WORKSPACE.bazel",
    "MODULE.bazel",
    "Jenkinsfile",
    "Tiltfile",
    "Podfile",
    "Cartfile",
    "Fastfile",
    "flake.nix",
    "default.nix",
    "shell.nix",
    "Taskfile",
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
    ".dockerignore",
    ".npmrc",
    ".nvmrc",
    ".prettierignore",
    ".prettierrc",
    ".eslintignore",
    ".tool-versions",
    ".python-version",
    ".ruby-version",
    ".node-version",
    ".terraform.lock.hcl",
]);

const HARD_EXCLUDED_SEGMENTS = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "prompt",
    "dist",
    "build",
    "target",
    "out",
    "coverage",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    ".parcel-cache",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".terraform",
    ".direnv",
    ".gradle",
    ".idea",
]);

function normalizePath(input: string): string {
    return input.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function pathSegments(input: string): string[] {
    return normalizePath(input).split("/").filter(Boolean);
}

function basename(input: string): string {
    const segments = pathSegments(input);
    return segments.length > 0 ? segments[segments.length - 1] : normalizePath(input);
}

function fileExtension(input: string): string {
    const base = basename(input);
    const index = base.lastIndexOf(".");
    return index >= 0 ? base.slice(index).toLowerCase() : "";
}

function isAllowedExtension(input: string): boolean {
    return ALLOWED_EXTENSIONS.has(fileExtension(input));
}

function isExplicitInclude(input: string): boolean {
    const base = basename(input);

    if (EXPLICIT_INCLUDE_BASENAMES.has(base)) {
        return true;
    }

    return (
        base.startsWith("Procfile.") ||
        base.startsWith("Gemfile.") ||
        base.startsWith("Rakefile.") ||
        base === "google-services.json" ||
        base === "GoogleService-Info.plist"
    );
}

function isLockfile(input: string): boolean {
    const normalized = normalizePath(input);
    const base = basename(normalized);

    return (
        base === "pnpm-lock.yaml" ||
        base === "package-lock.json" ||
        base === "yarn.lock" ||
        base === "bun.lock" ||
        base === "bun.lockb" ||
        base === "npm-shrinkwrap.json" ||
        base === "Cargo.lock" ||
        base === "composer.lock" ||
        base === "Gemfile.lock" ||
        base === "poetry.lock" ||
        base === "Pipfile.lock" ||
        normalized.endsWith("/.terraform.lock.hcl") ||
        normalized === ".terraform.lock.hcl"
    );
}

function isEnvPath(input: string): boolean {
    const normalized = normalizePath(input);
    const base = basename(normalized);

    return base === ".env" || base.startsWith(".env.") || base === ".envrc";
}

function isSecretPath(input: string): boolean {
    const normalized = normalizePath(input);
    const base = basename(normalized).toLowerCase();

    if (
        normalized === ".npmrc" ||
        normalized.endsWith("/.npmrc") ||
        normalized === ".pypirc" ||
        normalized.endsWith("/.pypirc") ||
        normalized === ".netrc" ||
        normalized.endsWith("/.netrc") ||
        normalized.endsWith("/.aws/credentials") ||
        normalized.endsWith("/.aws/config") ||
        normalized.endsWith("/.gem/credentials")
    ) {
        return true;
    }

    if (
        base === "id_rsa" ||
        base === "id_dsa" ||
        base === "id_ecdsa" ||
        base === "id_ed25519" ||
        base === "google-services.json" ||
        base === "googleservice-info.plist"
    ) {
        return true;
    }

    if (
        base.endsWith(".pem") ||
        base.endsWith(".key") ||
        base.endsWith(".p12") ||
        base.endsWith(".pfx") ||
        base.endsWith(".jks") ||
        base.endsWith(".keystore") ||
        base.endsWith(".kdbx") ||
        base.endsWith(".pkcs12") ||
        base.endsWith(".der") ||
        base.endsWith(".crt") ||
        base.endsWith(".cer") ||
        base.endsWith(".csr") ||
        base.endsWith(".mobileprovision") ||
        base.endsWith(".provisionprofile")
    ) {
        return true;
    }

    return base.includes("service-account") || base.includes("serviceaccount");
}

function isDocsPath(input: string): boolean {
    const segments = pathSegments(input).map((segment) => segment.toLowerCase());
    return segments.includes("docs") || segments.includes("doc") || segments.includes("documentation");
}

function isTestPath(input: string): boolean {
    const normalized = normalizePath(input).toLowerCase();
    const segments = normalized.split("/");

    if (segments.includes("__tests__") || segments.includes("test") || segments.includes("tests")) {
        return true;
    }

    const base = basename(normalized);

    return base.includes(".test.") || base.includes(".spec.") || base.includes("_test.") || base.startsWith("test_");
}

function isHardExcludedPath(input: string): boolean {
    const normalized = normalizePath(input);
    const lowerSegments = pathSegments(normalized).map((segment) => segment.toLowerCase());

    if (lowerSegments.some((segment) => HARD_EXCLUDED_SEGMENTS.has(segment))) {
        return true;
    }

    if (normalized.includes(".egg-info/")) {
        return true;
    }

    const base = basename(normalized);

    if (base === ".DS_Store") {
        return true;
    }

    const lower = normalized.toLowerCase();
    return lower.includes("chatgpt_code_dump") || lower.includes("code-dump");
}

function makeOmitted(reason: ContextPackOmissionReason): FilterDecision {
    return {
        include: false,
        reason,
    };
}

function evaluateCommonPath(
    path: string,
    options: ContextPackOptions,
    includeDocs: boolean,
    includeTests: boolean,
): FilterDecision {
    if (isHardExcludedPath(path)) {
        return makeOmitted("filtered:generated-cache");
    }

    if (!options.includeEnv && isEnvPath(path)) {
        return makeOmitted("filtered:env");
    }

    if (!options.includeSecrets && isSecretPath(path)) {
        return makeOmitted("filtered:secret");
    }

    if (!options.includeLockfiles && isLockfile(path)) {
        return makeOmitted("filtered:lockfile");
    }

    if (!includeDocs && isDocsPath(path)) {
        return makeOmitted("filtered:docs");
    }

    if (!includeTests && isTestPath(path)) {
        return makeOmitted("filtered:tests");
    }

    return { include: true };
}

export function evaluateChangedFile(filePath: string, options: ContextPackOptions): FilterDecision {
    const common = evaluateCommonPath(filePath, options, true, true);
    if (!common.include) {
        return common;
    }

    // For changed files, be permissive and let binary probing decide later.
    return { include: true };
}

export function evaluateRelatedFile(filePath: string, options: ContextPackOptions): FilterDecision {
    const common = evaluateCommonPath(filePath, options, options.includeDocs, options.includeTests);
    if (!common.include) {
        return common;
    }

    if (isExplicitInclude(filePath) || isAllowedExtension(filePath)) {
        return { include: true };
    }

    // Keep recall broad for related files as well; binary probing happens later.
    return { include: true };
}
