/**
 * Probes the OpenRouter edge function to confirm it is deployed and keyed.
 * Called once after the Supabase session is confirmed (see useCloudSync).
 *
 * Success → setOpenRouterAvailable(true) + load model catalog.
 * Failure → toast explaining the gap + revert textBackend to "mock".
 */

import type { Session } from "@supabase/supabase-js";
import { useStore } from "../state/store";
import { loadOpenRouterCatalog } from "./openRouterCatalog";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

export async function probeOpenRouterStatus(session: Session): Promise<void> {
  const store = useStore.getState();
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/openrouter-proxy/status`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    if (r.status === 401) {
      store.setToast("AI sign-in not accepted — playing on the offline engine.");
      store.setSettings({ textBackend: "mock" });
      return;
    }
    if (!r.ok) {
      store.setToast("AI backend not deployed yet — playing on the offline engine.");
      store.setSettings({ textBackend: "mock" });
      return;
    }

    const j = (await r.json()) as { ok?: boolean };
    if (j.ok === true) {
      store.setOpenRouterAvailable(true);
      void loadOpenRouterCatalog();
    } else {
      store.setToast("AI backend is missing its API key — playing on the offline engine.");
      store.setSettings({ textBackend: "mock" });
    }
  } catch {
    store.setToast("AI backend not deployed yet — playing on the offline engine.");
    store.setSettings({ textBackend: "mock" });
  }
}
