import { useEffect, useState } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabase";

export type SubscriptionTier = "free" | "pro";

export interface AuthState {
  user: User | null;
  session: Session | null;
  tier: SubscriptionTier;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithDiscord: () => Promise<void>;
  signOut: () => Promise<void>;
}

async function fetchTier(userId: string): Promise<SubscriptionTier> {
  const { data } = await supabase
    .from("profiles")
    .select("subscription_tier")
    .eq("id", userId)
    .single();
  return (data?.subscription_tier as SubscriptionTier | undefined) ?? "free";
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tier, setTier] = useState<SubscriptionTier>("free");
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) void fetchTier(session.user.id).then(setTier);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) void fetchTier(session.user.id).then(setTier);
      else setTier("free");
    });

    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  };

  const signInWithDiscord = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: window.location.origin },
    });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { user, session, tier, loading, signInWithGoogle, signInWithDiscord, signOut };
}
