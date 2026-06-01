import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { supabaseConfigured } from "../lib/supabase";
import { openCheckout, openBillingPortal, lemonSqueezyConfigured } from "../lib/lemonSqueezy";

const SHOW_GOOGLE = false;

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const { user, tier, loading, signInWithGoogle, signInWithDiscord, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  async function handle(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } finally { setBusy(false); }
  }

  if (!supabaseConfigured) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <span className="modal__title">Cloud Saves</span>
            <button className="modal__close" onClick={onClose}>✕</button>
          </div>
          <div className="modal__body" style={{ padding: "1.5rem", color: "var(--color-muted)" }}>
            <p>Cloud saves require Supabase to be configured.</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>
              Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to enable.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">Account</span>
          <button className="modal__close" onClick={onClose}>✕</button>
        </div>

        <div className="modal__body" style={{ padding: "1.5rem" }}>
          {loading ? (
            <p style={{ color: "var(--color-muted)" }}>Loading…</p>
          ) : user ? (
            <LoggedIn
              email={user.email ?? ""}
              tier={tier}
              busy={busy}
              onUpgrade={() => handle(async () => openCheckout(user.id, user.email))}
              onManage={() => openBillingPortal()}
              onSignOut={() => handle(signOut)}
            />
          ) : (
            <LoggedOut
              busy={busy}
              onGoogle={SHOW_GOOGLE ? () => handle(signInWithGoogle) : null}
              onDiscord={() => handle(signInWithDiscord)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function LoggedOut({ busy, onGoogle, onDiscord }: {
  busy: boolean;
  onGoogle: (() => void) | null;
  onDiscord: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <p style={{ color: "var(--color-muted)", marginBottom: "0.5rem" }}>
        Sign in to back up your saves across devices.
      </p>
      <p style={{ color: "var(--color-muted)", fontSize: "0.85em", marginTop: "-0.25rem", marginBottom: "0.25rem" }}>
        AI chat &amp; narration require signing in.
      </p>
      <button
        className="btn btn--primary"
        onClick={onDiscord}
        disabled={busy}
        style={{ justifyContent: "center" }}
      >
        Sign in with Discord
      </button>
      {onGoogle && (
        <button
          className="btn btn--secondary"
          onClick={onGoogle}
          disabled={busy}
          style={{ justifyContent: "center" }}
        >
          Sign in with Google
        </button>
      )}
    </div>
  );
}

function LoggedIn({ email, tier, busy, onUpgrade, onManage, onSignOut }: {
  email: string;
  tier: "free" | "pro";
  busy: boolean;
  onUpgrade: () => void;
  onManage: () => void;
  onSignOut: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--color-text)", fontSize: "0.9em" }}>{email}</span>
        <span style={{
          fontSize: "0.75em",
          padding: "2px 8px",
          borderRadius: 4,
          background: tier === "pro" ? "var(--color-accent)" : "var(--color-surface-2, #333)",
          color: tier === "pro" ? "#000" : "var(--color-muted)",
        }}>
          {tier === "pro" ? "Pro" : "Free"}
        </span>
      </div>

      <p style={{ color: "var(--color-muted)", fontSize: "0.85em" }}>
        {tier === "pro"
          ? "Cloud saves are enabled. Your progress is backed up automatically."
          : "Upgrade to Pro for cloud saves and full model access."}
      </p>

      {tier === "free" && lemonSqueezyConfigured && (
        <button className="btn btn--primary" onClick={onUpgrade} disabled={busy} style={{ justifyContent: "center" }}>
          Upgrade to Pro
        </button>
      )}
      {tier === "pro" && (
        <button className="btn btn--secondary" onClick={onManage} disabled={busy} style={{ justifyContent: "center" }}>
          Manage subscription
        </button>
      )}

      <button className="btn btn--secondary" onClick={onSignOut} disabled={busy} style={{ justifyContent: "center" }}>
        Sign out
      </button>
    </div>
  );
}
