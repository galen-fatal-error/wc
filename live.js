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
//  REAL FEED — football-data.org via a same-origin proxy.
//  The proxy (live.php on the Funio docroot) injects the API
//  token server-side and adds CORS, so this is a plain
//  same-origin fetch. Set PROXY_URL to '' to disable.
// ============================================================
const REAL_PROXY_URL = 'live.php';

// football-data.org team names -> our FIFA ids. Extend as needed.
const NAME_TO_ID = (() => {
  const m = {};
  for (const id of Object.keys(TEAMS)) m[TEAMS[id].name.toLowerCase()] = id;
  const alias = {
    'korea republic': 'KOR', 'south korea': 'KOR', 'ir iran': 'IRN', 'iran': 'IRN',
    'usa': 'USA', 'united states': 'USA', 'turkey': 'TUR', 'türkiye': 'TUR', 'turkiye': 'TUR',
    "côte d'ivoire": 'CIV', 'ivory coast': 'CIV', 'cote d ivoire': 'CIV',
    'czech republic': 'CZE', 'czechia': 'CZE', 'dr congo': 'COD', 'congo dr': 'COD',
    'cape verde': 'CPV', 'cabo verde': 'CPV', 'curacao': 'CUW', 'curaçao': 'CUW',
    'bosnia and herzegovina': 'BIH', 'bosnia & herz.': 'BIH', 'bosnia-herzegovina': 'BIH',
    'south africa': 'RSA', 'saudi arabia': 'KSA', 'new zealand': 'NZL',
  };
  return Object.assign(m, alias);
})();

function nameToId(name) {
  if (!name) return null;
  return NAME_TO_ID[name.toLowerCase().trim()] || null;
}

// map football-data status -> our status
function mapStatus(s) {
  if (s === 'FINISHED' || s === 'AWARDED') return 'FINISHED';
  if (s === 'IN_PLAY' || s === 'PAUSED' || s === 'EXTRA_TIME' || s === 'PENALTY_SHOOTOUT') return 'LIVE';
  return 'SCHEDULED';
}

const KO_STAGE_ROUND = {
  LAST_32: 'r32', ROUND_OF_32: 'r32', LAST_16: 'r16', ROUND_OF_16: 'r16',
  QUARTER_FINALS: 'qf', QUARTER_FINAL: 'qf', SEMI_FINALS: 'sf', SEMI_FINAL: 'sf',
  THIRD_PLACE: 'third', FINAL: 'final',
};

function makeRealFeed(data, proxyUrl) {
  const url = proxyUrl || REAL_PROXY_URL;

  // Map a real KO fixture (two team ids, round) to one of our match
  // numbers by matching the pair against a projection's resolved slots.
  function koMatchNo(round, a, b, known) {
    const proj = simulateTournament(data, known);
    const ids = ROUND_IDS_FOR(round);
    for (const no of ids) {
      const m = proj.rounds[round].find(x => x.match === no);
      if (!m) continue;
      const set = new Set([m.home, m.away]);
      if (set.has(a) && set.has(b)) return no;
    }
    return null;
  }
  function ROUND_IDS_FOR(round) {
    return data.BRACKET[round].map(s => s.match);
  }

  return {
    kind: 'real',
    url,
    async snapshot() {
      const res = await fetch(url, { headers: { 'accept': 'application/json' } });
      if (!res.ok) throw new Error(`proxy ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 200));
      const data_ = await res.json();
      const matches = data_.matches || data_;
      // first pass: groups (so KO mapping can use locked group results)
      const out = [];
      const groupItems = [];
      for (const mt of matches) {
        const home = nameToId(mt.homeTeam && mt.homeTeam.name);
        const away = nameToId(mt.awayTeam && mt.awayTeam.name);
        if (!home || !away) continue;
        const status = mapStatus(mt.status);
        const ft = mt.score && mt.score.fullTime || {};
        const hg = ft.home != null ? ft.home : 0;
        const ag = ft.away != null ? ft.away : 0;
        const minute = mt.minute || (mt.injuryTime ? 90 + mt.injuryTime : 0);
        const isGroup = (mt.stage === 'GROUP_STAGE') || /^GROUP/.test(mt.group || '');
        const item = {
          stage: isGroup ? 'group' : 'ko', home, away, status,
          minute: Number(minute) || 0, hg, ag,
          events: (mt.goals || []).map(g => ({ minute: g.minute, type: 'goal', team: nameToId(g.team && g.team.name) })),
          _round: KO_STAGE_ROUND[mt.stage] || null,
          _winner: mt.score && mt.score.winner, // 'HOME_TEAM'|'AWAY_TEAM'|'DRAW'
        };
        if (isGroup) { item.groupKey = groupOfId(home); groupItems.push(item); }
        out.push(item);
      }
      // build known from finished groups to anchor KO mapping
      const groupKnown = buildKnown(out.filter(o => o.stage === 'group')).known;
      for (const item of out) {
        if (item.stage === 'group') {
          item.id = `g:${item.groupKey}:${item.home}:${item.away}`;
        } else {
          const no = item._round
            ? koMatchNo(item._round, item.home, item.away, groupKnown)
            : null;
          item.matchNo = no;
          item.id = `k:${no || item.home + item.away}`;
          if (item.status === 'FINISHED') {
            item.winner = item._winner === 'AWAY_TEAM' ? item.away : item.home;
            item.et = false; item.pens = null; item.cards = [];
          }
        }
      }
      return out.filter(o => o.stage === 'group' || o.matchNo);
    },
  };
}

// groupOfId needs TEAMS/GROUPS; defined in app scope too, mirror here.
function groupOfId(id) {
  return Object.keys(GROUPS).find(g => GROUPS[g].includes(id));
}
