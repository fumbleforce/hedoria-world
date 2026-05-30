/**
 * Elegant leveled + channeled diagnostics.
 *
 *  - Browser: grouped, color-coded console output you can scan or filter.
 *  - Terminal: every record is POSTed to the dev-server `/__diag-log` sink,
 *    which echoes a compact line to the Vite console and appends JSONL to
 *    logs/events.jsonl.
 *
 * Usage:
 *   diag.info("round", "round started", { round: 4 });
 *   diag.llm("evaluator", "verdict", { tags, intensity });
 *   diag.group("action", "Banter", () => { ...nested logs... });
 */

export type DiagLevel = "debug" | "info" | "warn" | "error";
export type DiagChannel =
  | "boot"
  | "round"
  | "action"
  | "evaluator"
  | "resolver"
  | "llm"
  | "chat"
  | "narrator"
  | "event"
  | "economy"
  | "world";

const CHANNEL_COLOR: Record<DiagChannel, string> = {
  boot: "#9b93ad",
  round: "#74c0fc",
  action: "#ffd43b",
  evaluator: "#b079ff",
  resolver: "#ff9ec4",
  llm: "#63e6be",
  chat: "#8ce99a",
  narrator: "#ffa94d",
  event: "#ff6b6b",
  economy: "#8ce99a",
  world: "#9b93ad",
};

const LEVEL_RANK: Record<DiagLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

interface DiagConfig {
  /** Minimum level printed to the browser console. */
  consoleLevel: DiagLevel;
  /** Mirror records to the dev-server terminal sink. */
  toServer: boolean;
  /** Channels to mute (still sent to server). */
  muted: Set<DiagChannel>;
}

const config: DiagConfig = {
  consoleLevel: "debug",
  toServer: true,
  muted: new Set(),
};

let seq = 0;

function ts(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(
    d.getMilliseconds(),
    3,
  )}`;
}
function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function sendToServer(record: object): void {
  if (!config.toServer) return;
  void fetch("/__diag-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  }).catch(() => {
    /* dev-only sink; production 404s and we swallow */
  });
}

function emit(
  level: DiagLevel,
  channel: DiagChannel,
  message: string,
  data?: Record<string, unknown>,
): void {
  seq += 1;
  const record = {
    seq,
    ts: new Date().toISOString(),
    level,
    channel,
    message,
    ...(data ? { data } : {}),
  };
  sendToServer(record);

  if (LEVEL_RANK[level] < LEVEL_RANK[config.consoleLevel]) return;
  if (config.muted.has(channel)) return;

  const color = CHANNEL_COLOR[channel];
  const tag = `%c${ts()} %c${channel}`;
  const tagStyle = "color:#6b6478";
  const chanStyle = `color:${color};font-weight:700`;
  const fn =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : level === "debug"
          ? console.debug
          : console.log;

  if (data && Object.keys(data).length > 0) {
    fn(`${tag} %c${message}`, tagStyle, chanStyle, "color:inherit", data);
  } else {
    fn(`${tag} %c${message}`, tagStyle, chanStyle, "color:inherit");
  }
}

export const diag = {
  debug: (c: DiagChannel, m: string, d?: Record<string, unknown>) => emit("debug", c, m, d),
  info: (c: DiagChannel, m: string, d?: Record<string, unknown>) => emit("info", c, m, d),
  warn: (c: DiagChannel, m: string, d?: Record<string, unknown>) => emit("warn", c, m, d),
  error: (c: DiagChannel, m: string, d?: Record<string, unknown>) => emit("error", c, m, d),

  /** Group related logs under a collapsible header in the browser console. */
  group<T>(channel: DiagChannel, label: string, fn: () => T): T {
    const color = CHANNEL_COLOR[channel];
    const muted = config.muted.has(channel);
    if (!muted) {
      console.groupCollapsed(
        `%c${ts()} %c${channel}%c ${label}`,
        "color:#6b6478",
        `color:${color};font-weight:700`,
        "color:inherit",
      );
    }
    try {
      return fn();
    } finally {
      if (!muted) console.groupEnd();
    }
  },

  configure(patch: Partial<Omit<DiagConfig, "muted">> & { muted?: DiagChannel[] }) {
    if (patch.consoleLevel) config.consoleLevel = patch.consoleLevel;
    if (typeof patch.toServer === "boolean") config.toServer = patch.toServer;
    if (patch.muted) config.muted = new Set(patch.muted);
  },
};

// Expose for live console tweaking: `__diag.configure({ consoleLevel: 'warn' })`.
(globalThis as Record<string, unknown>).__diag = diag;
