# 05 — LLM Stack

How the game talks to language models: providers, the adapter, model routing, JSON
robustness, the action evaluator, prompts, and the settings that control all of it.

Files: `src/llm/types.ts`, `adapter.ts`, `providers.ts`, `geminiProvider.ts`,
`openRouterTextProvider.ts`, `mockProvider.ts`, `schema.ts`, `json.ts`, `stats.ts`,
`game/evaluator.ts`, `game/prompts.ts`, `game/content.ts`.

## The chain

```
controller / chatEngine / evaluator
        │  complete() / stream() / completeJsonWithRepair()
        ▼
   LlmAdapter            — injects `kind`, logs, records stats, stream fallback
        ▼
   DelegatingTextProvider — routes by settings.textBackend (live)
        ▼
   Gemini | OpenRouter | Mock
```

## Provider routing (`providers.ts`)

`DelegatingTextProvider.pick()` reads the **live** `settings.textBackend` and
`hasSession` each call:

| `textBackend` | `supabaseConfigured` | `hasSession` | Resolves to |
|---------------|----------------------|--------------|-------------|
| `mock` | any | any | Mock |
| `gemini` | any | any | Gemini (direct key, no auth gate) |
| `openrouter` | `false` (dev) | any | OpenRouter (local proxy, no auth needed) |
| `openrouter` | `true` (prod) | `true` | OpenRouter (JWT injected per-request) |
| `openrouter` | `true` (prod) | `false` | fallback (gemini → mock) |
| fallback | any | — | `gemini ?? (openRouter if canUse) ?? mock` |

`canUseOpenRouter = !supabaseConfigured || hasSession` — in dev the local proxy
needs no auth; in prod the edge function requires a live JWT.

`resolveTextProvider(geminiKey, openRouterOk)` builds the available provider
instances. In prod, `openRouterOk = supabaseConfigured` so the `OpenRouterTextProvider`
instance is always constructed (its lazy JWT fetch fires per-request). In dev,
`openRouterOk = probeDevOpenRouter()`. If neither real provider is constructed,
returns Mock directly.

At boot, a stale/default `mock` setting is upgraded to the best available backend
(see [07](./07-persistence.md)). `pick()` keeps routing safe until `hasSession`
resolves — no 401 is ever fired before the session is confirmed.

### Auth-gated session sync (`useCloudSync.ts`)

`useCloudSync` extends its existing save-sync duties with a fourth trigger:
**session change → store sync + edge-function probe**.

1. `setHasSession(!!session)` written to the store (transient) on every auth
   state change.
2. On **sign-in** (`supabaseConfigured` and session present):
   - Flip `textBackend` from `"mock"` to `"openrouter"` if it hasn't been already.
   - Call `probeOpenRouterStatus(session)` (`src/llm/openRouterStatus.ts`).
3. On **sign-out** (or initial load without a session):
   - Revert `textBackend` `"openrouter"` → `"mock"`.
   - `setOpenRouterAvailable(false)`.

`probeOpenRouterStatus` calls `GET {SUPABASE_URL}/functions/v1/openrouter-proxy/status`
with the Bearer JWT and interprets the response:

| Response | Action |
|----------|--------|
| `{ ok: true }` | `setOpenRouterAvailable(true)` + load model catalog |
| `{ ok: false }` | toast "missing its API key" → revert to mock |
| 401 | toast "sign-in not accepted" → revert to mock |
| 404 / network | toast "not deployed yet" → revert to mock |

> **The main game paths don't actually rely on the Mock provider's output.** Chat,
> evaluation, DMs, etc. check `adapter.isMock` and run dedicated **local engines**
> (`mockBurst`, `localEvaluate`, canned lines). The Mock provider's `complete` just
> returns `"{}"`/`""` for any stray call.

## Providers

### Gemini (`geminiProvider.ts`) — direct browser → Google API
- Default model `gemini-2.5-flash`. API key is in the request URL (dev/personal only).
- **Structured output:** when `jsonMode`/`jsonSchema`, sets
  `responseMimeType: application/json` and, if a schema is given,
  `responseSchema = toGeminiSchema(...)`.
- **Streaming:** real SSE via `:streamGenerateContent?alt=sse`.

### OpenRouter (`openRouterTextProvider.ts`)
- Default model `google/gemini-2.5-flash`. 120 s timeout. `stream: false` hardcoded.
- **Structured output:** `response_format: {type: "json_schema", json_schema:
  {name, strict: false, schema}}` — `strict: false` to avoid 400s, so it's
  best-effort. `jsonMode` alone → `{type: "json_object"}`.
- **No `stream()` method** → DM "streaming" degrades to one chunk.

**Proxy routing** (resolved at module load):

| Environment | Proxy endpoint | Auth |
|---|---|---|
| Dev (`VITE_SUPABASE_URL` absent) | `/__openrouter/chat` (Vite middleware) | none — server-side key in `.env` |
| Prod (`VITE_SUPABASE_URL` set) | `{SUPABASE_URL}/functions/v1/openrouter-proxy` | Supabase JWT injected per request |

The edge function `supabase/functions/openrouter-proxy/index.ts` holds the
`OPENROUTER_API_KEY` secret server-side and verifies the caller's JWT before
forwarding to OpenRouter.

### Mock (`mockProvider.ts`)
`id = "mock-local"`; returns `"{}"` in JSON mode, `""` otherwise. Real offline
behavior lives in the local engines, not here.

## Model routing & tiers

Both real providers use the same rule:
```
if (settings.tieredModels && kind === "chat")  → fast model
else                                            → main model
```
Only the **`chat`** kind gets the fast model. Defaults:

| Role | Gemini | OpenRouter |
|------|--------|------------|
| Main | `gemini-2.5-flash` | `google/gemini-2.5-flash` |
| Fast (chat kind) | `gemini-2.5-flash-lite` | `google/gemini-2.5-flash-lite` |

`tieredModels` is **off by default**, so everything uses the main model until enabled.

## Call kinds (`LlmCallKind = "chat" | "story" | "other"`)

| kind | Used by | Tier when `tieredModels` on |
|------|---------|------------------------------|
| `chat` | chat bursts, ambient chat, action chat reaction, Continue chat, **performance spoken line**, **DM replies**, **stream-memory summary** | fast |
| `story` | action evaluator (+self-consistency 2nd sample), Continue narration, event narration, freeform-event judge, character backstory, DM memory condense, **DM director** (`directDm`), **visit-beat judge** (`judgeVisitBeat`) | main |
| `other` | adapter default; `completeJsonWithRepair` default; **no game call passes it** | main |

> The Settings help text and the LLM tab label say the fast model is "chat bursts"
> and the main model handles "evaluator / narration / **DMs**" — but **DMs, performance
> lines, and stream-memory all use the `chat` kind** and so go to the *fast* model when
> tiering is on. The labels are misleading. See [09](./09-expectation-vs-reality.md).

## JSON robustness (`adapter.ts`, `json.ts`, `schema.ts`)

Layered defenses so a malformed model reply never stalls the game:

1. **Native schema** — Gemini `responseSchema` / OpenRouter `json_schema` (evaluator
   `verdictSchema()`, chat `chatSchema()`, event `EVENT_OUTCOME_SCHEMA`, DM director
   `EFFECT_SCHEMA`, visit `VISIT_OUTCOME_SCHEMA`).
2. **`extractJson`** — tries direct parse, then strips ```` ```json ```` fences, then
   scans for the first balanced `{...}`/`[...]`, then repairs unescaped `"` inside
   string values (common when chat text quotes a phrase).
3. **`completeJsonWithRepair`** — first call; if the caller's `parse` returns null,
   **one** repair retry that echoes the bad output and says "reply again with ONLY the
   JSON value." Then gives up (caller falls back to local).
4. **Self-consistency** — evaluator only (see below).
5. **Local fallback** — `localEvaluate`, `mockBurst`, canned lines.

`toGeminiSchema` maps JSON Schema → Gemini's OpenAPI subset (uppercases types, keeps
only `type/description/enum/items/properties/required/nullable`, drops the rest).

## The evaluator (`evaluator.ts`)

Turns a `PlayerAction` into an `ActionVerdict`.

- If `adapter.isMock` → `localEvaluate` (keyword `RULES` table, intensity capped by
  tier: wholesome 2, flirty 3, risqué 4, unhinged/custom 5).
- Else: `completeJsonWithRepair` with `jsonMode + jsonSchema = verdictSchema()`, kind
  `story`. On null/exception → `localEvaluate`.

**Anti-repetition context.** The evaluator user message includes the last few `dm`
narration lines (`recentNarration`, via `recentNarrationLines()` in `controller.ts`)
alongside `streamMemory`, `vibe`, and `recentChat`. The model is told NOT to echo those
openings/gestures/phrasings, and rule 7 explicitly bans the "lean into the camera" /
"smile playing on your lips" defaults so the live stage direction (`verdict.narration`)
stays varied beat-to-beat. Rule 7 also bans repeated face-beats (eyes sparkling/
glinting, a smirk on her lips) and pushes for a concrete action/prop/movement instead.

**Chat de-duplication.** `buildRequest` shows recent chat as "already on screen — never
repost." As a hard guarantee, `store.pushChat` drops any incoming message whose
`user + text` already appears in the last 16 lines (not just the immediately preceding
line), so the chat model can't bounce an earlier reaction (e.g. "here we go") back onto
screen a beat later.

**Self-consistency** (setting `selfConsistency`, default **on**): if the first verdict
`isHighImpact`, sample a second and `reconcileVerdicts`. `isHighImpact` is true when
intensity ≥4, or `setsBoundary`, or tags include `suggestive/bold/edgy/drama/chaotic`,
or any `|appeal| ≥ 3`. Reconciliation: average appeal (round, clamp, drop zeros),
pressure agrees-or-`none`, plausible defaults true on disagreement, union tags,
averaged intensity, keep the first narration, OR the boundary flag.

## Prompts (`prompts.ts`) & steering (`content.ts`)

`PROMPTS` holds four editable templates: **evaluator**, **narrator**, **chat**,
**performance**, each with `{{name}}`, `{{persona}}`, `{{steering}}` placeholders.
`resolvePrompt(id)` uses the user's override (persisted `promptOverrides`) or the base,
and fills in `steeringForTier(settings)`.

`steeringForTier` produces the tone paragraph for the active content tier (wholesome →
unhinged → custom uses `settings.customSteering` verbatim). This is the only "content
control" — the engine doesn't hard-block actions; the model declines in character at
low tiers.

## Streaming (`streamReplies`, default on)

| Surface | Streams? |
|---------|----------|
| DM replies | Yes (progressive), **only on Gemini**; OpenRouter sends one chunk |
| Live chat, performance lines, narration, evaluator | No |

DM text is capped at 280 chars via `updateLastDm`.

## Telemetry (`stats.ts`)

In-memory per-session stats, surfaced in **Settings → LLM** via
`useStore((s) => s.llmStats)`. `recordLlmCall` writes into the zustand store (not
persisted) so the adapter and UI always share one singleton — **one slot per kind**, so
each new call overwrites the previous for that kind (counts accumulate). Records
`durationMs`, approximate tokens (~chars/4), raw prompt/response (8000-char cap), and
ok/error. **Image calls are not recorded here** (they log via `logLlmRaw` only). The
`model` field is `provider.id`, which always reflects the **main** model name even on
fast-tier chat calls.

## Settings that affect the LLM

| Setting | Default | Effect |
|---------|---------|--------|
| `textBackend` | `mock` (boot may upgrade) | provider selection |
| `geminiModel` / `openRouterModel` | flash | main model |
| `tieredModels` | **false** | chat kind → fast model |
| `geminiFastModel` / `openRouterFastModel` | flash-lite | fast model |
| `selfConsistency` | **true** | double-sample high-impact verdicts |
| `streamReplies` | **true** | token-stream DMs when supported |
| `contentTier` | `flirty` | steering + local intensity cap |
| `customSteering` | `""` | used when tier is custom |
| `promptOverrides` | per id | replace prompt templates |
| `consoleLevel` | `debug` | diagnostics verbosity |

Env: `VITE_GEMINI_API_KEY` (Gemini), `OPENROUTER_API_KEY` (read server-side by the
Vite proxy or the edge function, not VITE-prefixed). `VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY` gate the `supabaseConfigured` flag that selects the prod
routing path.

### Transient store fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `hasSession` | `boolean` | `false` | Live JWT exists right now |
| `openRouterAvailable` | `boolean` | `false` | Status probe returned `{ ok: true }` |

Both are **not** in `partialize` — they are intentionally transient and reset on
every page load.

## Dev logging (`vite.config.ts`)

Dev-only endpoints: `POST /__llm-log` → `logs/llm-prompts.jsonl` +
`logs/llm-debug.log`; `POST /__diag-log` → terminal + `logs/events.jsonl`;
`GET /__openrouter/status`; `POST /__openrouter/chat`. Production builds 404 these and
the client swallows the errors.
