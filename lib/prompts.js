export function todayIso(){ return new Date().toISOString().slice(0,10); }

export const SCHEMA = `{
  "meta": {"country": "", "location": "", "currency_local": "ISO code", "usd_per_local": 0.0, "pref_currency": null, "pref_per_local": null, "fx_note": "rate source/date", "as_of": "YYYY-MM-DD", "overall_confidence": "high|medium|low"},
  "role_snapshot": {"normalized_title": "", "local_titles": [""], "seniority": "", "summary": "", "must_have": [""], "nice_to_have": [""]},
  "salary": {
    "period": "monthly|annual", "currency": "ISO code",
    "levels": [{"level": "Junior|Mid|Senior", "min": 0, "median": 0, "max": 0, "confidence": "high|medium|low", "source_ids": [1]}],
    "bonuses": [""], "allowances": ["13th-month pay, transport, housing, etc. as applicable"], "benefits": [""], "notes": "", "source_ids": [1]
  },
  "supply_demand": {"talent_pool_estimate": "", "pool_basis": "how it was estimated", "competition_level": "Low|Medium|High", "hiring_difficulty": 1, "difficulty_reason": "one line", "confidence": "high|medium|low", "source_ids": [1]},
  "locations": [{"name": "", "talent_index": 0, "talent_estimate": "", "note": "", "source_ids": [1]}],
  "competitors": [{"employer": "", "notable_roles": [""], "offers": "", "url": "", "source_ids": [1]}],
  "skills": {"in_demand": [""], "scarce": [""], "adjacent": [""], "alt_backgrounds": [""], "source_ids": [1]},
  "channels": [{"type": "Job board|Community|University|Association|Social|Other", "name": "", "url": "", "note": ""}],
  "search_strings": [{"platform": "LinkedIn|Google X-ray|Other", "language": "", "label": "", "string": ""}],
  "employment": {"employer_oncosts": [""], "notice_periods": "", "probation": "", "visa_notes": "", "contract_types": [""], "disclaimer": "General information only, not legal advice.", "source_ids": [1]},
  "offer_strategy": {"time_to_fill": "", "recommended_offer": {"min": 0, "max": 0, "currency": "ISO code", "period": "monthly|annual", "rationale": ""}, "candidate_values": [""], "red_flags": [""], "risks": [""], "source_ids": [1]},
  "trends": [{"headline": "", "summary": "", "date": "YYYY-MM or YYYY-MM-DD", "impact": "positive|negative|neutral", "source_ids": [1]}],
  "sources": [{"id": 1, "title": "", "publisher": "", "url": "", "date": "publication date or null"}],
  "data_gaps": [""]
}`;

export function rules(){
  return `You are a senior talent-market research analyst. Today's date is ${todayIso()}. Use web search extensively and iteratively (salary data, job postings, competitors, talent geography, labour rules, news) so that findings reflect CURRENT data, preferring sources from the last 12-24 months.

RULES
- Never invent numbers. If a figure cannot be supported by a source, set it to null and add an entry to "data_gaps". Mark estimates with confidence "low".
- Every salary, pool-size, trend and employment claim must reference entries in "sources" via "source_ids". Include the real URL and publication date where available.
- Salary figures must be plain numbers (no symbols, no thousands separators) in the local currency and the stated period. "usd_per_local" is the USD value of 1 unit of local currency (1 if local is USD). If the user requested another currency, also fill "pref_currency" and "pref_per_local".
- Provide Junior, Mid and Senior salary levels where possible.
- "talent_index" in locations is a relative 0-100 score (100 = the largest talent concentration).
- Write search strings in the local language when relevant (add an English version too). Provide at least 3 LinkedIn strings and 3 Google X-ray strings (e.g. site:linkedin.com/in, site:github.com, relevant local sites).
- Employment & hiring context is general information, not legal advice.
- Keep each text field concise. Prefer short phrases.
- OUTPUT FORMAT: respond with ONE valid JSON object and nothing else - no markdown fences, no commentary before or after. Use this structure exactly:

${SCHEMA}`;
}

export function briefFrom(i){
  const lines=[
    `TARGET COUNTRY: ${i.country}`,
    `CITY / REGION: ${i.city||"(not specified - cover the whole country and rank the best regions)"}`,
    `CURRENCY: ${i.currency?`Local currency plus ${i.currency}`:"Local currency plus USD"}`,
    `SENIORITY OVERRIDE: ${i.seniority||"(none - infer from the job description)"}`,
    `WORK MODE: ${i.workmode||"(not specified)"}`,
    `HIRE TYPE: ${i.hireType==="foreign"?"Foreign / relocating hire (cover work-permit and visa requirements)":"Local hire (mention visa notes only briefly)"}`,
    ``,
    `JOB DESCRIPTION:`,
    `"""`,
    i.jd,
    `"""`,
    ``,
    `Extract the role, seniority, must-have and nice-to-have skills from the job description, then research the talent market for this role in the target location and return the JSON report. If the input is only a short list of keywords or technologies rather than a full job description, infer the most likely role title and seniority from them, say so in role_snapshot.summary, treat the keywords as must-have skills, and add the assumption to data_gaps.`
  ];
  return lines.join("\n");
}

