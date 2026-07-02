// Vercel serverless function: GET /api/data
// Fetches live World Cup 2026 data from KickoffAPI (key from env) and returns the
// dashboard's WC_DATA shape. The API key stays server-side; the browser only sees JSON.
//
// Required env var (set in Vercel → Project → Settings → Environment Variables):
//   KICKOFF_API_KEY   your KickoffAPI key
// Optional:
//   KICKOFF_LEAGUE_ID (defaults to auto-detecting the World Cup finals)
//   KICKOFF_SEASON    (defaults to 2026)

const BASE = "https://api.kickoffapi.com/api/v1";

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
function mapStatus(s){ s=(s||"").toUpperCase();
  if(["NS","TBD","PST"].includes(s)) return "up";
  if(["1H","2H","ET","BT","LIVE","INT"].includes(s)) return "live";
  if(s==="HT") return "ht"; if(s==="P"||s==="PEN") return "pens"; if(s==="AET") return "aet";
  if(["FT","AWD","WO"].includes(s)) return "ft"; return "up"; }
function stageByDate(iso){ const t=new Date(iso).getTime(); const D=(y,m,d)=>Date.UTC(y,m-1,d);
  if(isNaN(t)||t<D(2026,6,28)) return "group";
  if(t<D(2026,7,4)) return "r32"; if(t<D(2026,7,8)) return "r16";
  if(t<D(2026,7,12)) return "qf"; if(t<D(2026,7,16)) return "sf"; return "final"; }
const pick=(...v)=>v.find(x=>x!==undefined&&x!==null);

async function api(key, endpoint, params={}){
  const url=new URL(BASE+endpoint);
  Object.entries(params).forEach(([k,v])=> v!=null && url.searchParams.set(k,v));
  const r=await fetch(url,{headers:{"x-api-key":key,"accept":"application/json"}});
  if(!r.ok){ const e=new Error(`${r.status} on ${endpoint}`); e.status=r.status; throw e; }
  const j=await r.json(); return j.response ?? j;
}

// World Cup 2026 runs 2026-06-11 → 2026-07-19. The free ("Hobby") KickoffAPI plan
// gates live=all and, in practice, the bulk league+season fixtures query (403 =
// "Endpoint not on your plan"). So try the cheap query first, then fall back to
// date-scoped queries that the free tier does allow.
const WC_FROM="2026-06-11", WC_TO="2026-07-19";
function eachDate(fromISO, toISO){
  const out=[]; const d=new Date(fromISO+"T00:00:00Z"); const end=new Date(toISO+"T00:00:00Z");
  for(; d<=end; d.setUTCDate(d.getUTCDate()+1)) out.push(d.toISOString().slice(0,10));
  return out;
}
async function fetchFixtures(key, leagueId, season){
  // 1) whole-season pull (works on paid plans; may 403 on free)
  try{ const f=await api(key,"/fixtures",{league:leagueId,season}); if(Array.isArray(f)&&f.length) return f; }
  catch(e){ if(e.status&&e.status!==403) throw e; }
  // 2) single date-range pull over the tournament window
  try{ const f=await api(key,"/fixtures",{league:leagueId,season,from:WC_FROM,to:WC_TO});
    if(Array.isArray(f)&&f.length) return f; }
  catch(e){ if(e.status&&e.status!==403) throw e; }
  // 3) last resort: one request per date (free-tier safe; bounded by the 39-day window)
  const days=eachDate(WC_FROM,WC_TO);
  const perDay=await Promise.all(days.map(date=>
    api(key,"/fixtures",{league:leagueId,season,date}).catch(()=>[])
  ));
  return perDay.flat().filter(Boolean);
}
async function resolveLeagueId(key){
  if(process.env.KICKOFF_LEAGUE_ID) return process.env.KICKOFF_LEAGUE_ID;
  const leagues=await api(key,"/leagues",{search:"World Cup",type:"Cup"});
  const named=(leagues||[]).map(l=>({id:l.id||l.league?.id,name:(l.name||l.league?.name||"").trim()}));
  const finals=n=>/world cup/i.test(n)&&!/qualif|women|u-?\d\d?|futsal|beach|club/i.test(n);
  const c=named.filter(l=>l.id&&finals(l.name));
  const pickL=c.find(l=>/^world cup$/i.test(l.name))||c.sort((a,b)=>a.name.length-b.name.length)[0];
  if(!pickL) throw new Error("Could not resolve World Cup league id; set KICKOFF_LEAGUE_ID.");
  return pickL.id;
}
function transform(fixtures, standings, season){
  const owned=c=>OWNERS[c]||null;
  const matches=(fixtures||[]).map(f=>{
    const home=normalizeName(pick(f?.teams?.home?.name,f?.homeTeam?.name,f?.home?.name));
    const away=normalizeName(pick(f?.teams?.away?.name,f?.awayTeam?.name,f?.away?.name));
    const date=pick(f?.fixture?.date,f?.date);
    let status=mapStatus(pick(f?.fixture?.status?.short,f?.statusShort,f?.status?.short));
    const hg=pick(f?.goals?.home,f?.goalsHome,f?.homeTeam?.goals,f?.scoreFullHome,null);
    const ag=pick(f?.goals?.away,f?.goalsAway,f?.awayTeam?.goals,f?.scoreFullAway,null);
    const penH=pick(f?.score?.penalty?.home,f?.scorePenaltyHome,null);
    const penA=pick(f?.score?.penalty?.away,f?.scorePenaltyAway,null);
    if(penH!=null&&penA!=null&&(status==="ft"||status==="aet")) status="pens";
    const m={ id:"k"+(pick(f?.fixture?.id,f?.id)??Math.random().toString(36).slice(2)),
      stage:stageByDate(date), date, status, minute:pick(f?.fixture?.status?.elapsed,f?.elapsed,null),
      home, away, ownerHome:owned(home), ownerAway:owned(away),
      hg:(hg==null?null:Number(hg)), ag:(ag==null?null:Number(ag)) };
    if(penH!=null&&penA!=null) m.pens={home:Number(penH),away:Number(penA)};
    return m;
  }).filter(m=>m.home&&m.away);
  // group tables (best-effort across response shapes)
  let groups=[];
  if(Array.isArray(standings)&&standings[0]?.league?.standings){
    groups=standings[0].league.standings.map((rows,i)=>({ name: rows[0]?.group?.replace(/^Group\s*/i,"")||String.fromCharCode(65+i),
      teams: rows.map(r=>{ const all=r.all||{},g=all.goals||{}; const country=normalizeName(r.team?.name||r.name);
        return {country, owner:owned(country), rank:r.rank??null, played:all.played??0, win:all.win??0, draw:all.draw??0, lose:all.lose??0,
          gf:(g.for??0), ga:(g.against??0), gd:r.goalsDiff??((g.for??0)-(g.against??0)), points:r.points??0}; }) }));
  }
  return { updatedAt:new Date().toISOString(), source:"KickoffAPI", season, groups, matches };
}

// Probe KickoffAPI directly and report status/count/shape — no swallowing — so we
// can see WHY fixtures come back empty. Reachable at /api/data?debug=1
async function probe(key, endpoint, params){
  try{ const r=await api(key,endpoint,params);
    const arr=Array.isArray(r)?r:(r?[r]:[]);
    return { ok:true, count:arr.length, sampleKeys:arr[0]?Object.keys(arr[0]):[], sample:arr[0]??null };
  }catch(e){ return { ok:false, status:e.status||null, error:String(e.message||e) }; }
}
async function debugReport(key, season){
  const out={ season, env:{ leagueIdSet:!!process.env.KICKOFF_LEAGUE_ID, seasonSet:!!process.env.KICKOFF_SEASON } };
  out.leaguesSearch=await probe(key,"/leagues",{search:"World Cup",type:"Cup"});
  let leagueId=null;
  try{ leagueId=await resolveLeagueId(key); out.resolvedLeagueId=leagueId; }
  catch(e){ out.resolvedLeagueId=null; out.resolveError=String(e.message||e); }
  if(leagueId){
    out.byLeagueSeason  =await probe(key,"/fixtures",{league:leagueId,season});
    out.byDateRange     =await probe(key,"/fixtures",{league:leagueId,season,from:WC_FROM,to:WC_TO});
    out.bySingleDate    =await probe(key,"/fixtures",{league:leagueId,season,date:"2026-07-01"});
    out.byLeagueNoSeason=await probe(key,"/fixtures",{league:leagueId});
    out.standings       =await probe(key,"/standings",{league:leagueId,season});
  }
  return out;
}

export default async function handler(req, res){
  try{
    const key=process.env.KICKOFF_API_KEY;
    if(!key){ res.status(500).json({error:"KICKOFF_API_KEY not set"}); return; }
    const season=Number(process.env.KICKOFF_SEASON||2026);
    if(req.query?.debug){ res.status(200).json(await debugReport(key,season)); return; }
    const leagueId=await resolveLeagueId(key);
    const [fixtures, standings]=await Promise.all([
      fetchFixtures(key,leagueId,season),
      api(key,"/standings",{league:leagueId,season}).catch(()=>[])
    ]);
    const data=transform(fixtures, standings, season);
    // cache at the edge so we don't hammer KickoffAPI when many people open the page
    res.setHeader("Cache-Control","s-maxage=60, stale-while-revalidate=120");
    res.status(200).json(data);
  }catch(e){ res.status(502).json({error:String(e.message||e)}); }
}
