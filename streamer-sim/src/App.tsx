import { useEffect, useState } from "react";
import { boot, type BootResult } from "./boot";
import { useStore } from "./state/store";
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
  const toast = useStore((s) => s.toast);

  useEffect(() => {
    void boot().then(setServices);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.getState().setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  if (!services) {
    return <div className="boot"><div className="boot__card">◉ Limelight — booting…</div></div>;
  }

  const { controller, llm } = services;

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
          <VisualizationPanel />
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
      <InventoryPanel />
      <SettingsPanel controller={controller} />
      <EventModal controller={controller} />
      <GoalsPanel />
      <CalendarPanel />
      <RequestsPanel controller={controller} />

      {toast && <div className="toast">{toast}</div>}
      <div className="backendChip">{llm.isMock ? "offline engine" : useStore.getState().settings.textBackend}</div>
    </div>
  );
}
