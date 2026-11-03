import { chmodSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server } from "node:net";

/** Who sent a message, as the receiver shows it. */
export interface Sender {
    sessionId?: string;
    label?: string;
    project?: string;
}

export type Request =
    | { type: "send"; message: string; mode?: "steer" | "follow_up"; from?: Sender }
    | { type: "priority"; priority: 0 | 1 | 2 | 3 | null };

export type Response = { ok: true; data?: unknown } | { ok: false; error: string };

export type Handler = (request: Request) => Response | Promise<Response>;

function parseRequest(line: string): Request {
    const request = JSON.parse(line) as Request;
    if (request?.type === "send" && typeof request.message === "string" && request.message.trim()) return request;
    if (request?.type === "priority" && (request.priority === null || [0, 1, 2, 3].includes(request.priority))) {
        return request;
    }
    throw new Error("unknown request");
}

/** Listen for newline-delimited JSON requests on a Unix socket only this user can open. */
export async function listen(path: string, handler: Handler): Promise<Server> {
    try {
        unlinkSync(path);
    } catch {}
    const server = createServer((socket) => {
        socket.setEncoding("utf8");
        let buffer = "";
        socket.on("data", (chunk) => {
            buffer += chunk;
            for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                void (async () => {
                    let response: Response;
                    try {
                        response = await handler(parseRequest(line));
                    } catch (error) {
                        response = { ok: false, error: error instanceof Error ? error.message : String(error) };
                    }
                    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
                })();
            }
        });
        socket.on("error", () => {});
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => {
            server.off("error", reject);
            resolve();
        });
    });
    chmodSync(path, 0o600);
    return server;
}

export function close(server: Server, path: string): Promise<void> {
    return new Promise((resolve) => {
        server.close(() => resolve());
        try {
            unlinkSync(path);
        } catch {}
    });
}

/** Send one request and wait for its response. */
export function request(path: string, payload: Request, timeoutMs = 5000): Promise<Response> {
    return new Promise((resolve, reject) => {
        const socket = createConnection(path);
        socket.setEncoding("utf8");
        const timer = setTimeout(() => socket.destroy(new Error("timed out")), timeoutMs);
        let buffer = "";
        socket.on("connect", () => socket.write(`${JSON.stringify(payload)}\n`));
        socket.on("data", (chunk) => {
            buffer += chunk;
            const newline = buffer.indexOf("\n");
            if (newline === -1) return;
            clearTimeout(timer);
            socket.end();
            try {
                resolve(JSON.parse(buffer.slice(0, newline)) as Response);
            } catch (error) {
                reject(error);
            }
        });
        socket.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
