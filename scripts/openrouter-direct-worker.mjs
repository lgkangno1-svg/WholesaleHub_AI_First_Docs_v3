import fs from "node:fs";

const started = Date.now();
const authPath = `${process.env.HOME}/.local/share/opencode/auth.json`;
const endpoint = "https://openrouter.ai/api/v1/chat/completions";

function finish(result, exitCode = 0) {
  const safe = { ...result, duration_ms: Date.now() - started };
  process.stdout.write(`${JSON.stringify(safe)}\n`);
  process.exit(exitCode);
}

let auth;
try {
  auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
} catch {
  finish({ success: false, result: "AUTH_STORE_UNSUPPORTED", http_status: null }, 70);
}

const credential = auth?.openrouter;
if (credential?.type !== "api" || typeof credential.key !== "string" || credential.key.length < 8) {
  finish({ success: false, result: "AUTH_STORE_UNSUPPORTED", http_status: null }, 70);
}

let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "xiaomi/mimo-v2.5",
      messages: [{ role: "user", content: "Reply with exactly: PONG" }],
      provider: {
        data_collection: "deny",
        zdr: true,
        require_parameters: true,
        allow_fallbacks: false,
      },
      temperature: 0,
      max_tokens: 16,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
} catch (error) {
  const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
  finish({ success: false, result: timeout ? "TIMEOUT" : "NO_RESPONSE", http_status: null }, 71);
}

if (!response.ok) {
  finish({ success: false, result: "HTTP_ERROR", http_status: response.status }, 72);
}

let payload;
try {
  payload = await response.json();
} catch {
  finish({ success: false, result: "NO_RESPONSE", http_status: response.status }, 73);
}

const content = payload?.choices?.[0]?.message?.content?.trim();
const success = content === "PONG";
finish({
  success,
  result: success ? "PASS" : "NO_RESPONSE",
  http_status: response.status,
  response: typeof content === "string" ? content.slice(0, 100) : null,
  usage: payload?.usage ?? null,
}, success ? 0 : 74);
