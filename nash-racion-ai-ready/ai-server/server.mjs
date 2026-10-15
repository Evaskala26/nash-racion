import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
function loadDotEnv(file) {
  try {
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const at = line.indexOf("=");
      if (at < 1) continue;
      const key = line.slice(0, at).trim();
      const value = line.slice(at + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (_) {}
}
loadDotEnv(path.join(here, ".env"));

const port = Number(process.env.PORT || 8787);
const hermesUrl = process.env.HERMES_URL || "http://127.0.0.1:8642/v1/chat/completions";
const hermesKey = process.env.HERMES_API_KEY || "";
const origins = new Set((process.env.ALLOWED_ORIGINS || "https://evaskala26.github.io,http://localhost:3000,http://127.0.0.1:5500,http://localhost:5500").split(",").map(x => x.trim()).filter(Boolean));
const maxBody = 8000000;

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && origins.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}
function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBody) { reject(new Error("request_too_large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (_) { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20) throw new Error("messages_invalid");
  for (const item of messages) {
    if (!item || !["system", "user", "assistant"].includes(item.role)) throw new Error("message_role_invalid");
    const content = item.content;
    if (typeof content === "string" && content.length <= 60000) continue;
    if (Array.isArray(content) && content.length <= 8 && content.every(part => part?.type === "text" || part?.type === "image_url")) continue;
    throw new Error("message_content_invalid");
  }
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
  if (req.method === "GET" && req.url === "/healthz") { send(res, 200, { ok: true }); return; }
  if (req.method !== "POST" || req.url !== "/chat") { send(res, 404, { error: "not_found" }); return; }
  if (!hermesKey) { send(res, 503, { error: "HERMES_API_KEY is not configured" }); return; }
  const requestId = randomUUID();
  const started = Date.now();
  try {
    const body = await readJson(req);
    validateMessages(body.messages);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    let upstream;
    try {
      upstream = await fetch(hermesUrl, {
        method: "POST",
        headers: { "Authorization": `Bearer ${hermesKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "hermes-agent", messages: body.messages, stream: false }),
        signal: controller.signal
      });
    } finally { clearTimeout(timer); }
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.warn(`[${requestId}] Hermes ${upstream.status} in ${Date.now() - started}ms`);
      send(res, 502, { error: "Hermes request failed", status: upstream.status });
      return;
    }
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string") { send(res, 502, { error: "Hermes returned no text" }); return; }
    console.log(`[${requestId}] ok in ${Date.now() - started}ms`);
    send(res, 200, { answer });
  } catch (error) {
    const message = error?.name === "AbortError" ? "Hermes request timed out" : error.message;
    console.warn(`[${requestId}] ${message}`);
    send(res, 400, { error: message || "request_failed" });
  }
});

server.listen(port, "127.0.0.1", () => console.log(`Наш рацион AI bridge: http://127.0.0.1:${port}`));
