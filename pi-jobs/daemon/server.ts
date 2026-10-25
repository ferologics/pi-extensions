import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { JobRunner } from "./runner.js";

function send(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
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
    const server = createServer((req, res) => {
        route(runner, req, res).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            log(`${req.method} ${req.url}: ${message}`);
            send(res, message.startsWith("unknown job") ? 404 : 500, { error: message });
        });
    });
    server.listen(port, host, () => log(`listening on http://${host}:${port}`));
    return server;
}
