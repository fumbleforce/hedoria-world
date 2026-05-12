import {
  aspectRatioTokenForPixelSize,
  ImageTimeoutError,
  StoreBackedGeminiImageProvider,
  type ImageProvider,
  type ImageRequest,
  type ImageResponse,
} from "./imageAdapter";
import { diag } from "../diag/log";
import { DEFAULT_OPENROUTER_IMAGE_MODEL } from "./openRouterDefaults";
import { defaultGeminiImageModel } from "./geminiModelOptions";
import { normalizeOpenRouterImageModelId } from "./openRouterPresets";
import {
  formatOpenRouterHttpError,
  OPENROUTER_PROXY_CHAT_PATH,
} from "./openRouterProxyErrors";
import { useStore } from "../state/store";

export { DEFAULT_OPENROUTER_IMAGE_MODEL };

let liveOpenRouterImageSeq = 0;
let openRouterImageRequestSeq = 0;

const IMAGE_REQUEST_TIMEOUT_MS = (() => {
  // OpenRouter image models (gpt-5-image, flux, etc.) routinely need 60-180s
  // for a single 1Mp render, so we default to 240s and let the env override.
  // VITE_OPENROUTER_IMAGE_TIMEOUT_MS wins; VITE_GEMINI_IMAGE_TIMEOUT_MS is the
  // legacy fallback so existing setups keep their tuned value.
  const env = (import.meta as { env?: Record<string, string | undefined> })?.env;
  const raw =
    env?.VITE_OPENROUTER_IMAGE_TIMEOUT_MS ?? env?.VITE_GEMINI_IMAGE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240_000;
})();

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;]+);base64,(.+)$/u.exec(dataUrl.trim());
  if (!match) {
    throw new Error("OpenRouter image: expected base64 data URL");
  }
  const mime = match[1] ?? "image/png";
  const b64 = match[2] ?? "";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return { bytes, mime };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) {
    s += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(s)}`;
}

class OpenRouterImageProvider implements ImageProvider {
  readonly id: string;
  private readonly model: string;

  constructor(model: string) {
    this.model = model;
    this.id = `openrouter:${model}`;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    const width = request.width ?? 512;
    const height = request.height ?? 512;
    const aspectRatio = aspectRatioTokenForPixelSize(width, height);
    const activityId = `image-openrouter:${++liveOpenRouterImageSeq}`;
    useStore
      .getState()
      .setBackgroundActivity(activityId, `OpenRouter image · ${width}×${height}px`);

    const content: unknown = request.conditioningImage
      ? [
          { type: "text", text: request.prompt },
          {
            type: "image_url",
            image_url: {
              url: bytesToDataUrl(
                request.conditioningImage.bytes,
                request.conditioningImage.mime,
              ),
            },
          },
        ]
      : request.prompt;

    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        {
          role: "user",
          content,
        },
      ],
      modalities: ["image", "text"],
      stream: false,
      image_config: {
        aspect_ratio: aspectRatio,
      },
    };
    const bodyJson = JSON.stringify(body);
    const reqId = `or-image-${++openRouterImageRequestSeq}`;
    const startedAt = performance.now();

    diag.info("image", `openrouter image → POST ${OPENROUTER_PROXY_CHAT_PATH}`, {
      reqId,
      model: this.model,
      width,
      height,
      aspectRatio,
      bytes: bodyJson.length,
      timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(OPENROUTER_PROXY_CHAT_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-Id": reqId,
          },
          body: bodyJson,
          signal: controller.signal,
        });
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startedAt);
        if ((err as { name?: string })?.name === "AbortError") {
          diag.error("image", `openrouter image aborted (timeout)`, {
            reqId,
            model: this.model,
            elapsedMs,
            timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
          });
          throw new ImageTimeoutError(
            `OpenRouter image timeout after ${Math.round(IMAGE_REQUEST_TIMEOUT_MS / 1000)}s on ${this.model}`,
          );
        }
        diag.error("image", `openrouter image fetch failed`, {
          reqId,
          model: this.model,
          elapsedMs,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      const headerMs = Math.round(performance.now() - startedAt);
      diag.info("image", `openrouter image ← headers`, {
        reqId,
        model: this.model,
        status: response.status,
        headerMs,
      });

      const rawText = await response.text();
      const totalMs = Math.round(performance.now() - startedAt);
      if (!response.ok) {
        diag.error("image", `openrouter image HTTP ${response.status}`, {
          reqId,
          model: this.model,
          totalMs,
          bytes: rawText.length,
          bodyPreview: rawText.slice(0, 400),
        });
        throw new Error(formatOpenRouterHttpError("image", response.status, rawText));
      }

      let json: unknown;
      try {
        json = JSON.parse(rawText) as unknown;
      } catch {
        diag.error("image", `openrouter image response was not JSON`, {
          reqId,
          model: this.model,
          totalMs,
          bytes: rawText.length,
          bodyPreview: rawText.slice(0, 400),
        });
        throw new Error("OpenRouter image: response was not JSON");
      }

      const root = json as {
        choices?: Array<{
          message?: {
            images?: Array<{
              type?: string;
              image_url?: { url?: string };
            }>;
          };
        }>;
        error?: { message?: string };
        model?: string;
        provider?: string;
      };

      if (root.error?.message) {
        diag.error("image", `openrouter image upstream error`, {
          reqId,
          model: this.model,
          totalMs,
          error: root.error.message,
        });
        throw new Error(`OpenRouter image: ${root.error.message}`);
      }

      const images = root.choices?.[0]?.message?.images ?? [];
      const first = images.find((im) => {
        const u =
          im.image_url?.url ??
          (im as { imageUrl?: { url?: string } }).imageUrl?.url;
        return typeof u === "string" && u.length > 0;
      });
      const url =
        first?.image_url?.url ??
        (first as { imageUrl?: { url?: string } } | undefined)?.imageUrl?.url;
      if (!url) {
        diag.error("image", `openrouter image: no images in response`, {
          reqId,
          model: this.model,
          totalMs,
          imageCount: images.length,
          bodyPreview: rawText.slice(0, 400),
        });
        throw new Error("OpenRouter image: no images in response");
      }

      const { bytes, mime } = dataUrlToBytes(url);
      diag.info("image", `openrouter image ← decoded`, {
        reqId,
        requestedModel: this.model,
        reportedModel: root.model,
        reportedProvider: root.provider,
        totalMs,
        imageBytes: bytes.byteLength,
        mime,
        width,
        height,
      });
      return {
        bytes,
        mime,
        width,
        height,
      };
    } finally {
      clearTimeout(timer);
      useStore.getState().setBackgroundActivity(activityId, null);
    }
  }
}

export class StoreBackedOpenRouterImageProvider implements ImageProvider {
  private readonly providersByModel = new Map<string, OpenRouterImageProvider>();

  get id(): string {
    return this.current().id;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    return this.current().generate(request);
  }

  private current(): OpenRouterImageProvider {
    const store = useStore.getState();
    const trimmed =
      store.openRouterImageModel.trim() || DEFAULT_OPENROUTER_IMAGE_MODEL;
    const model = normalizeOpenRouterImageModelId(trimmed);
    if (model !== trimmed) {
      store.setOpenRouterImageModel(model);
    }
    let provider = this.providersByModel.get(model);
    if (!provider) {
      provider = new OpenRouterImageProvider(model);
      this.providersByModel.set(model, provider);
    }
    return provider;
  }
}

/**
 * Routes each image request to Gemini or OpenRouter based on store (no reload).
 */
export class DelegatingImageProvider implements ImageProvider {
  private readonly gemini: StoreBackedGeminiImageProvider | null;
  private readonly openRouter: StoreBackedOpenRouterImageProvider | null;

  constructor(
    gemini: StoreBackedGeminiImageProvider | null,
    openRouter: StoreBackedOpenRouterImageProvider | null,
  ) {
    this.gemini = gemini;
    this.openRouter = openRouter;
  }

  get id(): string {
    const s = useStore.getState();
    if (s.imageLlmBackend === "openrouter") {
      const trimmed =
        s.openRouterImageModel.trim() || DEFAULT_OPENROUTER_IMAGE_MODEL;
      const m = normalizeOpenRouterImageModelId(trimmed);
      return `openrouter:${m}`;
    }
    const m = s.geminiImageModel.trim() || defaultGeminiImageModel();
    return `gemini:${m}`;
  }

  async generate(request: ImageRequest): Promise<ImageResponse> {
    const s = useStore.getState();
    if (s.imageLlmBackend === "openrouter") {
      if (!this.openRouter) {
        throw new Error(
          "OpenRouter image is not available. Set OPENROUTER_API_KEY in engine/.env.local and run the Vite dev server.",
        );
      }
      return this.openRouter.generate(request);
    }
    if (!this.gemini) {
      throw new Error(
        "Gemini image is not available. Set VITE_GEMINI_API_KEY in engine/.env.local.",
      );
    }
    return this.gemini.generate(request);
  }
}
