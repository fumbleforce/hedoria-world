import { useEffect, useState } from "react";
import { boot, type BootResult } from "./boot";
import { useStore } from "./state/store";
import { AuthModal } from "./ui/AuthModal";
import { supabaseConfigured } from "./lib/supabase";
import { useCloudSync } from "./auth/useCloudSync";
import { StudioRoom } from "./render/StudioRoom";
import { MetricsHud } from "./ui/MetricsHud";
import { ChatPanel } from "./ui/ChatPanel";
import { NarratorPanel } from "./ui/NarratorPanel";
import { VisualizationPanel } from "./ui/VisualizationPanel";
import { CharacterGallery } from "./ui/CharacterGallery";
import { ChangeLogPanel } from "./ui/ChangeLogPanel";
import { StatsPanel } from "./ui/StatsPanel";
import { ActionBar } from "./ui/ActionBar";
import { ActionMenuModal } from "./ui/ActionMenuModal";
import { CharacterModal } from "./ui/CharacterModal";
import { ActivityPicker } from "./ui/ActivityPicker";
import { ShopPanel } from "./ui/ShopPanel";
import { InventoryPanel } from "./ui/InventoryPanel";
import { SettingsPanel } from "./ui/SettingsPanel";
import { EventModal } from "./ui/EventModal";
import { GoalsPanel } from "./ui/GoalsPanel";
import { CalendarPanel } from "./ui/CalendarPanel";
import { RequestsPanel } from "./ui/RequestsPanel";

export function App() {
  const [services, setServices] = useState<BootResult | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const toast = useStore((s) => s.toast);
  const textBackend = useStore((s) => s.settings.textBackend);
  const hasSession = useStore((s) => s.hasSession);
  const auth = useCloudSync();

  useEffect(() => {
    void boot().then(setServices);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.getState().setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Reactive chip: show the real provider name only when it's actually usable.
  // In prod OpenRouter requires a session; in dev the local proxy needs no auth.
  const chipLabel =
    textBackend === "gemini" ? "gemini"
    : textBackend === "openrouter" && (!supabaseConfigured || hasSession) ? "openrouter"
    : "offline engine";

  if (!services) {
    return <div className="boot"><div className="boot__card">◉ Limelight — booting…</div></div>;
  }

  const { controller } = services;

  return (
    <div className="app">
      <MetricsHud />

      <main className="stage">
        <div className="stage__left">
          <StudioRoom controller={controller} />
          <ChangeLogPanel />
          <StatsPanel />
        </div>

        <div className="stage__center">
          <VisualizationPanel controller={controller} />
          <NarratorPanel controller={controller} />
        </div>

        <div className="stage__right">
          <ChatPanel controller={controller} />
          <CharacterGallery controller={controller} />
        </div>
      </main>

      <ActionBar controller={controller} />

      <ActionMenuModal controller={controller} />
      <CharacterModal controller={controller} />
      <ActivityPicker controller={controller} />
      <ShopPanel controller={controller} />
      <InventoryPanel controller={controller} />
      <SettingsPanel controller={controller} />
      <EventModal controller={controller} />
      <GoalsPanel />
      <CalendarPanel />
      <RequestsPanel controller={controller} />

      {toast && <div className="toast">{toast}</div>}
      <div className="backendChip">{chipLabel}</div>

      {supabaseConfigured && !auth.loading && !auth.user ? (
        <button className="signInCta" onClick={() => setShowAuth(true)}>
          Sign in with Discord
          <span className="signInCta__note">AI responses require signing in</span>
        </button>
      ) : (
        <button
          className="accountChip"
          onClick={() => setShowAuth(true)}
          title={supabaseConfigured ? "Account & cloud saves" : "Cloud saves (not configured)"}
          aria-label="Account"
        >
          ☁
        </button>
      )}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
