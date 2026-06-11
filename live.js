/* ============================================================
   WC26 BRACKET LAB — live data layer
   Two feeds expose the SAME normalized snapshot shape:
     - DemoFeed   : a self-contained real-time wire (no network)
     - RealFeed   : football-data.org via a same-origin Funio proxy
   A snapshot is an array of fixtures:
     { id, stage:'group'|'ko', groupKey?, matchNo?, home, away,
       status:'SCHEDULED'|'LIVE'|'FINISHED', minute, hg, ag,
       events:[{minute,type:'goal'|'red',team}],
       et?, pens?, cards?, winner? }
   home/away/team are FIFA ids (keys of TEAMS).
   buildKnown(snapshot) folds a snapshot into the engine's `known`
   structure so the simulation can continue from real data.
   ============================================================ */

'use strict';

// ---- fold a snapshot into the engine's conditioning structure ----
function buildKnown(snapshot) {
  const known = { groups: {}, groupsLive: {}, ko: {}, koLive: {} };
  let finished = 0, live = 0, groupFinished = 0, koFinished = 0;
  for (const fx of snapshot) {
    if (fx.status === 'SCHEDULED') continue;
    if (fx.stage === 'group') {
      const key = pairKey(fx.home, fx.away);
      if (fx.status === 'FINISHED') {
        known.groups[key] = { home: fx.home, away: fx.away, hg: fx.hg, ag: fx.ag };
        finished++; groupFinished++;
      } else {
        known.groupsLive[key] = { home: fx.home, away: fx.away, hg: fx.hg, ag: fx.ag, minute: fx.minute };
        live++;
      }
    } else {
      if (fx.status === 'FINISHED') {
        known.ko[fx.matchNo] = {
          home: fx.home, away: fx.away, hg: fx.hg, ag: fx.ag,
          et: !!fx.et, pens: fx.pens || null, cards: fx.cards || [], winner: fx.winner,
        };
        finished++; koFinished++;
      } else {
        known.koLive[fx.matchNo] = { home: fx.home, away: fx.away, hg: fx.hg, ag: fx.ag, minute: fx.minute };
        live++;
      }
    }
  }
  return { known, finished, live, groupFinished, koFinished };
}

// ============================================================
//  DEMO FEED — pre-rolls one "true" tournament and reveals it
//  over a compressed clock so the wire behaves like the real
//  event: matches go SCHEDULED -> LIVE (ticking minute, goals
//  appearing) -> FINISHED, several at a time.
// ============================================================
const WAVE_TICKS = 4; // ticks a wave stays LIVE before going final

function makeDemoFeed(data) {
  const truth = simulateTournament(data);

  // assign each goal a plausible minute, sorted, tagged by scoring side
  const goalMinutes = (hg, ag) => {
    const arr = [];
    for (let i = 0; i < hg; i++) arr.push({ team: 'H', minute: 1 + Math.floor(rng() * 90) });
    for (let i = 0; i < ag; i++) arr.push({ team: 'A', minute: 1 + Math.floor(rng() * 90) });
    return arr.sort((x, y) => x.minute - y.minute);
  };

  // group fixtures, grouped into waves of 6 (a "matchday" feel)
  const groupFx = [];
  for (const g of Object.keys(data.GROUPS)) {
    for (const m of truth.groupResults[g].matches) {
      groupFx.push({
        id: `g:${g}:${m.home}:${m.away}`, stage: 'group', groupKey: g,
        home: m.home, away: m.away, hg: m.hg, ag: m.ag,
        goals: goalMinutes(m.hg, m.ag), cards: [],
      });
    }
  }
  // knockout fixtures by round (revealed after groups)
  const koFx = [];
  for (const round of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    for (const m of truth.rounds[round]) {
      koFx.push({
        id: `k:${m.match}`, stage: 'ko', matchNo: m.match,
        home: m.home, away: m.away, hg: m.hg, ag: m.ag,
        et: m.et, pens: m.pens, winner: m.winner,
        cards: m.cards || [], goals: goalMinutes(m.hg, m.ag),
      });
    }
  }

  // build waves: groups 6-at-a-time, then one wave per KO round
  const waves = [];
  for (let i = 0; i < groupFx.length; i += 6) waves.push(groupFx.slice(i, i + 6));
  const roundOf = no => {
    const n = Number(no);
    if (n <= 88) return 'r32'; if (n <= 96) return 'r16'; if (n <= 100) return 'qf';
    if (n <= 102) return 'sf'; if (n === 103) return 'third'; return 'final';
  };
  for (const r of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    waves.push(koFx.filter(f => roundOf(f.matchNo) === r));
  }

  const waveOf = {};
  waves.forEach((w, wi) => w.forEach(f => { waveOf[f.id] = wi; }));
  const maxTick = waves.length * WAVE_TICKS;

  const fixtureState = (f, tick) => {
    const w = waveOf[f.id];
    const start = w * WAVE_TICKS;
    let status, minute, hg, ag, events, et, pens, winner, cards;
    if (tick < start) {
      status = 'SCHEDULED'; minute = 0; hg = 0; ag = 0; events = [];
    } else if (tick < start + WAVE_TICKS) {
      status = 'LIVE';
      minute = Math.min(90, Math.round(((tick - start + 1) / WAVE_TICKS) * 90));
      events = [];
      const redByMin = (f.cards || []).filter(c => c.minute <= minute)
        .map(c => ({ minute: c.minute, type: 'red', team: c.team }));
      hg = 0; ag = 0;
      for (const gl of f.goals) {
        if (gl.minute > minute) break;
        if (gl.team === 'H') hg++; else ag++;
        events.push({ minute: gl.minute, type: 'goal', team: gl.team === 'H' ? f.home : f.away });
      }
      events = events.concat(redByMin).sort((a, b) => a.minute - b.minute);
    } else {
      status = 'FINISHED'; minute = 90; hg = f.hg; ag = f.ag;
      events = f.goals.map(gl => ({ minute: gl.minute, type: 'goal', team: gl.team === 'H' ? f.home : f.away }))
        .concat((f.cards || []).map(c => ({ minute: c.minute, type: 'red', team: c.team })))
        .sort((a, b) => a.minute - b.minute);
      et = f.et; pens = f.pens; winner = f.winner; cards = f.cards;
    }
    return {
      id: f.id, stage: f.stage, groupKey: f.groupKey, matchNo: f.matchNo,
      home: f.home, away: f.away, status, minute, hg, ag, events,
      et, pens, winner, cards,
    };
  };

  return {
    kind: 'demo',
    maxTick,
    stateAt(tick) { return waves.flat().map(f => fixtureState(f, tick)); },
  };
}

// ============================================================
//  REAL FEED — via a same-origin proxy (live.php) that returns
//    {"source":"fifa"|"wc26ir","data": <raw upstream JSON>}
//  Primary upstream is the official FIFA API (true live
//  status/minute/score, no key); worldcup26.ir is the fallback.
//  Both number matches 1–104 per FIFA's schedule, so a knockout
//  match maps to our bracket by its number directly.
// ============================================================
const REAL_PROXY_URL = 'live.php';

// FIFA IdStage -> our round key (2026 World Cup stage ids)
const FIFA_STAGE = {
  289273: 'group', 289287: 'r32', 289288: 'r16',
  289289: 'qf', 289290: 'sf', 289291: 'third', 289292: 'final',
};

// our match-number -> round (for the worldcup26.ir id-banded fallback)
function roundByMatchNo(no) {
  const n = Number(no);
  if (n <= 72) return 'group'; if (n <= 88) return 'r32'; if (n <= 96) return 'r16';
  if (n <= 100) return 'qf'; if (n <= 102) return 'sf'; if (n === 103) return 'third';
  return 'final';
}

// English team name -> our FIFA id (for the worldcup26.ir fallback)
const NAME_TO_ID = (() => {
  const m = {};
  for (const id of Object.keys(TEAMS)) m[TEAMS[id].name.toLowerCase()] = id;
  const alias = {
    'korea republic': 'KOR', 'south korea': 'KOR', 'ir iran': 'IRN', 'iran': 'IRN',
    'usa': 'USA', 'united states': 'USA', 'turkey': 'TUR', 'türkiye': 'TUR', 'turkiye': 'TUR',
    "côte d'ivoire": 'CIV', 'ivory coast': 'CIV', 'cote d ivoire': 'CIV',
    'czech republic': 'CZE', 'czechia': 'CZE', 'dr congo': 'COD', 'congo dr': 'COD',
    'democratic republic of the congo': 'COD',
    'cape verde': 'CPV', 'cabo verde': 'CPV', 'curacao': 'CUW', 'curaçao': 'CUW',
    'bosnia and herzegovina': 'BIH', 'bosnia & herz.': 'BIH', 'bosnia-herzegovina': 'BIH',
    'south africa': 'RSA', 'saudi arabia': 'KSA', 'new zealand': 'NZL',
  };
  return Object.assign(m, alias);
})();

function nameToId(name) {
  if (!name) return null;
  return NAME_TO_ID[String(name).toLowerCase().trim()] || null;
}

// FIFA delivers a 3-letter IdCountry that usually equals our id.
function fifaCodeToId(code) {
  if (!code) return null;
  if (TEAMS[code]) return code;
  return nameToId(code);
}

function parseMinute(s) {
  if (s == null) return 0;
  const n = parseInt(String(s).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

// ---- official FIFA calendar match -> normalized fixture ----
function parseFifaMatch(m) {
  const home = fifaCodeToId(m.Home && m.Home.IdCountry);
  const away = fifaCodeToId(m.Away && m.Away.IdCountry);
  if (!home || !away) return null; // unresolved knockout placeholder
  const stage = FIFA_STAGE[m.IdStage] || roundByMatchNo(m.MatchNumber);
  const status = m.MatchStatus === 0 ? 'FINISHED' : m.MatchStatus === 3 ? 'LIVE' : 'SCHEDULED';
  const hg = m.Home && m.Home.Score != null ? m.Home.Score : 0;
  const ag = m.Away && m.Away.Score != null ? m.Away.Score : 0;
  const hadPens = m.ResultType === 2 || ((m.HomeTeamPenaltyScore || 0) + (m.AwayTeamPenaltyScore || 0) > 0);
  const pens = hadPens ? { h: m.HomeTeamPenaltyScore || 0, a: m.AwayTeamPenaltyScore || 0 } : null;
  let winner = null;
  if (m.Winner) winner = m.Winner === (m.Home && m.Home.IdTeam) ? home : (m.Winner === (m.Away && m.Away.IdTeam) ? away : null);
  else if (status === 'FINISHED') winner = hg > ag ? home : (ag > hg ? away : (pens ? (pens.h > pens.a ? home : away) : null));

  const item = { stage, home, away, status, minute: parseMinute(m.MatchTime), hg, ag, events: [] };
  if (stage === 'group') {
    item.groupKey = groupOfId(home);
    item.id = 'g:' + item.groupKey + ':' + home + ':' + away;
  } else {
    item.matchNo = String(m.MatchNumber);
    item.id = 'k:' + item.matchNo;
    if (status === 'FINISHED') { item.winner = winner; item.et = !!pens; item.pens = pens; item.cards = []; }
  }
  return item;
}

// ---- worldcup26.ir game -> normalized fixture (fallback) ----
function parseWc26Game(g) {
  const home = nameToId(g.home_team_name_en);
  const away = nameToId(g.away_team_name_en);
  if (!home || !away) return null;
  const no = parseInt(g.id, 10);
  const stage = roundByMatchNo(no);
  const finished = String(g.finished).toUpperCase() === 'TRUE';
  const te = String(g.time_elapsed == null ? '' : g.time_elapsed).toLowerCase();
  const live = !finished && te !== '' && te !== 'notstarted' && te !== 'null';
  const status = finished ? 'FINISHED' : live ? 'LIVE' : 'SCHEDULED';
  const hg = parseInt(g.home_score, 10) || 0;
  const ag = parseInt(g.away_score, 10) || 0;

  const item = { stage, home, away, status, minute: parseMinute(te), hg, ag, events: [] };
  if (stage === 'group') {
    item.groupKey = groupOfId(home);
    item.id = 'g:' + item.groupKey + ':' + home + ':' + away;
  } else {
    item.matchNo = String(no);
    item.id = 'k:' + no;
    if (finished) { item.winner = hg > ag ? home : (ag > hg ? away : null); item.et = false; item.pens = null; item.cards = []; }
  }
  return item;
}

function makeRealFeed(data, proxyUrl) {
  const feed = {
    kind: 'real',
    url: proxyUrl || REAL_PROXY_URL,
    lastSource: null,
    async snapshot() {
      const res = await fetch(feed.url, { headers: { accept: 'application/json' } });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(('proxy ' + res.status + ': ' + t).slice(0, 200));
      }
      const payload = await res.json();
      const source = payload && payload.source;
      const data_ = (payload && payload.data) || payload;
      feed.lastSource = source;
      let items;
      if (source === 'wc26ir') {
        items = (data_.games || []).map(parseWc26Game);
      } else {
        items = (data_.Results || []).map(parseFifaMatch);
      }
      return items.filter(Boolean);
    },
  };
  return feed;
}

// groupOfId needs TEAMS/GROUPS; defined in app scope too, mirror here.
function groupOfId(id) {
  return Object.keys(GROUPS).find(g => GROUPS[g].includes(id));
}
