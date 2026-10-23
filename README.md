# Talent Market Researcher (Next.js + watsonx.ai)

Paste a job description, pick a country, get a source-cited talent market report.
Research runs on the server: watsonx.ai (tool calling) + Tavily web search. API keys never reach the browser.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in WATSONX_API_KEY and TAVILY_API_KEY
npm run dev                  # http://localhost:3000
```

Production: `npm run build && npm start`, or deploy to Vercel / any Node host and set the same variables there.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `WATSONX_API_KEY` | IBM Cloud API key (server-side only) |
| `WATSONX_URL` | e.g. `https://us-south.ml.cloud.ibm.com` |
| `WATSONX_PROJECT_ID` | watsonx.ai project ID |
| `WATSONX_MODEL` | Must support tool calling. Verified: `meta-llama/llama-3-3-70b-instruct`, `mistralai/mistral-medium-2505`, `openai/gpt-oss-120b` |
| `TAVILY_API_KEY` | Optional. Web search provider key (watsonx has no built-in web search). Without any Tavily key the report is written without search and flagged as unverified |
| `ACCESS_CODE` | Optional. If set, users must enter it in the UI. Protects your credits |
| `MAX_SEARCHES` | Searches per run (default 6; run in parallel, then one model call writes the report) |
| `RATE_LIMIT_PER_HOUR` | Per-IP runs per hour (default 10, in-memory) |

## Bring your own keys

The page has a "Use my own API keys" section. Users can enter their own watsonx API key, URL and project ID (all three required together; the URL must be a `*.ml.cloud.ibm.com` host) and optionally their own Tavily key. They are sent per request, never stored or logged by the server, and kept in the browser tab's `sessionStorage` only.

## If Tavily is unavailable

Search failures never abort a run. A 429 is retried once; auth failures (401/403), plan limits (432/433) and other errors are reported in the log and in the report's data gaps, and the report is written from the model's knowledge with no sources.


## Notes

- Sources in the report come from the real search results the server retrieved; the model cannot add its own URLs.
- Long runs stream progress over NDJSON. On Vercel, `maxDuration` is 300s (needs a plan that allows it); lower `MAX_SEARCHES` if your host times out.
- "Copy research prompt" still works for running the research in any other chatbot, then pasting the JSON reply back.
- The standalone `../talent-market-researcher.html` is unchanged.
