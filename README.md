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
| `TAVILY_API_KEY` | Web search provider key (watsonx has no built-in web search) |
| `ACCESS_CODE` | Optional. If set, users must enter it in the UI. Protects your credits |
| `MAX_SEARCHES` | Searches per run (default 12) |
| `RATE_LIMIT_PER_HOUR` | Per-IP runs per hour (default 10, in-memory) |

## Notes

- Sources in the report come from the real search results the server retrieved; the model cannot add its own URLs.
- Long runs stream progress over NDJSON. On Vercel, `maxDuration` is 300s (needs a plan that allows it); lower `MAX_SEARCHES` if your host times out.
- "Copy research prompt" still works for running the research in any other chatbot, then pasting the JSON reply back.
- The standalone `../talent-market-researcher.html` is unchanged.
