import { chat, watsonxModel } from "@/lib/watsonx";
import { webSearch } from "@/lib/search";
import { rules, briefFrom } from "@/lib/prompts";
import { extractJSON } from "@/lib/json";
import { rateLimit } from "@/lib/ratelimit";
import { COUNTRIES } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web. Returns up to 6 results with id, title, url, date and a text excerpt. Use specific queries (include the country, year and local-language terms where useful).",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"],
    },
  },
};

const TOOL_GUIDE = `

TOOLS
You have a web_search tool. Plan your research and call it repeatedly (one focused query per call) to cover: salary benchmarks by level, talent pool size and geography, employers hiring similar roles, in-demand/scarce skills, sourcing channels (boards, communities, universities, associations), employment rules (on-costs, notice, probation, visas) and recent news/trends.
Each search result has a numeric "id". In your final JSON, "sources" must list ONLY results you actually used, with the SAME id numbers, and every claim's "source_ids" must use those ids. Do not invent ids or URLs. When research is complete, reply with the final JSON object only.`;

function collectIds(node, out) {
  if (Array.isArray(node)) node.forEach((n) => collectIds(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "source_ids" && Array.isArray(v)) v.forEach((x) => out.add(Number(x)));
      else if (k !== "sources") collectIds(v, out);
    }
  }
}

function statusFor(q) {
  q = q.toLowerCase();
  if (/salary|salaries|pay |compensation|wage|remuneration|gehalt|sahod|salaire|salario/.test(q)) return "Searching salary data…";
  if (/layoff|news|trend|outlook|forecast|\bai\b|2025|2026/.test(q)) return "Scanning market trends…";
  if (/visa|permit|notice|probation|labou?r|law|social security|contribution|tax|statutory|13th/.test(q)) return "Checking employment rules…";
  if (/universit|communit|association|meetup|forum|board|bootcamp/.test(q)) return "Mapping sourcing channels…";
  if (/hiring|vacanc|careers|employers|companies|openings|jobs/.test(q)) return "Analyzing competitors…";
  if (/talent|pool|supply|demand|shortage|workforce|linkedin|developers|engineers/.test(q)) return "Sizing talent supply…";
  return "Researching the market…";
}

function parseArgs(raw) {
  if (raw && typeof raw === "object") return raw;
  try { return JSON.parse(raw || "{}"); } catch { return {}; }
}

export async function POST(request) {
  const enc = new TextEncoder();
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request body." }, { status: 400 }); }

  const code = process.env.ACCESS_CODE;
  if (code && (request.headers.get("x-access-code") || "") !== code) {
    return Response.json({ error: "Access code missing or incorrect." }, { status: 401 });
  }
  const ip = (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (!rateLimit(ip)) return Response.json({ error: "Rate limit reached. Try again later." }, { status: 429 });

  const i = body && body.inputs ? body.inputs : {};
  const inputs = {
    jd: String(i.jd || "").slice(0, 20000),
    country: String(i.country || ""),
    city: String(i.city || "").slice(0, 200),
    currency: String(i.currency || "").slice(0, 10),
    seniority: String(i.seniority || "").slice(0, 60),
    workmode: String(i.workmode || "").slice(0, 30),
    hireType: i.hireType === "foreign" ? "foreign" : "",
  };
  if (inputs.jd.trim().length < 3) return Response.json({ error: "Please provide a job description or a few role keywords." }, { status: 400 });
  if (!COUNTRIES.includes(inputs.country)) return Response.json({ error: "Please choose a valid country." }, { status: 400 });

  const maxSearches = Math.max(1, Math.min(30, parseInt(process.env.MAX_SEARCHES || "12", 10) || 12));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch {} };
      const signal = request.signal;
      try {
        send({ type: "status", text: "Starting research…" });
        send({ type: "log", text: `Model: ${watsonxModel()}` });

        const messages = [
          { role: "system", content: rules() + TOOL_GUIDE },
          { role: "user", content: briefFrom(inputs) },
        ];
        const registry = []; // {id,title,url,date}
        const byUrl = new Map();
        let searches = 0;
        let finalText = "";

        for (let step = 0; step < maxSearches + 6; step++) {
          const allowTools = searches < maxSearches;
          const { message, finish } = await chat({
            messages,
            tools: allowTools ? [SEARCH_TOOL] : undefined,
            maxTokens: 12000,
            signal,
          });
          const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
          if (!calls.length) {
            finalText = message.content || "";
            if (finish === "length") send({ type: "log", text: "Warning: output hit the token limit and may be truncated." });
            break;
          }
          messages.push({ role: "assistant", content: message.content || "", tool_calls: calls });
          for (const call of calls) {
            const q = String(parseArgs(call.function && call.function.arguments).query || "").slice(0, 300);
            let content;
            if (!q) content = JSON.stringify({ error: "Missing query." });
            else if (searches >= maxSearches) content = JSON.stringify({ error: "Search budget used up. Write the final JSON now." });
            else {
              searches++;
              send({ type: "status", text: statusFor(q) });
              send({ type: "log", text: `Search ${searches}: ${q}` });
              try {
                const results = await webSearch(q, signal);
                const out = results.map((r) => {
                  let id;
                  if (byUrl.has(r.url)) id = byUrl.get(r.url);
                  else { id = registry.length + 1; byUrl.set(r.url, id); registry.push({ id, title: r.title, url: r.url, date: r.date }); }
                  return { id, title: r.title, url: r.url, date: r.date, excerpt: r.content };
                });
                send({ type: "log", text: `  ↳ ${out.length} results` });
                content = JSON.stringify(out);
              } catch (e) {
                send({ type: "log", text: `  ↳ search failed: ${e.message}` });
                content = JSON.stringify({ error: e.message });
                if (/missing TAVILY_API_KEY/.test(e.message) || /error (401|403)/.test(e.message)) throw e;
              }
            }
            messages.push({ role: "tool", tool_call_id: call.id, content });
          }
          if (searches >= maxSearches) {
            messages.push({ role: "user", content: "Search budget is used up. Reply now with the final JSON object only." });
          } else {
            send({ type: "status", text: "Analyzing results…" });
          }
        }

        send({ type: "status", text: "Compiling the report…" });
        let data = extractJSON(finalText);
        if (!data) {
          send({ type: "status", text: "Repairing malformed JSON…" });
          send({ type: "log", text: "Output was not valid JSON - asking the model to repair it." });
          const rep = await chat({
            messages: [
              { role: "system", content: "You repair malformed JSON. Return ONE valid JSON object only - no markdown fences, no commentary. Preserve all content; do not add new facts." },
              { role: "user", content: "Fix this so it is valid JSON following the same structure:\n\n" + finalText.slice(0, 60000) },
            ],
            maxTokens: 12000,
            signal,
          });
          data = extractJSON(rep.message.content || "");
        }

        if (!data) {
          send({ type: "result", raw: finalText, inputs });
        } else {
          // Source list is authoritative from the search registry: no fabricated URLs.
          const used = new Set();
          collectIds(data, used);
          const modelSources = Array.isArray(data.sources) ? data.sources : [];
          let sources = registry
            .filter((r) => used.has(r.id))
            .map((r) => {
              const m = modelSources.find((s) => Number(s && s.id) === r.id) || {};
              return { id: r.id, title: m.title || r.title, publisher: m.publisher || "", url: r.url, date: m.date || r.date || null };
            });
          if (!sources.length) sources = registry.map((r) => ({ id: r.id, title: r.title, publisher: "", url: r.url, date: r.date }));
          data.sources = sources;
          if (!registry.length) {
            data.data_gaps = [...(Array.isArray(data.data_gaps) ? data.data_gaps : []), "No web search results were retrieved. Treat every figure as an unverified model estimate."];
          }
          send({ type: "result", data, inputs });
        }
      } catch (e) {
        if (signal.aborted) send({ type: "error", error: "Research cancelled." });
        else send({ type: "error", error: e && e.message ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" },
  });
}
