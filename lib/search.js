// Server-only web search via Tavily (https://tavily.com). The key is optional:
// a user-supplied key wins, then TAVILY_API_KEY, otherwise searching is skipped by the caller.

export function hasSearchKey(apiKey) {
  return Boolean(apiKey || process.env.TAVILY_API_KEY);
}

// Error with a machine-readable kind: "auth" | "rate" | "quota" | "other".
function searchError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

export async function webSearch(query, signal, { maxChars = 300, apiKey } = {}) {
  const key = apiKey || process.env.TAVILY_API_KEY;
  if (!key) throw searchError("nokey", "No Tavily API key configured.");
  const endpoint = process.env.TAVILY_API_URL || "https://api.tavily.com/search";
  const res = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: 3, search_depth: "basic", include_answer: false }),
  });
  const text = await res.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  if (!res.ok) {
    const detail = (j.detail && (j.detail.error || j.detail)) || text.slice(0, 200);
    const msg = `Search API error ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`;
    // 401/403 bad key, 429 too many requests, 432/433 plan or pay-as-you-go limit exceeded.
    if (res.status === 401 || res.status === 403) throw searchError("auth", msg);
    if (res.status === 429) throw searchError("rate", msg);
    if (res.status === 432 || res.status === 433) throw searchError("quota", msg);
    throw searchError("other", msg);
  }
  return (j.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    content: String(r.content || "").slice(0, maxChars),
    date: r.published_date || null,
  }));
}
