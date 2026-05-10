/**
 * Lightweight diagnostic logger for the engine.
 *
 * Every event is mirrored to two sinks:
 *
 *   1. The browser console (`console.{debug,info,warn,error}`) so you see
 *      flow live while interacting with the UI.
 *   2. A dev-only POST to `/__diag-log`, where the Vite middleware in
 *      `vite.config.ts` appends one JSON line per event to
 *      `engine/logs/events.jsonl`. Tail it with:
 *
 *        tail -F engine/logs/events.jsonl | jq -c '{ts,channel,level,message}'
 *
 *      The full text-LLM prompt/response pairs continue to live in their
 *      own file `engine/logs/llm-prompts.jsonl` (via `/__llm-log`) so the
 *      events file stays readable; the events file references each LLM
 *      call by `promptHash` so you can join the two streams.
 *
 * Production builds simply 404 the endpoint and the fetch promise is
 * swallowed — logs are a dev-only feature.
 */

export type DiagLevel = "debug" | "info" | "warn" | "error";

export type DiagEvent = {
  ts: string;
  level: DiagLevel;
  channel: string;
  message: string;
  data?: Record<string, unknown>;
};

const ENDPOINT = "/__diag-log";
const POST_ENABLED = typeof window !== "undefined";
const CONSOLE_ENABLED = typeof console !== "undefined";

/**
 * Channels we emit on. Keep this list short — channel-per-subsystem makes
 * `jq 'select(.channel=="image")'` queries easy.
 */
export type DiagChannel =
  | "boot"
  | "llm"
  | "image"
  | "tile-grid"
  | "narrator"
  | "scene"
  | "store"
  | "world";

function postEvent(event: DiagEvent): void {
  if (!POST_ENABLED) return;
  void fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
    keepalive: true,
  }).catch(() => {
    // Dev-only sink; ignore network errors and production 404s.
  });
}

function consoleEvent(event: DiagEvent): void {
  if (!CONSOLE_ENABLED) return;
  const tag = `[${event.channel}]`;
  const fn =
    event.level === "debug"
      ? console.debug
      : event.level === "warn"
        ? console.warn
        : event.level === "error"
          ? console.error
          : console.info;
  if (event.data && Object.keys(event.data).length > 0) {
    fn.call(console, tag, event.message, event.data);
  } else {
    fn.call(console, tag, event.message);
  }
}

function emit(
  level: DiagLevel,
  channel: DiagChannel,
  message: string,
  data?: Record<string, unknown>,
): void {
  const event: DiagEvent = {
    ts: new Date().toISOString(),
    level,
    channel,
    message,
    ...(data ? { data: sanitize(data) } : {}),
  };
  consoleEvent(event);
  postEvent(event);
}

/**
 * Best-effort sanitiser for the data payload. We don't want to:
 *   - serialise huge Uint8Array tile-image bytes (just record length)
 *   - serialise blob URLs as opaque objects (record the URL string)
 *   - trip on circular refs (catch & truncate)
 *   - lose Error stacks (turn them into { name, message, stack } objects)
 */
function sanitize(input: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(input, replacer)) as Record<string, unknown>;
  } catch {
    return { __unserializable: String(input) };
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __bytes: value.byteLength };
  }
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === "string" && value.length > 4000) {
    return `${value.slice(0, 4000)}…[+${value.length - 4000} chars]`;
  }
  return value;
}

export const diag = {
  debug(channel: DiagChannel, message: string, data?: Record<string, unknown>) {
    emit("debug", channel, message, data);
  },
  info(channel: DiagChannel, message: string, data?: Record<string, unknown>) {
    emit("info", channel, message, data);
  },
  warn(channel: DiagChannel, message: string, data?: Record<string, unknown>) {
    emit("warn", channel, message, data);
  },
  error(channel: DiagChannel, message: string, data?: Record<string, unknown>) {
    emit("error", channel, message, data);
  },
};
