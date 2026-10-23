// Pure HTML-string renderer for the report. Every dynamic value is escaped via esc().
export const esc = s => String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = x => Array.isArray(x)?x:(x==null||x===""?[]:[x]);
const isNum = x => typeof x==="number" && isFinite(x);
function safeUrl(u){ try{ const p=new URL(String(u)); return /^https?:$/.test(p.protocol)?p.href:""; }catch(e){ return ""; } }
function link(u,text){ const s=safeUrl(u); return s?`<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(text||s)}</a>`:esc(text||u||""); }
export function today(){ return new Date().toISOString().slice(0,10); }
function fmtNum(n){ if(!isNum(n)) return "—"; const a=Math.abs(n); return new Intl.NumberFormat("en-US",{maximumFractionDigits:a<100?2:0}).format(n); }
function money(n,cur){ return isNum(n)?`${esc(cur||"")} ${fmtNum(n)}`.trim():"—"; }
function refs(ids){ const a=arr(ids).filter(x=>isNum(Number(x))); return a.length?`<sup class="ref">${a.map(i=>`<a href="#src-${esc(i)}">[${esc(i)}]</a>`).join("")}</sup>`:""; }
function conf(c){ c=String(c||"").toLowerCase(); return /^(high|medium|low)$/.test(c)?` <span class="badge ${c}" title="Confidence in this figure">${c}</span>`:""; }
function chips(list,cls){ const a=arr(list); return a.length?`<div class="chips">${a.map(x=>`<span class="chip ${cls||""}">${esc(typeof x==="object"?(x.name||x.skill||JSON.stringify(x)):x)}</span>`).join("")}</div>`:`<span class="muted">No data</span>`; }
function ul(list){ const a=arr(list); return a.length?`<ul class="tight">${a.map(x=>`<li>${esc(typeof x==="object"?JSON.stringify(x):x)}</li>`).join("")}</ul>`:`<span class="muted">No data</span>`; }
function card(n,title,body){ return `<section class="card"><h2><span class="n">${n}</span>${esc(title)}</h2>${body}</section>`; }
function sec1(r){
  return card(1,"Role Snapshot",`
    <div class="cols"><div>
      <h3>Normalized title</h3><div><strong>${esc(r.normalized_title||"—")}</strong></div>
      <h3>Seniority</h3><div>${esc(r.seniority||"—")}</div>
      <h3>Local-market equivalent titles</h3>${chips(r.local_titles)}
    </div><div>
      <h3>Summary</h3><div>${esc(r.summary||"—")}</div>
    </div></div>
    <div class="cols"><div><h3>Must-have skills</h3>${chips(r.must_have,"must")}</div>
    <div><h3>Nice-to-have skills</h3>${chips(r.nice_to_have)}</div></div>`);
}

function sec2(s,cur,usd,m){
  const levels=arr(s.levels).filter(l=>l&&(isNum(l.min)||isNum(l.median)||isNum(l.max)));
  const per=s.period||"";
  const pref=m.pref_currency&&isNum(m.pref_per_local)?m.pref_currency:null;
  let body="";
  if(!levels.length){ body+=`<span class="muted">No reliable salary data found for this role and location.</span>`; }
  else{
    const lo=Math.min(...levels.map(l=>isNum(l.min)?l.min:(isNum(l.median)?l.median:l.max)));
    const hi=Math.max(...levels.map(l=>isNum(l.max)?l.max:(isNum(l.median)?l.median:l.min)));
    const span=(hi-lo)||1;
    const toUsd=v=>isNum(usd)&&isNum(v)&&cur.toUpperCase()!=="USD"?` · ≈ USD ${fmtNum(v*usd)}`:"";
    levels.forEach(l=>{
      const mn=isNum(l.min)?l.min:(isNum(l.median)?l.median:l.max), mx=isNum(l.max)?l.max:(isNum(l.median)?l.median:l.min);
      const left=((mn-lo)/span)*100, width=Math.max(1.5,((mx-mn)/span)*100);
      const medPos=isNum(l.median)?((l.median-lo)/span)*100:null;
      body+=`<div class="rng"><div class="lab"><div>${esc(l.level||"Level")}${conf(l.confidence)}${refs(l.source_ids)}</div><span>median ${money(l.median,cur)}${toUsd(l.median)}${pref?` · ≈ ${esc(pref)} ${fmtNum(l.median*m.pref_per_local)}`:""}</span></div>
      <div class="track"><div class="bar" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></div>${medPos!=null?`<div class="med" style="left:calc(${medPos.toFixed(1)}% - 1px)"></div>`:""}</div>
      <div class="vals"><span>min ${money(l.min,cur)}${toUsd(l.min)}</span><span>max ${money(l.max,cur)}${toUsd(l.max)}</span></div></div>`;
    });
    body+=`<div class="hint">Per ${esc(per||"period")} · bar = min–max range, dark tick = median${isNum(usd)?` · FX: 1 ${esc(cur)} = ${fmtNum(usd)} USD${m.fx_note?" ("+esc(m.fx_note)+")":""}`:""}</div>`;
    body+=`<table style="margin-top:12px"><thead><tr><th>Level</th><th class="num">Min</th><th class="num">Median</th><th class="num">Max</th>${isNum(usd)&&cur.toUpperCase()!=="USD"?`<th class="num">Median (USD)</th>`:""}</tr></thead><tbody>${
      levels.map(l=>`<tr><td>${esc(l.level||"")}</td><td class="num">${fmtNum(l.min)}</td><td class="num">${fmtNum(l.median)}</td><td class="num">${fmtNum(l.max)}</td>${isNum(usd)&&cur.toUpperCase()!=="USD"?`<td class="num">${isNum(l.median)?fmtNum(l.median*usd):"—"}</td>`:""}</tr>`).join("")}</tbody></table>`;
  }
  body+=`<div class="cols"><div><h3>Typical bonuses</h3>${ul(s.bonuses)}</div><div><h3>13th-month / allowances</h3>${ul(s.allowances)}</div></div>
    <h3>Benefits</h3>${ul(s.benefits)}${s.notes?`<div class="disc">${esc(s.notes)} ${refs(s.source_ids)}</div>`:(arr(s.source_ids).length?`<div class="disc">Sources: ${refs(s.source_ids)}</div>`:"")}`;
  return card(2,"Salary Benchmarks",body);
}

function sec3(s){
  const lvl=String(s.competition_level||"").toLowerCase();
  const idx=lvl.startsWith("l")?0:lvl.startsWith("m")?1:lvl.startsWith("h")?2:-1;
  const cls=["l","m","h"], names=["Low","Medium","High"];
  const gauge=`<div class="gauge">${names.map((n,i)=>`<div class="${i===idx?"on "+cls[i]:""}">${n}</div>`).join("")}</div>`;
  const dv=isNum(s.hiring_difficulty)?Math.max(1,Math.min(10,Math.round(s.hiring_difficulty))):null;
  const color=dv==null?"":dv<=3?"var(--good)":dv<=6?"var(--warn)":"var(--bad)";
  const bar=dv==null?"":`<div class="diff">${Array.from({length:10},(_,i)=>`<i style="${i<dv?"background:"+color:""}"></i>`).join("")}</div>`;
  return card(3,"Talent Supply vs Demand",`
    <div class="cols"><div>
      <h3>Estimated talent pool</h3><div><strong>${esc(s.talent_pool_estimate||"No reliable estimate")}</strong>${conf(s.confidence)}${refs(s.source_ids)}</div>
      ${s.pool_basis?`<div class="hint">${esc(s.pool_basis)}</div>`:""}
      <h3>Competition level</h3>${gauge}
    </div><div>
      <h3>Hiring difficulty (1 = easy, 10 = very hard)</h3>
      <div class="stat"><span class="bigscore" style="color:${color}">${dv==null?"—":dv}<small class="muted" style="font-size:14px">/10</small></span></div>${bar}
      <div>${esc(s.difficulty_reason||"")}</div>
    </div></div>`);
}

function sec4(locs){
  if(!locs.length) return card(4,"Where the Talent Is",`<span class="muted">No location data found.</span>`);
  const sorted=[...locs].sort((a,b)=>(Number(b.talent_index)||0)-(Number(a.talent_index)||0));
  const mx=Math.max(1,...sorted.map(l=>Number(l.talent_index)||0));
  return card(4,"Where the Talent Is",
    sorted.map(l=>{ const v=Number(l.talent_index)||0; return `<div class="hbar"><div>${esc(l.name)}</div><div class="b"><i style="width:${(v/mx*100).toFixed(1)}%"></i></div><div class="muted">${isNum(Number(l.talent_index))?v:"—"}</div></div>`; }).join("")+
    `<div class="hint">Relative talent concentration index (100 = largest).</div>
    <table style="margin-top:8px"><thead><tr><th>Location</th><th>Estimate</th><th>Notes</th></tr></thead><tbody>${
      sorted.map(l=>`<tr><td>${esc(l.name)}</td><td>${esc(l.talent_estimate||"—")}</td><td>${esc(l.note||"")} ${refs(l.source_ids)}</td></tr>`).join("")}</tbody></table>`);
}

function sec5(c){
  if(!c.length) return card(5,"Who Is Hiring (Competitors)",`<span class="muted">No competitor data found.</span>`);
  return card(5,"Who Is Hiring (Competitors)",`<table><thead><tr><th>Employer</th><th>Notable open roles</th><th>What they offer</th></tr></thead><tbody>${
    c.map(x=>`<tr><td>${x.url?link(x.url,x.employer):esc(x.employer)}</td><td>${ul(x.notable_roles)}</td><td>${esc(x.offers||"—")} ${refs(x.source_ids)}</td></tr>`).join("")}</tbody></table>`);
}

function sec6(s){
  return card(6,"Skills Market",`<div class="cols"><div><h3>Most in demand</h3>${chips(s.in_demand,"hot")}</div><div><h3>Scarce skills</h3>${chips(s.scarce,"scarce")}</div></div>
    <div class="cols"><div><h3>Adjacent / transferable skills</h3>${chips(s.adjacent)}</div><div><h3>Alternative backgrounds worth considering</h3>${chips(s.alt_backgrounds)}</div></div>${arr(s.source_ids).length?`<div class="disc">Sources: ${refs(s.source_ids)}</div>`:""}`);
}

function sec7(ch){
  if(!ch.length) return card(7,"Sourcing Channels",`<span class="muted">No channel data found.</span>`);
  const groups={}; ch.forEach(c=>{ const k=c.type||"Other"; (groups[k]=groups[k]||[]).push(c); });
  return card(7,"Sourcing Channels",Object.keys(groups).map(k=>`<h3>${esc(k)}</h3><ul class="tight">${
    groups[k].map(c=>`<li>${link(c.url,c.name)}${c.note?` <span class="muted">- ${esc(c.note)}</span>`:""}</li>`).join("")}</ul>`).join(""));
}

function sec8(ss){
  if(!ss.length) return card(8,"Boolean / X-ray Search Strings",`<span class="muted">No search strings returned.</span>`);
  return card(8,"Boolean / X-ray Search Strings",ss.map(x=>`<div class="ss"><div class="hd"><span><b>${esc(x.platform||"Search")}</b>${x.language?` · ${esc(x.language)}`:""}${x.label?` · ${esc(x.label)}`:""}</span><span class="noprint"><button class="sm" data-copy>Copy</button>${x.platform&&/google/i.test(x.platform)?` <a class="sm" href="https://www.google.com/search?q=${encodeURIComponent(x.string||"")}" target="_blank" rel="noopener noreferrer">Open in Google</a>`:""}</span></div><pre class="code">${esc(x.string||"")}</pre></div>`).join(""));
}

function sec9(e){
  return card(9,"Employment & Hiring Context",`
    <div class="cols"><div><h3>Employer on-costs / statutory contributions</h3>${ul(e.employer_oncosts)}
      <h3>Common contract types</h3>${ul(e.contract_types)}</div>
    <div><h3>Notice periods</h3><div>${esc(e.notice_periods||"No data")}</div>
      <h3>Probation</h3><div>${esc(e.probation||"No data")}</div>
      <h3>Work permit / visa notes</h3><div>${esc(e.visa_notes||"No data")}</div></div></div>
    ${arr(e.source_ids).length?`<div class="hint">Sources: ${refs(e.source_ids)}</div>`:""}
    <div class="disc"><strong>Not legal advice.</strong> This is general information gathered from public sources and may be out of date or incomplete. Confirm with local counsel or a licensed employer-of-record before making hiring decisions.</div>`);
}

function sec10(o,cur){
  const r=o.recommended_offer||{};
  return card(10,"Time-to-Hire & Offer Strategy",`
    <div class="cols"><div>
      <h3>Typical time-to-fill</h3><div><strong>${esc(o.time_to_fill||"No data")}</strong></div>
      <h3>Recommended offer range</h3><div><strong>${isNum(r.min)||isNum(r.max)?`${money(r.min,r.currency||cur)} – ${money(r.max,r.currency||cur)}${r.period?` / ${esc(r.period)}`:""}`:"No reliable recommendation"}</strong></div>
      ${r.rationale?`<div class="hint">${esc(r.rationale)}</div>`:""}
      <h3>What candidates value most locally</h3>${ul(o.candidate_values)}
    </div><div>
      <h3>Red flags</h3>${ul(o.red_flags)}
      <h3>Risks</h3>${ul(o.risks)}
    </div></div>${arr(o.source_ids).length?`<div class="hint">Sources: ${refs(o.source_ids)}</div>`:""}`);
}

function sec11(t){
  if(!t.length) return card(11,"Market Trends",`<span class="muted">No recent trend data found.</span>`);
  const sym={positive:"▲",negative:"▼",neutral:"●"}, col={positive:"var(--good)",negative:"var(--bad)",neutral:"var(--muted)"};
  return card(11,"Market Trends",t.map(x=>{ const k=String(x.impact||"neutral").toLowerCase(); return `<div style="margin:0 0 10px"><span style="color:${col[k]||col.neutral}">${sym[k]||sym.neutral}</span> <strong>${esc(x.headline||"")}</strong> ${x.date?`<span class="muted">(${esc(x.date)})</span>`:""} ${refs(x.source_ids)}<div>${esc(x.summary||"")}</div></div>`; }).join(""));
}

function sec12(src,gaps,m){
  let body="";
  body+= src.length ? `<ol class="src">${src.map((s,i)=>{ const id=s.id!=null?s.id:i+1; return `<li id="src-${esc(id)}" value="${esc(id)}">${link(s.url,s.title||s.url)}${s.publisher?` - ${esc(s.publisher)}`:""}${s.date?` <span class="muted">(${esc(s.date)})</span>`:""}</li>`; }).join("")}</ol>`
                   : `<span class="muted">No sources were returned. Treat all figures as unverified.</span>`;
  if(gaps.length) body+=`<h3>Data gaps / low-confidence items</h3>${ul(gaps)}`;
  body+=`<div class="disc">Figures marked <span class="badge low">low</span> are estimates or based on thin data. Missing data is shown as “No data” rather than guessed. Verify key numbers against the linked sources before acting.</div>`;
  return card(12,"Sources",body);
}

export function renderReportHtml(d, inputs, extraSources){
  const m=d.meta||{};
  const cur=(d.salary&&d.salary.currency)||m.currency_local||"";
  const usd=m.usd_per_local;
  let sources=arr(d.sources).filter(x=>x&&x.url);
  if(!sources.length&&extraSources&&extraSources.length){
    sources=extraSources.map((x,i)=>({id:i+1,title:x.title,url:x.url,date:x.date,publisher:""}));
  }
  const parts=[];
  parts.push(`<div class="reporthead"><div><h2>${esc((d.role_snapshot&&d.role_snapshot.normalized_title)||"Talent market report")}</h2>
    <div class="muted">${esc(inputs.city?inputs.city+", ":"")}${esc(inputs.country)} · as of ${esc(m.as_of||today())}${m.overall_confidence?` · overall confidence ${conf(m.overall_confidence)}`:""}</div></div>
    <div class="noprint actions" style="margin:0"><button data-act="json">Download JSON</button><button data-act="print">Print / PDF</button></div></div>`);
  parts.push(sec1(d.role_snapshot||{}));
  parts.push(sec2(d.salary||{},cur,usd,m));
  parts.push(sec3(d.supply_demand||{}));
  parts.push(sec4(arr(d.locations)));
  parts.push(sec5(arr(d.competitors)));
  parts.push(sec6(d.skills||{}));
  parts.push(sec7(arr(d.channels)));
  parts.push(sec8(arr(d.search_strings)));
  parts.push(sec9(d.employment||{}));
  parts.push(sec10(d.offer_strategy||{},cur));
  parts.push(sec11(arr(d.trends)));
  parts.push(sec12(sources,arr(d.data_gaps),m));
  return parts.join("");
}

export function renderRawHtml(text,msg){
  return `<div class="card"><h2>Raw response</h2><div class="notice">${esc(msg)}</div>
  <div class="actions"><button data-copy-raw>Copy raw text</button></div>
  <div class="rawbox" id="rawText">${esc(text||"(empty response)")}</div></div>`;
}
