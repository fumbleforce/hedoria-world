/** Same-origin path the Vite dev server proxies to OpenRouter chat completions. */
export const OPENROUTER_PROXY_CHAT_PATH = "/__openrouter/chat";

export function formatOpenRouterHttpError(
  kind: "text" | "image",
  status: number,
  rawBody: string,
): string {
  let hint = rawBody.slice(0, 500);
  try {
    const errBody = JSON.parse(rawBody) as { error?: { message?: string } };
    if (errBody.error?.message) hint = errBody.error.message;
  } catch {
    // keep slice
  }
  const looksLikeHtml =
    rawBody.trimStart().startsWith("<") || /<!DOCTYPE/i.test(rawBody.slice(0, 80));
  if (looksLikeHtml) {
    return `${kind === "text" ? "OpenRouter text" : "OpenRouter image"}: got HTML (${status}) from ${OPENROUTER_PROXY_CHAT_PATH} — is the Vite dev server running from engine/ with OPENROUTER_API_KEY? Preview builds have no proxy. Snippet: ${hint.slice(0, 120)}`;
  }
  if (status === 404 && /no endpoints found/i.test(hint)) {
    return `OpenRouter: no provider available for that model (HTTP 404). Pick another id on openrouter.ai/models — ${hint}`;
  }
  return `OpenRouter ${kind} HTTP ${status}: ${hint}`;
}
