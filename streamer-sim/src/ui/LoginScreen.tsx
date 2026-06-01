import { useState } from "react";

interface Props {
  /** True while the initial Supabase session check is still in flight. */
  loading: boolean;
  signInWithDiscord: () => Promise<void>;
}

/**
 * Full-screen login gate. Rendered by `App` *instead of* the game whenever
 * Supabase is configured and no user is signed in, so the game is locked behind
 * authentication. (When Supabase is not configured — local dev — App skips this
 * gate entirely and boots straight into the offline engine.)
 */
export function LoginScreen({ loading, signInWithDiscord }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleDiscord() {
    setBusy(true);
    try {
      await signInWithDiscord();
    } finally {
      // On success the OAuth redirect navigates away; if it returns (popup
      // closed / error) we re-enable the button.
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login__card">
        <div className="login__logo">◉ Limelight</div>
        <p className="login__tagline">A turn-based streamer life-sim.</p>

        {loading ? (
          <p className="login__status">Checking your session…</p>
        ) : (
          <>
            <button
              className="btn btn--primary login__discord"
              onClick={handleDiscord}
              disabled={busy}
            >
              {busy ? "Redirecting…" : "Sign in with Discord"}
            </button>
            <p className="login__note">Sign in to play — AI chat &amp; narration require an account.</p>
          </>
        )}
      </div>
    </div>
  );
}
