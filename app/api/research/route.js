import { chat, watsonxModel } from "@/lib/watsonx";
import { webSearch, hasSearchKey } from "@/lib/search";
import { leanRules, briefFrom } from "@/lib/prompts";
import { extractJSON } from "@/lib/json";
import { rateLimit } from "@/lib/ratelimit";
import { COUNTRIES } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function cleanRole(s) {
  return String(s || "").replace(/[^\p{L}\p{N}\s/+#.&-]/gu, " ").replace(/\s+/g, " ").slice(0, 80).trim();
}

// Short keyword input is used as-is. A longer job description gets a tiny model call
// (~300 tokens) to pull out the job title; on any failure we fall back to its first line.
async function extractRole(inputs, signal, creds) {
  const firstLine = cleanRole(inputs.jd.split("\n").map((l) => l.trim()).find(Boolean));
  if (inputs.jd.trim().length <= 80) return cleanRole(inputs.jd) || firstLine;
  try {
    const { message } = await chat({
      messages: [
        { role: "system", content: "Reply with ONLY the job title this job description is hiring for (2-6 words, e.g. \"Senior Data Engineer\"). No punctuation, no explanation." },
        { role: "user", content: inputs.jd.slice(0, 1500) },
      ],
      maxTokens: 20,
      signal,
      creds,
    });
    return cleanRole(String(message.content || "").split("\n")[0]) || firstLine;
  } catch {
    return firstLine;
  }
}

// Builds the search queries on the server: one per report topic. Salary gets longer excerpts.
function buildQueries(inputs, role) {
  const where = inputs.city ? `${inputs.city} ${inputs.country}` : inputs.country;
  const who = `${inputs.seniority ? inputs.seniority + " " : ""}${role}`.trim();
  const year = new Date().getFullYear();
  const qs = [
    { q: `${who} salary ${where} ${year}`, maxChars: 600 },
    { q: `${who} talent pool shortage demand ${where}` },
    { q: `companies hiring ${role} ${where}` },
    { q: `${role} job boards communities universities ${inputs.country}` },
    { q: `employment law notice period probation employer contributions ${inputs.country} ${year}` },
    { q: `${role} hiring market trends news ${inputs.country} ${year}` },
  ];
  if (inputs.hireType === "foreign") qs.push({ q: `work permit visa requirements foreign workers ${inputs.country} ${year}` });
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

  // Optional bring-your-own credentials (used only for this request, never stored or logged).
  const c = body && body.creds && typeof body.creds === "object" ? body.creds : {};
  const creds = {
    apiKey: String(c.wxApiKey || "").slice(0, 200),
    url: String(c.wxUrl || "").slice(0, 200),
    projectId: String(c.wxProjectId || "").slice(0, 100),
  };
  const tavilyKey = String(c.tavilyKey || "").slice(0, 200);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch {} };
      const signal = request.signal;
      try {
        send({ type: "status", text: "Starting research…" });
        const ownWx = Boolean(creds.apiKey || creds.url || creds.projectId);
        send({ type: "log", text: `Model: ${watsonxModel(creds)}${ownWx ? " (your watsonx project)" : ""}` });

        const registry = []; // {id,title,url,date}
        const byUrl = new Map();

        // 1) Search: server-built queries run in parallel, no model involved.
        send({ type: "status", text: "Identifying the role…" });
        const role = await extractRole(inputs, signal, creds);
        send({ type: "log", text: `Role: ${role}` });

        // Web search is optional: with no Tavily key, or if Tavily fails/limits us, the report is
        // still written from the model's own knowledge and flagged as unverified.
        const notes = []; // shown in the report's "data gaps"
        const blocks = [];
        let settled = [];
        if (!hasSearchKey(tavilyKey)) {
          send({ type: "log", text: "No Tavily key configured - skipping web search." });
          notes.push("Web search was not available (no Tavily API key configured), so figures are unverified model estimates with no sources.");
        } else {
          const queries = buildQueries(inputs, role).slice(0, maxSearches);
          send({ type: "status", text: "Searching the web…" });
          queries.forEach((x, n) => send({ type: "log", text: `Search ${n + 1}: ${x.q}` }));
          const run = async (q, maxChars) => {
            try { return { q, results: await webSearch(q, signal, { maxChars, apiKey: tavilyKey }) }; }
            catch (e) { return { q, error: e }; }
          };
          settled = await Promise.all(
            queries.map(async ({ q, maxChars }) => {
              let r = await run(q, maxChars);
              if (r.error && r.error.kind === "rate" && !signal.aborted) {
                await new Promise((res) => setTimeout(res, 1500)); // one retry on 429
                r = await run(q, maxChars);
              }
              return r;
            })
          );
        }
        const failed = settled.filter((s) => s.error);
        if (failed.length) {
          const kinds = new Set(failed.map((s) => s.error.kind));
          const all = failed.length === settled.length;
          const why = kinds.has("quota")
            ? "the Tavily search quota/plan limit has been reached"
            : kinds.has("rate")
            ? "Tavily rate-limited the requests"
            : kinds.has("auth")
            ? "the Tavily API key was rejected"
            : "the search service returned errors";
          notes.push(
            all
              ? `Web search failed (${why}), so figures are unverified model estimates with no sources.`
              : `${failed.length} of ${settled.length} web searches failed (${why}); some sections have less evidence.`
          );
          send({ type: "log", text: `Search problem: ${why}.` });
        }
        for (const s of settled) {
          if (s.error) {
            send({ type: "log", text: `  ↳ search failed (${s.q}): ${s.error.message || s.error}` });
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
            {
              role: "user",
              content:
                briefFrom(inputs) +
                (blocks.length
                  ? "\n\nSEARCH RESULTS:\n" + blocks.join("\n\n")
                  : "\n\nNO WEB SEARCH RESULTS are available. Use \"sources\": [] and no source_ids. Give only clearly hedged estimates from general knowledge, mark every confidence \"low\", set unknown figures to null, and list this limitation in data_gaps."),
            },
          ],
          maxTokens: 3500,
          signal,
          creds,
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
            creds,
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
          if (!registry.length && !notes.length) notes.push("No web search results were retrieved. Treat every figure as an unverified model estimate.");
          if (notes.length) data.data_gaps = [...notes, ...(Array.isArray(data.data_gaps) ? data.data_gaps : [])];
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
