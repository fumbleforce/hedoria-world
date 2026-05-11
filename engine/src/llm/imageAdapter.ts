import { useStore } from "../state/store";
import { defaultGeminiImageModel } from "./geminiModelOptions";

export type ImageProviderConfig = {
  id: string;
  endpoint: string;
  apiKey?: string;
  model: string;
};

export type ImageRequest = {
  prompt: string;
  width?: number;
  height?: number;
  /** Provider-agnostic hint passed through to the backend. */
  variant?: string;
};

export type ImageResponse = {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
};

let liveImageActivitySeq = 0;

export interface ImageProvider {
  readonly id: string;
  generate(request: ImageRequest): Promise<ImageResponse>;
}

export class HttpImageProvider implements ImageProvider {
  readonly id: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(config: ImageProviderConfig) {
    this.id = config.id;
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    const width = request.width ?? 512;
    const height = request.height ?? 512;
    const activityId = `image-http:${++liveImageActivitySeq}`;
    useStore
      .getState()
      .setBackgroundActivity(activityId, `Image · ${width}×${height}px (${this.id})`);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          prompt: request.prompt,
          width,
          height,
          variant: request.variant,
        }),
      });
      if (!response.ok) {
        throw new Error(`image provider ${this.id} failed: ${response.status}`);
      }
      const payload = (await response.json()) as {
        base64: string;
        mime?: string;
        width?: number;
        height?: number;
      };
      return {
        bytes: base64ToBytes(payload.base64),
        mime: payload.mime ?? "image/png",
        width: payload.width ?? width,
        height: payload.height ?? height,
      };
    } finally {
      useStore.getState().setBackgroundActivity(activityId, null);
    }
  }
}

/**
 * Direct-to-Google Gemini image provider. Calls the Generative Language REST
 * API from the browser using an API key embedded in the URL.
 *
 * Same dev-only caveats as the text provider in `./providers.ts`: the key
 * ships in the browser bundle. Fine for personal/dev use, NOT safe for a
 * public deployment.
 */
/**
 * Quota / 429 cooldown for the image API. Same rationale as the text provider
 * in `./providers.ts` — when Google returns 429 we record a "do not call
 * before X" timestamp and short-circuit subsequent calls inside that window
 * with a typed RateLimitedImageError.
 */
const IMAGE_DEFAULT_COOLDOWN_MS = 60_000;
const IMAGE_MAX_COOLDOWN_MS = 5 * 60_000;

export class RateLimitedImageError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "RateLimitedImageError";
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryDelay(errorBody: string): number | null {
  const match = /retryDelay"?\s*:\s*"(\d+(?:\.\d+)?)(ms|s)?"/u.exec(errorBody);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return match[2] === "ms" ? n : n * 1000;
}

/**
 * Hard timeout for a single image-API round-trip. Gemini occasionally
 * hangs without ever returning bytes or an HTTP error — without an
 * AbortController-driven cap the request would stall forever, leaving
 * the tile cache with a pending promise the player has no way to
 * recover from short of a page reload. Two minutes is generous enough
 * for the slowest mosaic request we've observed (~110s for a 256² tile,
 * ~35s for a 1280² mosaic) and short enough that a wedged call gets
 * caught and the cell falls through to its placeholder so the redraw
 * button can retry.
 *
 * Overridable via `VITE_GEMINI_IMAGE_TIMEOUT_MS` in `engine/.env` for
 * users on slow links who want to wait longer.
 */
const IMAGE_REQUEST_TIMEOUT_MS = (() => {
  const raw = (import.meta as { env?: Record<string, string | undefined> })
    ?.env?.VITE_GEMINI_IMAGE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 120_000;
})();

export class ImageTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageTimeoutError";
  }
}

/**
 * Gemini image generation only accepts these aspect_ratio tokens (not raw
 * pixel pairs like "1024:576"). See INVALID_ARGUMENT on image_config.aspect_ratio.
 */
const GEMINI_IMAGE_ASPECT_RATIOS = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
] as const;

function gcdPair(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Map requested pixel size to the closest allowed aspect_ratio token (Gemini /
 * OpenRouter image_config share the same ratio set for Google image models).
 */
export function aspectRatioTokenForPixelSize(width: number, height: number): string {
  if (width <= 0 || height <= 0) return "1:1";
  const g = gcdPair(width, height);
  const sw = Math.round(width / g);
  const sh = Math.round(height / g);
  const simplified = `${sw}:${sh}`;
  if ((GEMINI_IMAGE_ASPECT_RATIOS as readonly string[]).includes(simplified)) {
    return simplified;
  }
  const target = width / height;
  let best: (typeof GEMINI_IMAGE_ASPECT_RATIOS)[number] = "1:1";
  let bestScore = Infinity;
  for (const ar of GEMINI_IMAGE_ASPECT_RATIOS) {
    const [aw, ah] = ar.split(":").map((n) => Number(n));
    if (!aw || !ah) continue;
    const r = aw / ah;
    const score = Math.abs(Math.log(target) - Math.log(r));
    if (score < bestScore) {
      bestScore = score;
      best = ar;
    }
  }
  return best;
}

export class GeminiImageProvider implements ImageProvider {
  readonly id: string;
  private readonly apiKey: string;
  private readonly model: string;
  private cooldownUntil = 0;

  constructor(apiKey: string, model: string) {
    this.id = model;
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    const now = Date.now();
    if (this.cooldownUntil > now) {
      throw new RateLimitedImageError(
        `Gemini image API in cooldown after a previous 429 (${this.model}); skipping for ${Math.ceil(
          (this.cooldownUntil - now) / 1000,
        )}s`,
        this.cooldownUntil - now,
      );
    }

    const width = request.width ?? 512;
    const height = request.height ?? 512;
    const activityId = `image-gemini:${++liveImageActivitySeq}`;
    useStore
      .getState()
      .setBackgroundActivity(activityId, `Image model · ${width}×${height}px`);
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        this.model,
      )}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const body = {
        contents: [{ role: "user", parts: [{ text: request.prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: aspectRatioTokenForPixelSize(width, height),
          },
        },
      };

      // AbortController-driven timeout. We don't trust upstream to ever
      // respond — long tails on the image API are common and a stalled
      // mosaic call would otherwise hold the cache's in-flight slot
      // indefinitely.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          throw new ImageTimeoutError(
            `Gemini image API timeout after ${Math.round(IMAGE_REQUEST_TIMEOUT_MS / 1000)}s on ${this.model}`,
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (response.status === 429) {
          const hinted = parseRetryDelay(text);
          const cooldown = Math.min(
            IMAGE_MAX_COOLDOWN_MS,
            Math.max(
              IMAGE_DEFAULT_COOLDOWN_MS,
              hinted ?? IMAGE_DEFAULT_COOLDOWN_MS,
            ),
          );
          this.cooldownUntil = Date.now() + cooldown;
          console.warn(
            `[gemini] 429 quota exhausted on image model ${this.model}; cooling down for ${Math.round(
              cooldown / 1000,
            )}s. Override via VITE_GEMINI_IMAGE_MODEL in engine/.env.`,
          );
          throw new RateLimitedImageError(
            `Gemini image API 429 on ${this.model}: quota exhausted`,
            cooldown,
          );
        }
        throw new Error(
          `Gemini image API ${response.status}: ${text.slice(0, 300)}`,
        );
      }
      const json = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
          };
        }>;
      };
      const part = json.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData?.data,
      );
      const data = part?.inlineData?.data;
      if (!data) {
        throw new Error("Gemini image API: no inline image data in response");
      }
      return {
        bytes: base64ToBytes(data),
        mime: part.inlineData?.mimeType ?? "image/png",
        width,
        height,
      };
    } finally {
      useStore.getState().setBackgroundActivity(activityId, null);
    }
  }
}

/**
 * Stable provider handle used by caches and portrait generation. It keeps
 * per-model Gemini clients alive for cooldown state, while routing each new
 * request through the model currently selected in settings.
 */
export class StoreBackedGeminiImageProvider implements ImageProvider {
  private readonly apiKey: string;
  private readonly providersByModel = new Map<string, GeminiImageProvider>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  get id(): string {
    return this.current().id;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    return this.current().generate(request);
  }

  private current(): GeminiImageProvider {
    const model =
      useStore.getState().geminiImageModel.trim() || defaultGeminiImageModel();
    let provider = this.providersByModel.get(model);
    if (!provider) {
      provider = new GeminiImageProvider(this.apiKey, model);
      this.providersByModel.set(model, provider);
    }
    return provider;
  }
}

// Default image model: gemini-3.1-flash-image-preview — Gemini 2.5 flash image, the
// documented default at https://ai.google.dev/gemini-api/docs/image-generation
// as of 2026-05. Override via VITE_GEMINI_IMAGE_MODEL in engine/.env.
// Premium alternative: gemini-3-pro-image-preview (Nano Banana Pro).
export function createGeminiImageProvider(
  apiKey: string,
  model: string = "gemini-2.5-flash-image",
): ImageProvider {
  return new GeminiImageProvider(apiKey, model);
}

export class MockImageProvider implements ImageProvider {
  readonly id = "mock-image";

  async generate(request: ImageRequest): Promise<ImageResponse> {
    const w = request.width ?? 256;
    const h = request.height ?? 256;
    return {
      bytes: solidPng(w, h, hashColor(request.prompt)),
      mime: "image/png",
      width: w,
      height: h,
    };
  }
}

function hashColor(input: string): [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return [(h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff];
}

function solidPng(
  width: number,
  height: number,
  color: [number, number, number],
): Uint8Array {
  // Tiny solid-colour PNG (no compression beyond raw filters). Good enough for
  // a deterministic mock without bringing in pngjs or canvas.
  const rgba = new Uint8Array(width * height * 4 + height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    rgba[offset] = 0; // filter type
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
      rgba[offset + 3] = 255;
      offset += 4;
    }
  }
  return encodePngFromRaw(width, height, rgba);
}

const PNG_SIGNATURE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function encodePngFromRaw(
  width: number,
  height: number,
  rawWithFilters: Uint8Array,
): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlibStore(rawWithFilters);

  const chunks: Uint8Array[] = [
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];

  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const buf = new Uint8Array(len + 12);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, len);
  buf[4] = type.charCodeAt(0);
  buf[5] = type.charCodeAt(1);
  buf[6] = type.charCodeAt(2);
  buf[7] = type.charCodeAt(3);
  buf.set(data, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  dv.setUint32(8 + len, crc >>> 0);
  return buf;
}

function zlibStore(raw: Uint8Array): Uint8Array {
  // Stored deflate blocks (no compression) wrapped in a zlib header / Adler32.
  const blocks: Uint8Array[] = [];
  let i = 0;
  while (i < raw.length) {
    const remaining = raw.length - i;
    const blockLen = Math.min(remaining, 0xffff);
    const isFinal = i + blockLen >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = isFinal;
    header[1] = blockLen & 0xff;
    header[2] = (blockLen >> 8) & 0xff;
    const negLen = ~blockLen & 0xffff;
    header[3] = negLen & 0xff;
    header[4] = (negLen >> 8) & 0xff;
    blocks.push(header);
    blocks.push(raw.subarray(i, i + blockLen));
    i += blockLen;
  }
  const adler = adler32(raw);
  let totalLen = 2;
  for (const b of blocks) totalLen += b.length;
  totalLen += 4;
  const out = new Uint8Array(totalLen);
  out[0] = 0x78;
  out[1] = 0x01;
  let p = 2;
  for (const b of blocks) {
    out.set(b, p);
    p += b.length;
  }
  out[p] = (adler >>> 24) & 0xff;
  out[p + 1] = (adler >>> 16) & 0xff;
  out[p + 2] = (adler >>> 8) & 0xff;
  out[p + 3] = adler & 0xff;
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(buf: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < buf.length; i += 1) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}
