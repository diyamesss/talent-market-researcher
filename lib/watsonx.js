// Server-only watsonx.ai client: IAM token (cached) + chat API.

let cached = { token: null, exp: 0 };

function cfg() {
  const apiKey = process.env.WATSONX_API_KEY;
  const url = (process.env.WATSONX_URL || "").replace(/\/+$/, "");
  const projectId = process.env.WATSONX_PROJECT_ID;
  const model = process.env.WATSONX_MODEL || "meta-llama/llama-3-3-70b-instruct";
  const missing = [];
  if (!apiKey) missing.push("WATSONX_API_KEY");
  if (!url) missing.push("WATSONX_URL");
  if (!projectId) missing.push("WATSONX_PROJECT_ID");
  if (missing.length) throw new Error("Server is missing environment variables: " + missing.join(", "));
  return { apiKey, url, projectId, model };
}

async function getToken(apiKey, signal) {
  const now = Date.now();
  if (cached.token && cached.exp - 60_000 > now) return cached.token;
  const res = await fetch("https://iam.cloud.ibm.com/identity/token", {
    method: "POST",
    signal,
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "urn:ibm:params:oauth:grant-type:apikey", apikey: apiKey }),
  });
  const text = await res.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  if (!res.ok || !j.access_token) {
    throw new Error(`IBM IAM token error ${res.status}: ${j.errorMessage || j.error_description || text.slice(0, 200)}`);
  }
  cached = { token: j.access_token, exp: (j.expiration ? j.expiration * 1000 : now + (j.expires_in || 3600) * 1000) };
  return cached.token;
}

export function watsonxModel() {
  return cfg().model;
}

export async function chat({ messages, tools, maxTokens = 8000, signal }) {
  const { apiKey, url, projectId, model } = cfg();
  const token = await getToken(apiKey, signal);
  const body = {
    model_id: model,
    project_id: projectId,
    messages,
    max_tokens: maxTokens,
    temperature: 0,
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice_option = "auto";
  }
  const res = await fetch(`${url}/ml/v1/text/chat?version=2024-10-08`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let j = {};
  try { j = JSON.parse(text); } catch {}
  if (res.status === 401) cached = { token: null, exp: 0 };
  if (!res.ok) {
    const msg = (j.errors && j.errors[0] && j.errors[0].message) || j.message || text.slice(0, 300);
    throw new Error(`watsonx.ai error ${res.status}: ${msg}`);
  }
  const choice = j.choices && j.choices[0];
  if (!choice) throw new Error("watsonx.ai returned no choices.");
  return { message: choice.message || {}, finish: choice.finish_reason };
}
