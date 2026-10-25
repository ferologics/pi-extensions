import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { JobRunner } from "./runner.js";

function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

/** Host headers that name this server: its listen address, plus `localhost` when it listens on loopback. */
function hostHeaders(host: string, port: number): Set<string> {
    const address = host.includes(":") ? `[${host}]` : host;
    const hosts = new Set([`${address}:${port}`.toLowerCase()]);
    if (host === "127.0.0.1" || host === "::1") hosts.add(`localhost:${port}`);
    return hosts;
}

/**
 * Refuse browser traffic: a page in any browser can send simple requests to a local port, and DNS rebinding can
 * make it same-origin. Browsers send Origin on cross-origin and on non-GET requests and cannot fake Host, so the
 * API answers only clients without an Origin that addressed this server by its own name.
 */
function rejection(req: IncomingMessage, hosts: Set<string>): string | undefined {
    if (req.headers.origin !== undefined) return "requests with an Origin header are not allowed";
    if (!hosts.has((req.headers.host ?? "").toLowerCase())) return `unexpected Host header "${req.headers.host ?? ""}"`;
    return undefined;
}

async function route(runner: JobRunner, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") return send(res, 404, { error: "not found" });
    const [, resource, name, action] = parts;

    if (req.method === "GET" && resource === "health") return send(res, 200, { ok: true, pid: process.pid });
    if (req.method === "GET" && resource === "jobs" && !name) return send(res, 200, await runner.list());
    if (req.method === "GET" && resource === "jobs" && name && !action) {
        const detail = await runner.detail(decodeURIComponent(name));
        return detail ? send(res, 200, detail) : send(res, 404, { error: `unknown job "${name}"` });
    }
    if (req.method === "POST" && resource === "jobs" && name && action === "run") {
        return send(res, 202, await runner.submit(decodeURIComponent(name), "manual"));
    }
    if (req.method === "GET" && resource === "inbox") return send(res, 200, await runner.inbox());
    if (req.method === "POST" && resource === "inbox" && name === "read") {
        return send(res, 200, { marked: await runner.markInboxRead() });
    }
    send(res, 404, { error: "not found" });
}

export function startServer(runner: JobRunner, host: string, port: number, log: (message: string) => void): Server {
    const hosts = hostHeaders(host, port);
    const server = createServer((req, res) => {
        const reason = rejection(req, hosts);
        if (reason) {
            log(`rejected ${req.method} ${req.url}: ${reason}`);
            return send(res, 403, { error: reason });
        }
        route(runner, req, res).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            log(`${req.method} ${req.url}: ${message}`);
            send(res, message.startsWith("unknown job") ? 404 : 500, { error: message });
        });
    });
    server.listen(port, host, () => log(`listening on http://${host}:${port}`));
    return server;
}
