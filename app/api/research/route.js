import { chat, watsonxModel } from "@/lib/watsonx";
import { webSearch } from "@/lib/search";
import { leanRules, briefFrom } from "@/lib/prompts";
import { extractJSON } from "@/lib/json";
import { rateLimit } from "@/lib/ratelimit";
import { COUNTRIES } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Builds the search queries on the server (no model call): one per report topic.
function buildQueries(inputs) {
  const role = (inputs.jd.split("\n").map((l) => l.trim()).find(Boolean) || "")
    .replace(/[^\p{L}\p{N}\s/+#.&-]/gu, " ").replace(/\s+/g, " ").slice(0, 80).trim();
  const where = inputs.city ? `${inputs.city} ${inputs.country}` : inputs.country;
  const who = `${inputs.seniority ? inputs.seniority + " " : ""}${role}`.trim();
  const year = new Date().getFullYear();
  const qs = [
    `${who} salary ${where} ${year}`,
    `${who} talent pool shortage demand ${where}`,
    `companies hiring ${role} ${where}`,
    `${role} job boards communities universities ${inputs.country}`,
    `employment law notice period probation employer contributions ${inputs.country} ${year}`,
    `${role} hiring market trends news ${inputs.country} ${year}`,
  ];
  if (inputs.hireType === "foreign") qs.push(`work permit visa requirements foreign workers ${inputs.country} ${year}`);
  return qs;
}

function collectIds(node, out) {
  if (Array.isArray(node)) node.forEach((n) => collectIds(n, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "source_ids" && Array.isArray(v)) v.forEach((x) => out.add(Number(x)));
      else if (k !== "sources") collectIds(v, out);
    }
  }
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

  const maxSearches = Math.max(1, Math.min(30, parseInt(process.env.MAX_SEARCHES || "6", 10) || 6));

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch {} };
      const signal = request.signal;
      try {
        send({ type: "status", text: "Starting research…" });
        send({ type: "log", text: `Model: ${watsonxModel()}` });

        const registry = []; // {id,title,url,date}
        const byUrl = new Map();

        // 1) Search: server-built queries run in parallel, no model involved.
        const queries = buildQueries(inputs).slice(0, maxSearches);
        send({ type: "status", text: "Searching the web…" });
        queries.forEach((q, n) => send({ type: "log", text: `Search ${n + 1}: ${q}` }));
        const settled = await Promise.all(
          queries.map(async (q) => {
            try { return { q, results: await webSearch(q, signal) }; }
            catch (e) { return { q, error: e }; }
          })
        );
        const blocks = [];
        for (const s of settled) {
          if (s.error) {
            const msg = s.error.message || String(s.error);
            send({ type: "log", text: `  ↳ search failed (${s.q}): ${msg}` });
            if (/missing TAVILY_API_KEY/.test(msg) || /error (401|403)/.test(msg)) throw s.error;
            continue;
          }
          const out = s.results.map((r) => {
            let id;
            if (byUrl.has(r.url)) id = byUrl.get(r.url);
            else { id = registry.length + 1; byUrl.set(r.url, id); registry.push({ id, title: r.title, url: r.url, date: r.date }); }
            return { id, title: r.title, url: r.url, date: r.date, excerpt: r.content };
          });
          send({ type: "log", text: `  ↳ ${out.length} results: ${s.q}` });
          blocks.push(`QUERY: ${s.q}\n${JSON.stringify(out)}`);
        }

        // 2) Write: ONE model call with all results.
        send({ type: "status", text: "Writing the report…" });
        const { message, finish, usage } = await chat({
          messages: [
            { role: "system", content: leanRules() },
            { role: "user", content: briefFrom(inputs) + "\n\nSEARCH RESULTS:\n" + (blocks.join("\n\n") || "(none retrieved)") },
          ],
          maxTokens: 3500,
          signal,
        });
        const finalText = message.content || "";
        if (finish === "length") send({ type: "log", text: "Warning: output hit the token limit and may be truncated." });
        if (usage) send({ type: "log", text: `Tokens: ${usage.prompt_tokens || 0} in + ${usage.completion_tokens || 0} out = ${usage.total_tokens || 0}` });

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
            maxTokens: 3500,
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
