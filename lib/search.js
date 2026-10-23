// Server-only web search via Tavily (https://tavily.com).

export async function webSearch(query, signal) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Server is missing TAVILY_API_KEY (web search provider).");
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
    throw new Error(`Search API error ${res.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return (j.results || []).map((r) => ({
    title: r.title || r.url,
    url: r.url,
    content: String(r.content || "").slice(0, 300),
    date: r.published_date || null,
  }));
}
