"use client";

import { useEffect, useRef, useState } from "react";
import { COUNTRIES, CURRENCIES } from "@/lib/data";
import { rules, briefFrom } from "@/lib/prompts";
import { extractJSON } from "@/lib/json";
import { renderReportHtml, renderRawHtml } from "@/lib/render-sections";

const CODE_KEY = "tmr.accessCode";

function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
  return Promise.resolve(fallbackCopy(t));
}
function fallbackCopy(t) {
  const ta = document.createElement("textarea");
  ta.value = t;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch {}
  ta.remove();
}

export default function Page() {
  const [form, setForm] = useState({ jd: "", country: "", city: "", currency: "", seniority: "", workmode: "", hireType: "" });
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState([]);
  const [elapsed, setElapsed] = useState(0);
  const [html, setHtml] = useState("");
  const [promptText, setPromptText] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [pasteBack, setPasteBack] = useState("");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);
  const lastReport = useRef(null);
  const reportRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    try { setAccessCode(localStorage.getItem(CODE_KEY) || ""); } catch {}
  }, []);

  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 500);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    if (form.jd.trim().length < 3) return "Please paste a job description or a few role keywords.";
    const match = COUNTRIES.find((c) => c.toLowerCase() === form.country.trim().toLowerCase());
    if (!match) return "Please choose a country from the list.";
    return { ...form, country: match, currency: form.currency.trim().toUpperCase() };
  }

  function showReport(data, inputs) {
    lastReport.current = data;
    setHtml(renderReportHtml(data, inputs, []));
    setTimeout(() => reportRef.current && reportRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  async function research() {
    setError("");
    setHtml("");
    const v = validate();
    if (typeof v === "string") { setError(v); return; }
    try { localStorage.setItem(CODE_KEY, accessCode); } catch {}
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true);
    setStatus("Starting…");
    setLog([]);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        signal: ctl.signal,
        headers: { "content-type": "application/json", "x-access-code": accessCode },
        body: JSON.stringify({ inputs: v }),
      });
      if (!res.ok) {
        let m = `Request failed (${res.status}).`;
        try { m = (await res.json()).error || m; } catch {}
        throw new Error(m);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let finished = false;
      const handle = (ev) => {
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "log") setLog((l) => [...l, ev.text]);
        else if (ev.type === "error") throw new Error(ev.error);
        else if (ev.type === "result") {
          finished = true;
          if (ev.data) showReport(ev.data, ev.inputs || v);
          else setHtml(renderRawHtml(ev.raw, "The model's reply could not be parsed as the expected JSON, even after a repair attempt. The raw text is shown below."));
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) handle(JSON.parse(line));
        }
      }
      if (!finished) throw new Error("The connection closed before the report was finished (the host may have timed out the request). Try again, or lower MAX_SEARCHES.");
    } catch (e) {
      if (e && e.name === "AbortError") setError("Research cancelled.");
      else setError(e && e.message ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  function copyPrompt() {
    setError("");
    const v = validate();
    if (typeof v === "string") { setError(v); return; }
    const p = rules() + "\n\n----------\n\n" + briefFrom(v);
    setPromptText(p);
    setShowPrompt(false);
    copyText(p);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function renderPasted() {
    setError("");
    const d = extractJSON(pasteBack);
    const inputs = { country: form.country, city: form.city };
    if (d) showReport(d, inputs);
    else setHtml(renderRawHtml(pasteBack, "Could not find valid report JSON in the pasted text. Showing it as raw text instead."));
  }

  function onReportClick(e) {
    const c = e.target.closest("[data-copy]");
    if (c) {
      const pre = c.closest(".ss").querySelector("pre");
      copyText(pre.textContent);
      const o = c.textContent;
      c.textContent = "Copied ✓";
      setTimeout(() => (c.textContent = o), 1500);
      return;
    }
    if (e.target.closest("[data-copy-raw]")) {
      const el = document.getElementById("rawText");
      if (el) copyText(el.textContent);
      return;
    }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "print") window.print();
    if (a.dataset.act === "json" && lastReport.current) {
      const blob = new Blob([JSON.stringify(lastReport.current, null, 2)], { type: "application/json" });
      const u = URL.createObjectURL(blob);
      const l = document.createElement("a");
      l.href = u;
      l.download = "talent-market-report.json";
      document.body.appendChild(l);
      l.click();
      l.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  }

  const mm = Math.floor(elapsed / 60);
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <>
      <header className="top">
        <div className="in">
          <h1>
            Talent Market Researcher
            <small>Live, source-cited talent market reports from a job description</small>
          </h1>
        </div>
      </header>

      <main>
        <section className="panel" id="inputPanel">
          <label htmlFor="jd">Paste the job description here</label>
          <textarea id="jd" value={form.jd} onChange={set("jd")} placeholder="Paste the full job description. Title, seniority, skills and location hints are extracted automatically." />

          <div className="grid two">
            <div>
              <label htmlFor="country">Country</label>
              <input id="country" list="countryList" value={form.country} onChange={set("country")} placeholder="Start typing to search…" autoComplete="off" />
              <datalist id="countryList">{COUNTRIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label htmlFor="city">City / region <span className="opt">(optional)</span></label>
              <input id="city" value={form.city} onChange={set("city")} placeholder="e.g. Cebu, Bavaria, Greater Toronto" />
            </div>
          </div>

          <div className="grid">
            <div>
              <label htmlFor="currency">Currency <span className="opt">(optional)</span></label>
              <input id="currency" list="currencyList" value={form.currency} onChange={set("currency")} placeholder="Default: local + USD" />
              <datalist id="currencyList">{CURRENCIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label htmlFor="seniority">Seniority <span className="opt">(optional)</span></label>
              <select id="seniority" value={form.seniority} onChange={set("seniority")}>
                <option value="">Auto-detect from JD</option>
                {["Intern / Entry level", "Junior", "Mid-level", "Senior", "Lead / Staff", "Manager", "Director", "Executive"].map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="workmode">Work mode <span className="opt">(optional)</span></label>
              <select id="workmode" value={form.workmode} onChange={set("workmode")}>
                <option value="">Not specified</option>
                <option>Onsite</option><option>Hybrid</option><option>Remote</option>
              </select>
            </div>
            <div>
              <label htmlFor="hireType">Hire type <span className="opt">(optional)</span></label>
              <select id="hireType" value={form.hireType} onChange={set("hireType")}>
                <option value="">Local hire</option>
                <option value="foreign">Foreign / relocating hire</option>
              </select>
            </div>
          </div>

          <details className="adv">
            <summary>Access code (only if the site owner enabled one)</summary>
            <div className="row">
              <input type="password" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Access code" autoComplete="off" />
            </div>
          </details>

          <div className="actions">
            <button className="primary" onClick={research} disabled={running}>Research this talent market</button>
            <button onClick={copyPrompt} title="Build a complete prompt you can paste into any AI chatbot with web search">
              {copied ? "Copied ✓" : "Copy research prompt"}
            </button>
          </div>
          <p className="hint" style={{ margin: "10px 0 0" }}>
            Research runs on the server with live web search; the API keys never reach your browser. Prefer another chatbot? Use “Copy research prompt”.
          </p>
        </section>

        {running && (
          <section className="panel" aria-live="polite">
            <div className="status-line">
              <div className="spinner" />
              <span>{status}</span>
              <span className="t">{mm}:{ss}</span>
            </div>
            <ul className="log" ref={logRef}>{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="sm" onClick={() => abortRef.current && abortRef.current.abort()}>Cancel</button>
            </div>
          </section>
        )}

        {promptText && (
          <section className="panel" id="fallbackPanel">
            <strong>Research prompt copied</strong>
            <p className="hint">Paste it into any AI chatbot that has web search (ChatGPT, Claude, Gemini, Perplexity, Copilot…). When it replies with JSON, paste the reply below to render it as a report here.</p>
            <textarea style={{ minHeight: 110 }} value={pasteBack} onChange={(e) => setPasteBack(e.target.value)} placeholder="Paste the chatbot's JSON reply here…" />
            <div className="actions">
              <button onClick={renderPasted}>Render pasted reply</button>
              <button className="sm" onClick={() => setShowPrompt((s) => !s)}>Show prompt text</button>
            </div>
            {showPrompt && <pre className="code">{promptText}</pre>}
          </section>
        )}

        {error && <div className="err" style={{ marginBottom: 16 }}>{error}</div>}

        <div ref={reportRef} onClick={onReportClick} dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    </>
  );
}
