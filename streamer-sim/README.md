# Limelight

A text-first **streamer life sim** with a top-down apartment, a live LLM-driven
chat, and a storyteller engine. You play a streamer trying to make a living:
grow a following, manage energy/mood/comfort, buy better gear, and survive a
chat that gets *very* parasocial.

Standalone project — it does not import from the Hedoria `engine/`, but reuses
the same LLM-integration patterns (provider abstraction, Gemini/OpenRouter
backends, the Vite dev proxy).

## Run it

```bash
cd streamer-sim
npm install
npm run dev
```

Runs **with no API keys** using a built-in offline engine (mock chat + a
deterministic keyword evaluator), so you can play immediately.

### Controls
- **WASD / arrows** — walk around the apartment
- **E / Enter** — open the contextual menu for the furniture you're next to (or click it)
- Each furniture menu offers tailored options **plus a freeform box** — type
  anything and the LLM (or offline evaluator) judges it
- The bottom **action bar** is always available: a freeform "what do you do?"
  box, quick actions while live, and Go Live / Sleep / Shop / Settings offline

## The turn loop

The game is **turn-based**. At the start of each round ambient chat trickles in
to keep the stream feeling alive; you then take **one action**, it resolves, the
chat reacts, and the round advances (a storyteller beat may fire between rounds).
No real-time pressure — you can think.

## The core engine: "LLM proposes, code disposes"

Every action — typed freeform or chosen from a menu — flows through one pipeline:

```
player action
   → evaluate   (LLM, or offline keyword evaluator)  → structured verdict
   → resolve    (pure, deterministic code)            → clamped metric/audience deltas
   → narrate    (DM sidebar) + react (chat burst)
```

The LLM **never sets numbers**. It returns a bounded *verdict* — tags, intensity,
per-segment appeal, coarse stat pressure, and narration — and `resolver.ts` owns
all the math. This keeps freeform freedom while staying impossible to talk into a
million followers. See `src/game/evaluator.ts` + `src/game/resolver.ts`.

### Viewer segments (the spine)

The audience is not one number — it's archetype **segments**, each with a
population and satisfaction: Hype Beasts, Lonely Hearts, Simps, Trolls, Cozy
Crowd, Whales, and **Stalkers**. Actions please/anger segments; satisfied ones
grow & tip, unhappy ones leave. Follower growth, income, chat flavor, comfort
drain, and the parasocial **stalker arc** all emerge from this one model
(`src/game/segments.ts`). Oversharing/suggestive play breeds stalkers; setting a
boundary culls them.

## Logging

Elegant leveled + channeled diagnostics (`src/diag/log.ts`):
- **Browser console**: grouped, color-coded by channel (action / evaluator /
  resolver / llm / chat / round / event / economy). Set the level in Settings,
  or live: `__diag.configure({ consoleLevel: 'warn' })`.
- **Terminal**: every record is echoed to the `npm run dev` console and appended
  to `logs/events.jsonl`. Raw LLM prompt/response pairs go to
  `logs/llm-prompts.jsonl`. `tail -f logs/events.jsonl | jq` for the live flow.

## Going live with a real LLM (optional)

Copy `.env.example` → `.env.local` and set **one** of:
- `VITE_GEMINI_API_KEY` (key ships in the browser bundle — dev/personal only), or
- `OPENROUTER_API_KEY` (stays server-side; routed through the Vite dev proxy)

Then pick the backend in **⚙ Settings → General**. Both the evaluator and chat
fall back to the offline engine automatically if a call fails.

## Settings

- **General** — streamer name/persona, content intensity, LLM backend & models,
  console log level.
- **Prompts** — view and **edit the actual system prompts** (evaluator, narrator,
  chat). Overrides persist; `{{name}}`/`{{persona}}`/`{{steering}}` fill at runtime.

## Content intensity

Four tiers: Wholesome, Flirty, Risqué, Custom. All built-in tiers stay
non-explicit (suggestive at most) and cap action intensity. **Custom** injects
your own steering text verbatim into the prompts — the single intended place to
author stronger direction. See `src/game/content.ts`.

## Architecture

```
src/
  diag/log.ts        leveled/channeled logger (browser + terminal sink)
  llm/               provider abstraction (Gemini / OpenRouter / Mock) + adapter
  game/
    controller.ts    turn loop + the single mutation funnel (UI calls this)
    evaluator.ts     action → structured verdict (LLM or offline keyword rules)
    resolver.ts      verdict → deterministic, clamped state changes
    segments.ts      viewer-archetype model (the spine)
    actions.ts       tag taxonomy + action/verdict types
    prompts.ts       all system prompts (editable in Settings)
    chatEngine.ts    segment-aware chat bursts (LLM + mock)
    storyteller.ts   weighted authored events (brand deals, raids, stalkers, door)
    shop/content/personas/apartment/types
  state/store.ts     Zustand store (persisted to localStorage)
  render/            Canvas 2D top-down apartment (labeled, contextual menus)
  ui/                HUD, narrator, audience, chat, action bar, shop, settings, events
```

## Not in this slice (next steps)
- Image generation (`imageAdapter` pattern exists in Hedoria; a "stream cam" panel)
- Persistent **named** stalkers with memory across streams (segments → individuals)
- Multi-room / larger apartment tiers, outfits as real items
- An economy balance pass
