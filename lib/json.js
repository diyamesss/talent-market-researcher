function scanObject(text,start){
  let depth=0,inStr=false,esc_=false;
  for(let i=start;i<text.length;i++){
    const c=text[i];
    if(inStr){ if(esc_) esc_=false; else if(c==="\\") esc_=true; else if(c==='"') inStr=false; continue; }
    if(c==='"') inStr=true;
    else if(c==="{") depth++;
    else if(c==="}"){ depth--; if(depth===0) return text.slice(start,i+1); }
  }
  return null;
}
export function extractJSON(text){
  if(!text) return null;
  text=String(text).replace(/```(?:json)?/gi,"");
  let tries=0;
  for(let i=text.indexOf("{");i!==-1&&tries<25;i=text.indexOf("{",i+1),tries++){
    const cand=scanObject(text,i); if(!cand) continue;
    for(const c of [cand,cand.replace(/,\s*([}\]])/g,"$1")]){
      try{ const o=JSON.parse(c); if(o&&typeof o==="object"&&(o.role_snapshot||o.salary||o.sources)) return o; }catch(e){}
    }
  }
  return null;
}

