/**
 * LemonSqueezy checkout helpers.
 *
 * Requires VITE_LEMONSQUEEZY_CHECKOUT_URL set to the full checkout URL of
 * the product variant (found in LemonSqueezy → Products → Share).
 *
 * We embed the Supabase user_id as custom checkout data so the lemon-webhook
 * edge function can link the purchase back to the correct profile.
 */

const CHECKOUT_URL = (import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as string | undefined) ?? "";

export const lemonSqueezyConfigured = CHECKOUT_URL.length > 0;

/** Open the LemonSqueezy checkout in a new tab, pre-seeded with the user id. */
export function openCheckout(userId: string, email?: string): void {
  if (!CHECKOUT_URL) {
    console.warn("openCheckout: VITE_LEMONSQUEEZY_CHECKOUT_URL not set");
    return;
  }
  const url = new URL(CHECKOUT_URL);
  url.searchParams.set("checkout[custom][user_id]", userId);
  if (email) url.searchParams.set("checkout[email]", email);
  window.open(url.toString(), "_blank", "noopener,noreferrer");
}

/** Link to LemonSqueezy's customer portal to manage/cancel a subscription. */
export function openBillingPortal(): void {
  window.open("https://app.lemonsqueezy.com/billing", "_blank", "noopener,noreferrer");
}
