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
  const dates = { group: {}, ko: {} };
  const venues = { group: {}, ko: {} };
  const koFixtures = {}; // FIFA-confirmed knockout matchups (both teams set), any status
  let finished = 0, live = 0, groupFinished = 0, koFinished = 0;
  for (const fx of snapshot) {
    // capture the scheduled date + venue for every fixture, regardless of status
    if (fx.stage === 'group') {
      if (fx.home && fx.away) {
        const pk = pairKey(fx.home, fx.away);
        if (fx.date) dates.group[pk] = fx.date;
        if (fx.venue) venues.group[pk] = fx.venue;
      }
    } else if (fx.matchNo) {
      if (fx.date) dates.ko[fx.matchNo] = fx.date;
      if (fx.venue) venues.ko[fx.matchNo] = fx.venue;
    }
    // a knockout fixture with both teams resolved is a confirmed matchup
    if (fx.stage !== 'group' && fx.matchNo && fx.home && fx.away) {
      koFixtures[fx.matchNo] = {
        home: fx.home, away: fx.away, status: fx.status, winner: fx.winner || null,
        hg: fx.hg, ag: fx.ag, et: !!fx.et, pens: fx.pens || null,
      };
    }
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
  return { known, dates, venues, koFixtures, finished, live, groupFinished, koFinished };
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

  const venue = (m.Stadium && ((m.Stadium.CityName && m.Stadium.CityName[0] && m.Stadium.CityName[0].Description) ||
    (m.Stadium.Name && m.Stadium.Name[0] && m.Stadium.Name[0].Description))) || '';
  const item = { stage, home, away, status, minute: parseMinute(m.MatchTime), hg, ag, events: [], date: String(m.Date || m.LocalDate || '').slice(0, 10), venue };
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

  const item = { stage, home, away, status, minute: parseMinute(te), hg, ag, events: [], date: String(g.local_date || g.date || g.datetime || g.match_date || '').slice(0, 10), venue: String(g.stadium || g.city || g.venue || g.location || '') };
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

// ---------- betting-odds feed (the-odds-api via odds.php proxy) ----------
// Pulls live 1X2 (home/draw/away) match odds, takes the median across the
// listed bookmakers, and de-vigs to true implied probabilities. Returns a map
// keyed by pairKey(teamA,teamB) so the app can look a matchup up regardless of
// which side is "home". Any upstream/key failure surfaces as { ok:false }.
const ODDS_PROXY_URL = 'odds.php';

function devigThree(oh, od, oa) {
  // decimal odds -> implied prob (1/odds), then normalize out the overround
  const ih = 1 / oh, id = od ? 1 / od : 0, ia = 1 / oa;
  const s = ih + id + ia;
  if (!(s > 0)) return null;
  return { h: ih / s, d: id / s, a: ia / s };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = arr.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function makeOddsFeed(data, proxyUrl) {
  const url = proxyUrl || ODDS_PROXY_URL;
  return {
    kind: 'odds',
    url,
    async snapshot() {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) return { ok: false, reason: 'proxy ' + res.status };
      const payload = await res.json();
      if (payload && payload.error) return { ok: false, reason: String(payload.error) };
      const events = Array.isArray(payload) ? payload : (payload.data || []);
      if (!Array.isArray(events)) return { ok: false, reason: 'unexpected payload' };
      const market = {};
      let matched = 0;
      for (const ev of events) {
        const homeId = nameToId(ev.home_team);
        const awayId = nameToId(ev.away_team);
        if (!homeId || !awayId) continue;
        const oh = [], od = [], oa = [];
        for (const bk of ev.bookmakers || []) {
          const mk = (bk.markets || []).find(m => m.key === 'h2h');
          if (!mk) continue;
          for (const o of mk.outcomes || []) {
            if (o.name === ev.home_team) oh.push(o.price);
            else if (o.name === ev.away_team) oa.push(o.price);
            else od.push(o.price); // "Draw"
          }
        }
        if (!oh.length || !oa.length) continue;
        const p = devigThree(median(oh), median(od), median(oa));
        if (!p) continue;
        // store oriented to (homeId, awayId): pa=home win, pd=draw, pb=away win
        market[pairKey(homeId, awayId)] = { a: homeId, b: awayId, pa: p.h, pd: p.d, pb: p.a };
        matched++;
      }
      return { ok: matched > 0, market, matched, events: events.length };
    },
  };
}
