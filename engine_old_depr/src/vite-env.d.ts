/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Gemini API key. Set in `engine/.env.local`. See `engine/.env.example`. */
  readonly VITE_GEMINI_API_KEY?: string;
  /** Optional override for the Gemini text model. */
  readonly VITE_GEMINI_TEXT_MODEL?: string;
  /** Optional override for the Gemini image model. */
  readonly VITE_GEMINI_IMAGE_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
