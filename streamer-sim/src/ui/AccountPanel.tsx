import { useEffect, useState } from "react";
import { useStore, freshGameSettings } from "../state/store";
import { useAuth } from "../auth/useAuth";
import { supabaseConfigured } from "../lib/supabase";
import { openCheckout, openBillingPortal, lemonSqueezyConfigured } from "../lib/lemonSqueezy";
import { useStoredImage } from "../persist/useStoredImage";
import { deleteImagesForSlot } from "../persist/imageStore";
import {
  createAndActivateSlot,
  deleteSlot,
  getActiveSlot,
  listSlots,
  renameSlot,
  setActiveSlot,
  type SaveSlotMeta,
} from "../persist/saves";

type Tab = "saves" | "account";

export function AccountPanel() {
  const open = useStore((s) => s.accountOpen);
  const [tab, setTab] = useState<Tab>("saves");

  if (!open) return null;

  const close = () => useStore.getState().setAccountOpen(false);

  return (
    <div className="modal" onClick={close}>
      <div className="modal__card modal__card--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>💾 Saves &amp; Account</h2>
          <div className="tabs">
            <button className={`tab ${tab === "saves" ? "tab--on" : ""}`} onClick={() => setTab("saves")}>
              Saves
            </button>
            <button className={`tab ${tab === "account" ? "tab--on" : ""}`} onClick={() => setTab("account")}>
              Account
            </button>
          </div>
          <button className="modal__close" onClick={close}>✕</button>
        </div>
        {tab === "saves" && <SavesContent />}
        {tab === "account" && <AccountContent />}
      </div>
    </div>
  );
}

function SavesContent() {
  const settings = useStore((s) => s.settings);
  const [slots, setSlots] = useState<SaveSlotMeta[]>(() => listSlots());
  const active = getActiveSlot();

  const refresh = () => setSlots(listSlots());
  useEffect(() => { refresh(); }, []);

  const onCreate = () => {
    const fallback = `Save ${slots.length + 1}`;
    const name = window.prompt("Name for the new save", fallback);
    if (name === null) return;
    createAndActivateSlot(name.trim() || fallback, freshGameSettings(settings));
    window.location.reload();
  };

  const onLoad = (slotId: string) => {
    if (slotId === active.id) return;
    setActiveSlot(slotId);
    window.location.reload();
  };

  const onRename = (slot: SaveSlotMeta) => {
    const next = window.prompt("Rename save", slot.name);
    if (next === null) return;
    renameSlot(slot.id, next);
    refresh();
  };

  const onDelete = async (slot: SaveSlotMeta) => {
    if (slots.length <= 1) return;
    if (!window.confirm(`Delete "${slot.name}"? This removes its world progress and image library.`)) return;
    await deleteImagesForSlot(slot.id);
    const { deleted } = deleteSlot(slot.id);
    if (!deleted) return;
    if (slot.id === active.id) window.location.reload();
    else refresh();
  };

  return (
    <div className="saves">
      <div className="saves__head">
        <p className="hint">Autosave is always on. Load switches the active save slot.</p>
        <button className="btn btn--primary" onClick={onCreate}>New game</button>
      </div>
      <div className="saves__grid">
        {slots.map((slot) => (
          <div key={slot.id} className={`saveCard ${slot.id === active.id ? "saveCard--active" : ""}`}>
            <SavePortrait slot={slot} />
            <div className="saveCard__meta">
              <div className="saveCard__title">{slot.name}</div>
              <div className="saveCard__line">
                {slot.characterName || "Unknown streamer"} · Day {slot.day}
              </div>
              <div className="saveCard__line">{new Date(slot.updatedAt).toLocaleString()}</div>
            </div>
            <div className="saveCard__actions">
              <button className="btn btn--mini" disabled={slot.id === active.id} onClick={() => onLoad(slot.id)}>
                {slot.id === active.id ? "Active" : "Load"}
              </button>
              <button className="btn btn--mini" onClick={() => onRename(slot)}>Rename</button>
              <button
                className="btn btn--mini btn--danger"
                disabled={slots.length <= 1}
                onClick={() => void onDelete(slot)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SavePortrait({ slot }: { slot: SaveSlotMeta }) {
  const src = useStoredImage(slot.portraitId);
  if (!src) return <div className="savePortrait savePortrait--empty">No portrait</div>;
  return <img className="savePortrait" src={src} alt={`${slot.name} portrait`} loading="lazy" />;
}

function AccountContent() {
  const openRouterAvailable = useStore((s) => s.openRouterAvailable);
  const { user, tier, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const handle = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  };

  if (!supabaseConfigured) {
    return (
      <div className="accountTab">
        <p className="hint">Cloud saves require Supabase to be configured.</p>
        <p className="hint" style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable.
        </p>
      </div>
    );
  }

  if (!user) {
    return <div className="accountTab"><p className="hint">Not signed in.</p></div>;
  }

  return (
    <div className="accountTab">
      <div className="accountTab__row">
        <span className="accountTab__email">{user.email}</span>
        <span className={`accountTab__tier ${tier === "pro" ? "accountTab__tier--pro" : ""}`}>
          {tier === "pro" ? "Pro" : "Free"}
        </span>
      </div>

      <div className="accountTab__row accountTab__ai">
        <span className="hint">AI (OpenRouter)</span>
        <span className={`accountTab__status ${openRouterAvailable ? "accountTab__status--ok" : "accountTab__status--off"}`}>
          {openRouterAvailable ? "● Active" : "● Offline engine"}
        </span>
      </div>

      {tier === "free" && lemonSqueezyConfigured && (
        <button
          className="btn btn--primary"
          onClick={() => void handle(async () => openCheckout(user.id, user.email))}
          disabled={busy}
        >
          Upgrade to Pro
        </button>
      )}
      {tier === "pro" && (
        <button className="btn btn--secondary" onClick={() => openBillingPortal()} disabled={busy}>
          Manage subscription
        </button>
      )}

      <button className="btn btn--secondary" onClick={() => void handle(signOut)} disabled={busy}>
        Sign out
      </button>
    </div>
  );
}
