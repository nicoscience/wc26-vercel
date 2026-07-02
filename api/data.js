// Vercel serverless function: GET /api/data
// Returns the dashboard's WC_DATA shape from FREE, open, static data sources — no
// API key, no Cloudflare bot-challenge (KickoffAPI's Cloudflare blocks Vercel's
// datacenter IPs, so we route around it entirely):
//   1. openfootball  — https://raw.githubusercontent.com/openfootball/worldcup.json
//                      full results (scores, penalties) + group tables, updated as
//                      the tournament progresses. Primary source.
//   2. TheStatsAPI   — https://www.thestatsapi.com/world-cup/data/fixtures.json
//                      all 104 fixtures (schedule only, no scores). Fallback.
// The bracket in index.html stays authoritative; this only supplies scores/results.

const OPENFOOTBALL_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const THESTATSAPI_URL  = "https://www.thestatsapi.com/world-cup/data/fixtures.json";

const OWNERS = {
  "Mexico":"Alecia Bland","South Africa":"Jessie Edwards","Switzerland":"Rudolf Arada","Canada":"Ayush Nigam",
  "Bosnia and Herzegovina":"Rudolf Arada","Brazil":"Simon Clark","Morocco":"Dan Skipper","USA":"Sally Rooney",
  "Australia":"Ayush Nigam","Paraguay":"Alecia Bland","Germany":"Lucia Noriega","Ivory Coast":"Jordan Dashfield",
  "Ecuador":"Dan Skipper","Netherlands":"Kerry Hiki","Japan":"Lucia Noriega","Sweden":"Rami Elbeltagi",
  "Belgium":"Clinton McClean","Egypt":"Clinton McClean","Spain":"Thomas Mitchell","Cape Verde":"Simon Molenaar",
  "France":"Adam McElroy","Norway":"Rami Elbeltagi","Senegal":"Marc Tinsel","Argentina":"Declan Burke",
  "Austria":"Declan Burke","Algeria":"Adam McElroy","Colombia":"Simon Molenaar","Portugal":"Jordan Dashfield",
  "Democratic Republic of the Congo":"Kerry Hiki","England":"Marc Tinsel","Croatia":"Sally Rooney","Ghana":"Thomas Mitchell"
};
const ALIASES = {
  "united states":"USA","usa":"USA","united states of america":"USA",
  "cote d'ivoire":"Ivory Coast","côte d'ivoire":"Ivory Coast","ivory coast":"Ivory Coast",
  "congo dr":"Democratic Republic of the Congo","dr congo":"Democratic Republic of the Congo",
  "democratic republic of congo":"Democratic Republic of the Congo","democratic republic of the congo":"Democratic Republic of the Congo",
  "cape verde islands":"Cape Verde","cabo verde":"Cape Verde","cape verde":"Cape Verde",
  "bosnia":"Bosnia and Herzegovina","bosnia & herzegovina":"Bosnia and Herzegovina","bosnia and herzegovina":"Bosnia and Herzegovina"
};
const CANON = new Set(Object.keys(OWNERS));
const strip = s => (s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/&/g," and ").replace(/\s+/g," ").toLowerCase().trim();
function normalizeName(n){ if(!n) return null; const k=strip(n); if(ALIASES[k]) return ALIASES[k];
  for(const c of CANON){ if(strip(c)===k) return c; } return n; }
const owned = c => OWNERS[c] || null;

// Feeder placeholders in unplayed knockout slots (openfootball: "W80"/"L101",
// TheStatsAPI: "Winner Match 101"/"Group A Winners"). Not real teams — drop them so
// the bracket's own winner-propagation fills those slots instead.
const PLACEHOLDER = /^(?:[wl]\d+|(?:winner|loser|runner)\b|group\s|.*\bwinners?\b|.*\brunners?-?up\b)/i;
function teamName(n){ if(!n) return null; const t=String(n).trim(); if(!t||PLACEHOLDER.test(t)) return null; return normalizeName(t); }

async function getJSON(url){
  const r=await fetch(url,{headers:{"accept":"application/json"}});
  if(!r.ok) throw new Error(`${r.status} on ${url}`);
  return r.json();
}

// ---- openfootball (primary: results + groups) -----------------------------
function stageFromRound(round){
  const r=String(round||"");
  if(/^matchday/i.test(r))     return "group";
  if(/round of 32/i.test(r))   return "r32";
  if(/round of 16/i.test(r))   return "r16";
  if(/quarter/i.test(r))       return "qf";
  if(/semi/i.test(r))          return "sf";
  return "final"; // "Final" and "Match for third place"
}
function fromOpenfootball(doc){
  const src = Array.isArray(doc?.matches) ? doc.matches : [];
  const matches = src.map((m,i)=>{
    const home=teamName(m.team1), away=teamName(m.team2);
    const sc=m.score||{};
    const hasFt=Array.isArray(sc.ft);
    const fin=Array.isArray(sc.et)?sc.et:(hasFt?sc.ft:null); // final score incl. extra time
    let status="up";
    if(Array.isArray(sc.p)) status="pens"; else if(Array.isArray(sc.et)) status="aet"; else if(hasFt) status="ft";
    const o={ id:"of"+(m.num??i), stage:stageFromRound(m.round), date:m.date, status, minute:null,
      home, away, ownerHome:owned(home), ownerAway:owned(away),
      hg:fin?Number(fin[0]):null, ag:fin?Number(fin[1]):null };
    if(Array.isArray(sc.p)) o.pens={home:Number(sc.p[0]),away:Number(sc.p[1])};
    return o;
  }).filter(m=>m.home&&m.away);
  return { updatedAt:new Date().toISOString(), source:"openfootball", season:2026,
    groups:buildGroups(src), matches };
}
// openfootball has no standings table — compute it from group-stage results.
function buildGroups(src){
  const G={};
  for(const m of src){
    if(!/^matchday/i.test(String(m.round||"")) || !m.group) continue;
    const home=teamName(m.team1), away=teamName(m.team2);
    if(!home||!away) continue;
    const g=String(m.group).replace(/^group\s*/i,"").trim();
    G[g]=G[g]||{};
    const row=t=> (G[g][t]=G[g][t]||{country:t,played:0,win:0,draw:0,lose:0,gf:0,ga:0,points:0});
    const H=row(home), A=row(away);
    const ft=Array.isArray(m.score?.ft)?m.score.ft.map(Number):null;
    if(!ft) continue; // fixture not played yet
    const [h,a]=ft;
    H.played++; A.played++; H.gf+=h; H.ga+=a; A.gf+=a; A.ga+=h;
    if(h>a){ H.win++; A.lose++; H.points+=3; }
    else if(h<a){ A.win++; H.lose++; A.points+=3; }
    else { H.draw++; A.draw++; H.points++; A.points++; }
  }
  return Object.keys(G).sort().map(name=>({
    name,
    teams: Object.values(G[name])
      .map(t=>({country:t.country, owner:owned(t.country), played:t.played, win:t.win, draw:t.draw,
        lose:t.lose, gf:t.gf, ga:t.ga, gd:t.gf-t.ga, points:t.points}))
      .sort((x,y)=> y.points-x.points || y.gd-x.gd || y.gf-x.gf || x.country.localeCompare(y.country))
      .map((t,i)=>({...t, rank:i+1}))
  }));
}

// ---- TheStatsAPI (fallback: schedule only, no scores) ---------------------
function stageFromTS(s){
  s=String(s||"").toLowerCase();
  if(s.includes("32")) return "r32"; if(s.includes("16")) return "r16";
  if(s.includes("quarter")) return "qf"; if(s.includes("semi")) return "sf";
  if(s.includes("third")||s.includes("final")) return "final";
  return "group";
}
function fromTheStatsAPI(doc){
  const fx=Array.isArray(doc?.fixtures)?doc.fixtures:[];
  const matches=fx.map((m,i)=>{
    const home=teamName(m.homeTeam), away=teamName(m.awayTeam);
    return { id:"ts"+(m.matchNumber??i), stage:stageFromTS(m.stage), date:m.kickoffUtc||m.date,
      status:"up", minute:null, home, away, ownerHome:owned(home), ownerAway:owned(away), hg:null, ag:null };
  }).filter(m=>m.home&&m.away);
  return { updatedAt:new Date().toISOString(), source:"TheStatsAPI (fixtures, no scores)", season:2026,
    groups:[], matches };
}

export default async function handler(req, res){
  try{
    let data, errors=[];
    try{ data=fromOpenfootball(await getJSON(OPENFOOTBALL_URL)); }
    catch(e){ errors.push("openfootball: "+String(e.message||e));
      try{ data=fromTheStatsAPI(await getJSON(THESTATSAPI_URL)); }
      catch(e2){ errors.push("thestatsapi: "+String(e2.message||e2)); } }
    if(!data || !data.matches.length){
      res.status(502).json({error:"no data from sources", details:errors}); return;
    }
    if(req.query?.debug){
      res.status(200).json({ source:data.source, matches:data.matches.length,
        played:data.matches.filter(m=>m.hg!=null).length, groups:data.groups.length,
        owned:data.matches.filter(m=>m.ownerHome||m.ownerAway).length, errors, sample:data.matches[0] });
      return;
    }
    // openfootball/TheStatsAPI update infrequently; cache a few minutes at the edge.
    res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");
    res.status(200).json(data);
  }catch(e){ res.status(502).json({error:String(e.message||e)}); }
}
