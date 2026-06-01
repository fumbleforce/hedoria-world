/**
 * useCloudSync — augments useAuth with automatic cloud save + image sync,
 * and keeps transient auth state in the Zustand store in sync.
 *
 * Sync triggers:
 *  1. Sign-in  — push current save JSON + kick off background image upload.
 *  2. Day change — push save JSON when metrics.day increments.
 *  3. Periodic  — push save JSON every 2 minutes while signed in.
 *  4. Session change — write hasSession to store, flip backend, probe edge fn.
 *
 * All operations are fire-and-forget; failures are logged but never surface
 * as errors to the player (local state is always the source of truth).
 */

import { useEffect, useRef } from "react";
import { useAuth, type AuthState } from "./useAuth";
import { useStore } from "../state/store";
import { supabaseConfigured } from "../lib/supabase";
import { pushSave } from "../persist/cloudSave";
import { getActiveSaveSnapshot } from "../persist/saves";
import { syncAllImages } from "../persist/imageSync";
import { probeOpenRouterStatus } from "../llm/openRouterStatus";

const PERIODIC_MS = 2 * 60 * 1000;

export function useCloudSync(): AuthState {
  const auth = useAuth();
  const { user } = auth;

  // Track the last user ID so we can detect sign-in (vs. user already being set on mount).
  const prevUserIdRef = useRef<string | null>(null);
  // Track day to detect an actual increment (not just user change or mount).
  const prevDayRef = useRef<number | null>(null);
  // Track signed-in state to avoid re-running the probe on every token refresh.
  const prevSignedInRef = useRef<boolean | null>(null);
  const day = useStore((s) => s.metrics.day);

  // Trigger 1: sign-in
  useEffect(() => {
    const prevId = prevUserIdRef.current;
    prevUserIdRef.current = user?.id ?? null;
    if (!user || prevId === user.id) return;

    const snapshot = getActiveSaveSnapshot();
    if (!snapshot) return;

    void pushSave(user, snapshot.meta, snapshot.state);
    // Image sync is slow; run fully in background.
    void syncAllImages(user, snapshot.meta.id);
  }, [user]);

  // Trigger 2: day change
  useEffect(() => {
    const prev = prevDayRef.current;
    prevDayRef.current = day;
    // Skip mount and skip when user isn't signed in.
    if (prev === null || prev === day || !user) return;
    const snapshot = getActiveSaveSnapshot();
    if (snapshot) void pushSave(user, snapshot.meta, snapshot.state);
  }, [day, user]);

  // Trigger 3: periodic
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      const snapshot = getActiveSaveSnapshot();
      if (snapshot) void pushSave(user, snapshot.meta, snapshot.state);
    }, PERIODIC_MS);
    return () => clearInterval(id);
  }, [user]);

  // Trigger 4: session → store sync + backend flip + edge-fn probe.
  // Skips when auth is still initializing to avoid premature "no session" reverts.
  useEffect(() => {
    if (auth.loading) return;

    const isSignedIn = !!auth.session;
    const store = useStore.getState();
    store.setHasSession(isSignedIn);

    const wasSignedIn = prevSignedInRef.current;
    prevSignedInRef.current = isSignedIn;

    // Skip the backend flip and probe when the signed-in state hasn't changed
    // (e.g. routine token refresh keeps the same user).
    if (isSignedIn === wasSignedIn) return;

    if (isSignedIn && supabaseConfigured) {
      // Flip from mock to openrouter now that we have a JWT.
      if (store.settings.textBackend === "mock") {
        store.setSettings({ textBackend: "openrouter" });
      }
      void probeOpenRouterStatus(auth.session!);
    } else if (!isSignedIn) {
      // Sign-out (or initial load with no session): revert openrouter → mock.
      if (store.settings.textBackend === "openrouter") {
        store.setSettings({ textBackend: "mock" });
      }
      store.setOpenRouterAvailable(false);
    }
  }, [auth.session, auth.loading]);

  return auth;
}
