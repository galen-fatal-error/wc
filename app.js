/* ============================================================
   WC26 BRACKET LAB — UI layer
   Renders groups, placement flow, wallchart bracket, Monte
   Carlo odds, the paced "matchday mode", and the cursor
   tooltip layer (ranking data, pairing rules, match odds).
   ============================================================ */

'use strict';

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ROUND_LABELS = {
  groups: 'GROUP STAGE', r32: 'ROUND OF 32', r16: 'ROUND OF 16',
  qf: 'QUARTER-FINALS', sf: 'SEMI-FINALS', third: 'BRONZE FINAL', final: 'THE FINAL',
};

const state = {
  sim: null,            // last full tournament simulation
  mc: null,             // monte carlo results
  sort: 'champion',
  sortDir: -1,
  token: 0,             // cancellation token for matchday animations
  matchday: null,       // { sim, revealed:Set, groupsDone, phase, busy }
  groupsView: null,     // { sim, resolved:Set|null, live? }
  flowView: null,       // { sim, meta: matchId -> {home,away} }
  bracketView: null,    // { sim, revealed, groupsDone, interactive }
  known: null,          // real/in-play results folded for the engine
  mcContext: '',        // label override for the odds table
  live: null,           // { feed, kind, tick, playing, timer, lastSig }
  focus: null,          // last team-focus result
  koMode: 'matchday',   // knockout view: 'matchday' (scores) | 'predict' (likelihoods)
  mdView: null,         // last matchday bracket render args, to restore on toggle
  predict: null,        // slot-occupancy monte carlo: { slots, n }
  predictBusy: false,
  qualOdds: null,       // monte carlo qualification odds: { tally, n }
  confirmed: null,      // Set of teamIds with a clinched knockout place (real)
  confirmedWinner: null,// Set of teamIds that have clinched top spot (real)
  confirmedPos: null,   // Set of teamIds whose EXACT finishing position is locked
  lockWinnerGroup: null,// { group -> teamId } locked into the 1x R32 slot
  lockRunnerGroup: null,// { group -> teamId } locked into the 2x R32 slot
  matchDates: { group: {}, ko: Object.assign({}, MATCH_DATES_KO) }, // fixture dates
  matchVenues: { group: {}, ko: Object.assign({}, MATCH_VENUES_KO) }, // fixture venues
  koFixtures: {},       // FIFA-confirmed knockout matchups from the live feed
  thirdsView: 'projected', // best-thirds list: 'projected' (%) | 'current' (standings)
};

const team = id => TEAMS[id];
const groupOf = id => Object.keys(GROUPS).find(g => GROUPS[g].includes(id));

const THIRD_ALLOWED = {};
BRACKET.thirdSlots.forEach(s => { THIRD_ALLOWED[s.match] = s.allowed; });

const SPEC_BY_ID = {};
const ROUND_OF = {};
const ALL_MATCH_IDS = [];
const ROUND_IDS = { r32: [], r16: [], qf: [], sf: [], third: [], final: [] };
for (const r of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
  BRACKET[r].forEach(s => {
    SPEC_BY_ID[s.match] = s;
    ROUND_OF[s.match] = r;
    ALL_MATCH_IDS.push(s.match);
    ROUND_IDS[r].push(s.match);
  });
}

const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

// winner-advances-to map (and loser path to the bronze final)
const NEXT_MATCH = {};
for (const r of ['r16', 'qf', 'sf', 'third', 'final']) {
  BRACKET[r].forEach(s => {
    for (const ref of [s.home, s.away]) {
      const [kind, key] = ref.split(':');
      if (kind === 'M') NEXT_MATCH[key] = { match: s.match, as: 'winner' };
    }
  });
}

function originLabel(ref) {
  const [kind, key] = ref.split(':');
  if (kind === 'W') return '1' + key;
  if (kind === 'RU') return '2' + key;
  if (kind === 'T') return '3rd ' + THIRD_ALLOWED[key].join('/');
  if (kind === 'M') return 'W' + key;
  if (kind === 'L') return 'L' + key;
  return ref;
}

// Compact seed code as the wallchart image draws it: 1E = winner of E,
// 2A = runner-up of A, 3D = the third-placed side (from group D) that was
// allocated here, Wxx = winner of an earlier match. When a third slot has
// a known occupant we can show its real group; otherwise a neutral mark.
function shortSeed(ref, teamId) {
  const [kind, key] = ref.split(':');
  if (kind === 'W') return '1' + key;
  if (kind === 'RU') return '2' + key;
  if (kind === 'T') return teamId ? '3' + groupOf(teamId) : '3·';
  if (kind === 'M') return 'W' + key;
  if (kind === 'L') return 'L' + key;
  return ref;
}

// the fixed R32 destination for a group position (pos 0/1); thirds vary
function fixedDestination(g, pos) {
  const want = (pos === 0 ? 'W:' : 'RU:') + g;
  for (const s of BRACKET.r32) {
    if (s.home === want) return { match: s.match, side: 'home' };
    if (s.away === want) return { match: s.match, side: 'away' };
  }
  return null;
}

// ---------- tooltip layer ----------

const tipEl = document.createElement('div');
tipEl.className = 'tooltip';
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(tipEl));

function showTip(html, ev) {
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  if (isMobile()) {
    // pin as a bottom sheet rather than chase the finger
    tipEl.classList.add('mobile-sheet');
  } else {
    tipEl.classList.remove('mobile-sheet');
    moveTip(ev);
  }
}

function moveTip(ev) {
  if (tipEl.style.display !== 'block' || tipEl.classList.contains('mobile-sheet')) return;
  const pad = 16;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  let x = ev.clientX + pad, y = ev.clientY + pad;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - pad;
  tipEl.style.left = Math.max(8, x) + 'px';
  tipEl.style.top = Math.max(8, y) + 'px';
}

function hideTip() { tipEl.style.display = 'none'; }

// bind delegated hover tooltips: contentFn(el) -> html | null
function bindTip(container, selector, contentFn) {
  container.addEventListener('mouseover', ev => {
    const el = ev.target.closest(selector);
    if (!el || !container.contains(el)) return;
    const html = contentFn(el);
    if (html) showTip(html, ev); else hideTip();
  });
  container.addEventListener('mousemove', moveTip);
  container.addEventListener('mouseout', ev => {
    const el = ev.target.closest(selector);
    if (el && !(ev.relatedTarget && el.contains(ev.relatedTarget))) hideTip();
  });
}

const pct = p => Math.round(p * 100) + '%';

// ---------- match dates ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// format an ISO yyyy-mm-dd without timezone surprises
function fmtMatchDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  const wd = WEEKDAYS[new Date(Date.UTC(y, mo, d)).getUTCDay()];
  return `${wd} ${MONTHS[mo]} ${d}`;
}
const koDate = matchId => (state.matchDates && state.matchDates.ko[matchId]) || null;
const groupDate = (a, b) => (state.matchDates && state.matchDates.group[pairKey(a, b)]) || null;
const koVenue = matchId => (state.matchVenues && state.matchVenues.ko[matchId]) || null;
const groupVenue = (a, b) => (state.matchVenues && state.matchVenues.group[pairKey(a, b)]) || null;
// tooltip date (+ venue) line
function dateRow(iso, venue) {
  const f = fmtMatchDate(iso);
  const loc = venue ? ` <span class="tip-venue">· 📍 ${venue}</span>` : '';
  return `<span class="tip-row tip-date">📅 ${f || 'Date TBD'}${loc}</span>`;
}

// ---------- group stage ----------

// P(reach the knockout round) per team — Monte Carlo qualification odds,
// conditioned on whatever real results are loaded. Cached by the current
// `known` so progressive matchday renders don't recompute each frame.
const QUAL_RUNS = 800;
let qualSig = null;
function ensureQualOdds() {
  const sig = state.known ? JSON.stringify(state.known) : 'base';
  if (state.qualOdds && qualSig === sig) return state.qualOdds;
  qualSig = sig;
  state.qualOdds = monteCarlo(WC_DATA, QUAL_RUNS, null, state.known || undefined);
  return state.qualOdds;
}

// KO% table cell (shared by the simulated and live group tables)
function koCell(teamId, dim) {
  const q = state.qualOdds;
  if (!q) return '<td class="ko-cell prob-cell"><span class="prob-num">—</span></td>';
  const p = 100 * (q.tally[teamId].r32 || 0) / q.n;
  const txt = p >= 99.5 ? '100' : p < 0.5 ? '<1' : Math.round(p);
  return `<td class="ko-cell prob-cell"><span class="prob-bar" style="width:${Math.min(100, p)}%"></span>
    <span class="prob-num ${p >= 50 && !dim ? 'prob-hot' : ''}">${txt}</span></td>`;
}

// Six round-robin fixtures per group in matchday order (each team plays
// once per matchday). Rendered as a 3-row grid so each row is a matchday.
const GROUP_FIXTURES = {};
for (const g of Object.keys(GROUPS)) {
  const [a, b, c, d] = GROUPS[g];
  GROUP_FIXTURES[g] = [
    { md: 1, a, b }, { md: 1, a: c, b: d },
    { md: 2, a, b: c }, { md: 2, a: d, b },
    { md: 3, a, b: d }, { md: 3, a: b, b: c },
  ];
}

// ---------- clinch / confirmed-placement logic ----------
// From REAL finished group results only, decide which teams have already
// mathematically secured a knockout place (guaranteed top-2) — and which
// have secured top spot. Conservative on tiebreaks: when teams could tie on
// points, the tie is assumed AGAINST the team, so we only ever flag a place
// that is truly locked regardless of remaining scorelines.
function groupClinch(g) {
  const known = state.known;
  const ids = GROUPS[g];
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
  // each played game as a deterministic W/D/L outcome ('a'|'b'|'d')
  const fixed = [];
  const remaining = [];
  let played = 0;
  for (const [a, b] of pairs) {
    const kf = known && known.groups[pairKey(a, b)];
    if (kf) {
      const ag = kf.home === a ? kf.hg : kf.ag, bg = kf.home === a ? kf.ag : kf.hg;
      fixed.push({ a, b, res: ag > bg ? 'a' : bg > ag ? 'b' : 'd' });
      played++;
    } else remaining.push([a, b]);
  }
  const status = {};
  ids.forEach(id => { status[id] = { through: false, winner: false, runnerUp: false }; });
  if (!played) return status; // nothing real yet → nothing confirmed

  // Group finished: standings are final — settle everything (incl. GD) with
  // the real FIFA 2026 tiebreakers via rankGroup.
  if (remaining.length === 0) {
    const stats = {};
    ids.forEach(id => { stats[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; });
    const matches = [];
    for (const [a, b] of pairs) {
      const kf = known.groups[pairKey(a, b)];
      const ag = kf.home === a ? kf.hg : kf.ag, bg = kf.home === a ? kf.ag : kf.hg;
      applyResult(stats[a], ag, bg); applyResult(stats[b], bg, ag);
      matches.push({ home: a, away: b, hg: ag, ag: bg });
    }
    const table = rankGroup(Object.values(stats), matches);
    table.forEach((row, i) => {
      status[row.id] = { through: i < 2, winner: i === 0, runnerUp: i === 1, neverFirst: i > 0 };
    });
    return status;
  }

  // Games remain: enumerate every W/D/L completion. Ranking uses points, then
  // HEAD-TO-HEAD points among teams level on points (deterministic from the
  // W/D/L outcomes, and — per FIFA 2026 — applied before goal difference).
  // Only a residual tie on points AND head-to-head points is left to GD, whose
  // margins are still free, so that is counted against the team (worst case).
  ids.forEach(id => { status[id] = { through: true, winner: true, neverFirst: true }; });
  const k = remaining.length;
  const combos = Math.pow(3, k);
  for (let c = 0; c < combos; c++) {
    const results = fixed.slice();
    let n = c;
    for (let r = 0; r < k; r++) {
      const o = n % 3; n = (n / 3) | 0;
      const [a, b] = remaining[r];
      results.push({ a, b, res: o === 0 ? 'a' : o === 1 ? 'b' : 'd' });
    }
    const pts = {}; ids.forEach(id => { pts[id] = 0; });
    for (const gm of results) {
      if (gm.res === 'a') pts[gm.a] += 3; else if (gm.res === 'b') pts[gm.b] += 3; else { pts[gm.a]++; pts[gm.b]++; }
    }
    for (const id of ids) {
      const peers = ids.filter(o => pts[o] === pts[id]);
      const h2h = {}; peers.forEach(p => { h2h[p] = 0; });
      if (peers.length > 1) {
        const pset = new Set(peers);
        for (const gm of results) {
          if (pset.has(gm.a) && pset.has(gm.b)) {
            if (gm.res === 'a') h2h[gm.a] += 3; else if (gm.res === 'b') h2h[gm.b] += 3; else { h2h[gm.a]++; h2h[gm.b]++; }
          }
        }
      }
      let above = 0, residual = 0;
      for (const o of ids) {
        if (o === id) continue;
        if (pts[o] > pts[id]) above++;
        else if (pts[o] === pts[id]) {
          if (h2h[o] > h2h[id]) above++;            // ahead on head-to-head (locked)
          else if (h2h[o] === h2h[id]) residual++;  // GD/goals decide → margins free
        }
      }
      const worstRank = 1 + above + residual; // residual ties counted against
      const bestRank = 1 + above;             // residual ties won by this team
      if (worstRank > 2) status[id].through = false;
      if (worstRank > 1) status[id].winner = false;
      if (bestRank < 2) status[id].neverFirst = false; // could be 1st here
    }
  }
  // runner-up locked: guaranteed top-2 AND can never be 1st => always 2nd
  ids.forEach(id => { status[id].runnerUp = status[id].through && status[id].neverFirst; });
  return status;
}

// Confirmed-placement state, cached by the real data. Tracks both team-level
// advancement (for group rows) and EXACT slot locks (for the bracket): a
// round-of-32 slot is only locked once a team's group POSITION is settled —
// the group winner pins the 1x slot, a guaranteed runner-up pins the 2x slot.
let confirmSig = null;
function ensureConfirmed() {
  const sig = state.known ? JSON.stringify(state.known.groups) : 'none';
  if (state.confirmed && confirmSig === sig) return;
  confirmSig = sig;
  const through = new Set(), winner = new Set();
  const winnerByGroup = {}, runnerByGroup = {};
  if (state.known) {
    for (const g of Object.keys(GROUPS)) {
      const st = groupClinch(g);
      for (const id of GROUPS[g]) {
        if (!st[id]) continue;
        if (st[id].through) through.add(id);
        if (st[id].winner) { winner.add(id); winnerByGroup[g] = id; }
        if (st[id].runnerUp) runnerByGroup[g] = id;
      }
    }
  }
  state.confirmed = through;          // secured advancement (top-2), order may be open
  state.confirmedWinner = winner;     // secured top spot
  state.lockWinnerGroup = winnerByGroup;   // g -> team locked into 1x slot
  state.lockRunnerGroup = runnerByGroup;   // g -> team locked into 2x slot
  // gold everywhere = EXACT finishing position locked (1st or 2nd settled)
  state.confirmedPos = new Set([...Object.values(winnerByGroup), ...Object.values(runnerByGroup)]);
}

// The games to show for a group given the current sim / real data and an
// optional reveal set (matchday animation). Returns { pairKey -> result }.
function groupShownGames(g, sim, revealedGames) {
  const inG = id => GROUPS[g].includes(id);
  const map = {};
  if (sim) {
    for (const m of sim.groupResults[g].matches) {
      const pk = pairKey(m.home, m.away);
      if (m.real || m.live || !revealedGames || revealedGames.has(pk)) {
        map[pk] = { home: m.home, away: m.away, hg: m.hg, ag: m.ag, real: !!m.real, live: !!m.live };
      }
    }
  } else if (state.known) {
    for (const pk of Object.keys(state.known.groups)) {
      const kf = state.known.groups[pk];
      if (inG(kf.home) && inG(kf.away)) map[pk] = { ...kf, real: true };
    }
    for (const pk of Object.keys(state.known.groupsLive || {})) {
      const kl = state.known.groupsLive[pk];
      if (inG(kl.home) && inG(kl.away)) map[pk] = { home: kl.home, away: kl.away, hg: kl.hg, ag: kl.ag, real: true, live: true };
    }
  }
  return map;
}

// Standings computed from whatever games are currently shown.
function tableFromGames(g, shown) {
  const stats = {};
  GROUPS[g].forEach(id => { stats[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; });
  const matches = [];
  for (const pk of Object.keys(shown)) {
    const m = shown[pk];
    applyResult(stats[m.home], m.hg, m.ag);
    applyResult(stats[m.away], m.ag, m.hg);
    matches.push(m);
  }
  return rankGroup(Object.values(stats), matches);
}

// Compact chronological games grid for one group card.
function groupGamesHtml(g, shown) {
  let cells = '';
  for (const fx of GROUP_FIXTURES[g]) {
    const pk = pairKey(fx.a, fx.b);
    const s = shown[pk];
    const A = team(fx.a), B = team(fx.b);
    if (s) {
      const ha = s.home === fx.a ? s.hg : s.ag;
      const hb = s.home === fx.a ? s.ag : s.hg;
      const aw = ha > hb ? 'w' : '', bw = hb > ha ? 'w' : '';
      cells += `<div class="gg ${s.real ? 'gg-real' : ''} ${s.live ? 'gg-live' : ''}" data-ga="${fx.a}" data-gb="${fx.b}" data-played="1">
        <span class="gg-side ${aw}"><span class="flag">${A.flag}</span>${A.code}</span>
        <span class="gg-score">${ha}–${hb}${s.live ? '′' : ''}</span>
        <span class="gg-side r ${bw}">${B.code}<span class="flag">${B.flag}</span></span>
      </div>`;
    } else {
      cells += `<div class="gg gg-pending" data-ga="${fx.a}" data-gb="${fx.b}">
        <span class="gg-side"><span class="flag">${A.flag}</span>${A.code}</span>
        <span class="gg-score">v</span>
        <span class="gg-side r">${B.code}<span class="flag">${B.flag}</span></span>
      </div>`;
    }
  }
  return `<div class="group-games">${cells}</div>`;
}

function renderGroups(sim, revealedGames) {
  state.groupsView = { sim, revealedGames: revealedGames || null };
  ensureQualOdds();
  ensureConfirmed();
  const grid = $('#groupsGrid');
  grid.innerHTML = '';
  for (const g of Object.keys(GROUPS)) {
    const card = document.createElement('div');
    card.className = 'group-card';
    const shown = groupShownGames(g, sim, revealedGames);
    const playedCount = Object.keys(shown).length;
    const hasReal = Object.values(shown).some(s => s.real);
    const done = sim && playedCount === 6;
    if (done) card.classList.add('resolved');
    if (hasReal) card.classList.add('has-real');

    // use the sim's exact final ordering when complete; otherwise rank the
    // games shown so far (provisional standings during reveal / pre-sim)
    let table, thirdQualified = false;
    if (done) {
      table = sim.groupResults[g].table;
      thirdQualified = sim.qualifiedThirds.some(t => t.group === g);
    } else {
      table = tableFromGames(g, shown);
    }

    const confirmed = state.confirmed || new Set();    // secured a knockout spot
    const confWinner = state.confirmedWinner || new Set();
    let rowsHtml = '';
    table.forEach((row, i) => {
      const t = team(row.id);
      const cls = !playedCount ? ''
        : i === 0 ? 'row-q1' : i === 1 ? 'row-q2'
        : (i === 2 && done && thirdQualified) ? 'row-q3-in' : 'row-out';
      const isConf = confirmed.has(t.id); // gold = guaranteed a round-of-32 place
      const conf = isConf ? ' row-confirmed' : '';
      const title = confWinner.has(t.id) ? 'Top spot secured' : 'Round-of-32 place secured';
      const check = isConf ? `<span class="conf-check" title="${title}">✓</span>` : '';
      rowsHtml += `<tr class="${cls}${conf}" data-team="${t.id}">
        <td class="team-cell">${check}<span class="flag">${t.flag}</span>${t.name}</td>
        <td>${row.w}-${row.d}-${row.l}</td>
        <td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td>
        <td class="pts-cell">${row.pts}</td>
        ${koCell(t.id, cls === 'row-out')}
      </tr>`;
    });

    const status = done ? 'FINAL' : `${playedCount}/6 PLAYED`;
    card.innerHTML = `
      <div class="group-head">
        <span class="group-letter">${g}</span>
        <span class="mono-micro">${hasReal ? '<span class="real-dot"></span>' : ''}${status}</span>
      </div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>W-D-L</th><th>GD</th><th>Pts</th><th class="ko-th" title="Chance to reach the knockout round">KO%</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      ${groupGamesHtml(g, shown)}`;
    grid.appendChild(card);
  }
}

// Tooltip for a single group game: date + pre-match win/draw/win odds, and
// the result if it has been played (odds shown are always pre-match).
function groupGameTip(aId, bId) {
  const A = team(aId), B = team(bId), g = groupOf(aId);
  const [w, d, l] = h2hOdds(aId, bId); // win / draw / loss for A (host-adjusted)
  let html = `<span class="tip-head">${A.flag} ${A.name} v ${B.name} ${B.flag} · GROUP ${g}</span>`;
  html += dateRow(groupDate(aId, bId), groupVenue(aId, bId));
  html += `<div class="tip-odds-bar"><span class="home-share" style="width:${w * 100}%"></span><span class="draw-share" style="width:${d * 100}%"></span><span class="away-share" style="flex:1"></span></div>
    <span class="tip-row tip-mono">${A.code} <span class="tip-strong">${pct(w)}</span> · draw ${pct(d)} · <span class="tip-strong">${pct(l)}</span> ${B.code}
      <span style="color:#4d4d4d">— pre-match</span></span>`;
  const pk = pairKey(aId, bId);
  const kf = state.known && state.known.groups[pk];
  const kl = state.known && state.known.groupsLive && state.known.groupsLive[pk];
  if (kf) {
    const ag = kf.home === aId ? kf.hg : kf.ag, bg = kf.home === aId ? kf.ag : kf.hg;
    html += `<span class="tip-rule">Full time: <span class="tip-strong">${A.code} ${ag}–${bg} ${B.code}</span> — odds above are from kick-off.</span>`;
  } else if (kl) {
    const ag = kl.home === aId ? kl.hg : kl.ag, bg = kl.home === aId ? kl.ag : kl.hg;
    html += `<span class="tip-rule">Live ${kl.minute}′: <span class="tip-strong">${A.code} ${ag}–${bg} ${B.code}</span> — odds above are from kick-off.</span>`;
  } else {
    html += `<span class="tip-rule">Single-match odds from team ratings${(WC_HOSTS[aId] || WC_HOSTS[bId]) ? ', incl. host advantage' : ''}.</span>`;
  }
  return html;
}

function groupRowTip(teamId) {
  const t = team(teamId);
  const g = groupOf(teamId);
  const view = state.groupsView || {};
  const sim = view.sim;
  const shown = groupShownGames(g, sim, view.revealedGames);
  const playedCount = Object.keys(shown).length;
  const done = sim && playedCount === 6;
  const q = state.qualOdds;
  const koLine = q ? `<span class="tip-rule">Model gives <span class="tip-strong">${pct((q.tally[teamId].r32 || 0) / q.n)}</span>
    chance of reaching the knockout round${state.known ? ' (from current real results)' : ''}.</span>` : '';

  let html = `<span class="tip-head">${t.flag} ${t.name} · GROUP ${g}</span>`;

  ensureConfirmed();
  if (state.confirmed && state.confirmed.has(teamId)) {
    const w = state.confirmedWinner.has(teamId);
    const r = state.confirmedPos && state.confirmedPos.has(teamId) && !w;
    const detail = w ? 'has clinched top spot in the group'
      : r ? 'has clinched the runner-up place'
      : 'is mathematically through to the round of 32 (1st vs 2nd still open)';
    html += `<span class="tip-row tip-confirmed">✓ <span class="tip-strong">Place secured</span> — ${detail} from real results.</span>`;
  }

  // provisional / pre-sim view: standings from games shown so far
  if (!done) {
    const tbl = tableFromGames(g, shown);
    const row = tbl.find(r => r.id === teamId);
    const pos = tbl.findIndex(r => r.id === teamId) + 1;
    if (playedCount) {
      html += `<span class="tip-row tip-mono">PTS <span class="tip-strong">${row.pts}</span> ·
        W${row.w} D${row.d} L${row.l} · GD <span class="tip-strong">${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</span>
        · ${row.p} played</span>
        <span class="tip-row">Provisional <span class="tip-strong">${pos}${['st', 'nd', 'rd', 'th'][pos - 1]}</span> in Group ${g}.</span>`;
    } else {
      html += `<span class="tip-row">FIFA rating <span class="tip-strong">${t.elo}</span> — drives every simulated result.</span>`;
    }
    html += koLine || `<span class="tip-rule">Ranking: points → goal difference → goals scored → head-to-head.</span>`;
    return html;
  }

  const res = sim.groupResults[g];
  const pos = res.table.findIndex(r => r.id === teamId);
  const row = res.table[pos];
  html += `<span class="tip-row tip-mono">PTS <span class="tip-strong">${row.pts}</span> ·
    W${row.w} D${row.d} L${row.l} · GF ${row.gf} · GA ${row.ga} · GD <span class="tip-strong">${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</span></span>`;

  if (pos <= 1) {
    const dest = fixedDestination(g, pos);
    html += `<span class="tip-row">Finished <span class="tip-strong">${pos + 1}${pos === 0 ? 'st' : 'nd'}</span> —
      advances as ${pos === 0 ? 'group winner' : 'runner-up'} to <span class="tip-strong">Match ${dest.match}</span>.</span>`;
  } else if (pos === 2) {
    const rank = sim.thirdsRanked.findIndex(r => r.id === teamId) + 1;
    if (rank <= 8) {
      const dest = Object.keys(sim.thirdAssign).find(m => sim.thirdAssign[m].id === teamId);
      html += `<span class="tip-row">Finished <span class="tip-strong">3rd</span> — ranked
        <span class="tip-strong">#${rank} of 12</span> third-placed teams, qualified and allocated to
        <span class="tip-strong">Match ${dest}</span>.</span>`;
    } else {
      html += `<span class="tip-row">Finished <span class="tip-strong">3rd</span> — ranked
        #${rank} of 12 third-placed teams. Only the top 8 advance: <span class="tip-strong">eliminated</span>.</span>`;
    }
  } else {
    html += `<span class="tip-row">Finished <span class="tip-strong">4th</span> — eliminated.</span>`;
  }

  html += `<span class="tip-rule">Ranked by: points → goal difference → goals scored → head-to-head
    (fair play / lots approximated). Rating ${t.elo}.</span>`;
  return html;
}

// Best-thirds race, ranked by each team's chance to advance via the third-
// place route (P(finish 3rd AND make the best-8)). Uses the always-on
// qualification Monte Carlo — no manual simulation run required.
// the 12 third-placed teams (one per group) from current real standings,
// each with points, goal difference, and its chance to advance as a third.
function bestThirdsData() {
  ensureQualOdds();
  const q = state.qualOdds;
  const out = [];
  for (const g of Object.keys(GROUPS)) {
    const table = tableFromGames(g, groupShownGames(g, null, null)); // real games only
    const row = table[2]; // current third place
    if (!row) continue;
    out.push({
      id: row.id, group: g, pts: row.pts, gd: row.gf - row.ga, gf: row.gf, played: row.p,
      adv: q ? (q.tally[row.id].thirdAdv || 0) / q.n : 0,
    });
  }
  return out;
}

// Best-thirds race. Two views (toggle): PROJECTED order (by chance to advance
// as a third) and CURRENT placement (live points → GD ranking). Both list all
// 12 third-placed teams with points and goal difference. 8 of 12 advance.
function renderThirds() {
  const strip = $('#thirdsStrip');
  const view = state.thirdsView === 'current' ? 'current' : 'projected';
  const data = bestThirdsData();
  if (view === 'current') {
    data.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || team(b.id).elo - team(a.id).elo);
  } else {
    data.sort((a, b) => b.adv - a.adv || b.pts - a.pts || b.gd - a.gd || team(b.id).elo - team(a.id).elo);
  }

  let chips = '';
  data.forEach((r, i) => {
    const t = team(r.id);
    const inCut = view === 'current' ? i < 8 : r.adv >= 0.5;
    const gd = (r.gd > 0 ? '+' : '') + r.gd;
    const pctHtml = view === 'projected' ? `<span class="third-pct">${pct(r.adv)}</span>` : '';
    chips += `<span class="third-chip ${inCut ? 'qualified' : ''}" data-team="${t.id}">
      <span class="rank-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="flag">${t.flag}</span><span class="third-code">3${r.group} ${t.code}</span>
      <span class="third-stat">${r.pts}p · ${gd}</span>
      ${pctHtml}
    </span>`;
  });
  if (!chips) chips = '<span class="third-chip">no group games played yet</span>';

  const label = view === 'current'
    ? 'Best thirds · current placement — points → goal difference'
    : 'Best thirds · projected order — chance to advance as a third';
  const toggle = `<div class="thirds-toggle" id="thirdsToggle">
    <button data-tview="projected" class="${view === 'projected' ? 'active' : ''}">PROJECTED %</button>
    <button data-tview="current" class="${view === 'current' ? 'active' : ''}">CURRENT</button>
  </div>`;
  strip.innerHTML = `<div class="thirds-head">
      <span class="mono-label">${label} · 8 of 12 advance <span style="color:var(--color-peri)">▸ ${view === 'current' ? 'in the cut' : '&gt;50%'}</span></span>
      ${toggle}
    </div>
    <div class="thirds-row">${chips}</div>`;
}

// ---------- placement flow (groups -> round of 32) ----------

function renderFlow(sim) {
  const wrap = $('#flowWrap');
  if (!sim) {
    state.flowView = null;
    wrap.innerHTML = `<p class="footnote">Run a simulation to draw the placement lines. Each group sends its winner and
      runner-up to a fixed slot in the round of 32; the eight best third-placed teams are slotted against group winners
      according to FIFA's allocation of which groups they emerge from (one scenario of 495). Hover any pill to see why
      a pairing exists.</p>`;
    return;
  }

  const W = 1280, H = 440;
  const groups = Object.keys(GROUPS);
  const cellW = W / 12;
  const chipW = 86, chipH = 20;
  const matchY = 348, boxW = 72, boxH = 70, pitch = 80, boxX0 = (W - (16 * pitch - 8)) / 2;

  // build meta: matchId -> {home:{tid,g,pos}, away:{...}}; and chip destinations
  const meta = {};
  const chipDest = {}; // `${g}:${pos}` -> matchId
  BRACKET.r32.forEach(spec => {
    const sides = {};
    for (const sideKey of ['home', 'away']) {
      const ref = spec[sideKey];
      const [kind, key] = ref.split(':');
      let tid, g, pos;
      if (kind === 'W') { g = key; pos = 0; tid = sim.groupResults[g].table[0].id; }
      else if (kind === 'RU') { g = key; pos = 1; tid = sim.groupResults[g].table[1].id; }
      else { tid = sim.thirdAssign[key].id; g = groupOf(tid); pos = 2; }
      sides[sideKey] = { tid, g, pos, ref };
      chipDest[`${g}:${pos}`] = spec.match;
    }
    meta[spec.match] = sides;
  });
  state.flowView = { sim, meta };

  const posColor = ['#ababab', '#4d4d4d', '#7089ba'];
  const posDash = ['', '', '4 4'];

  let svg = `<svg class="flow-svg" id="flowSvg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="JetBrains Mono, monospace">`;

  // connecting lines first (under everything)
  BRACKET.r32.forEach((spec, mi) => {
    for (const sideKey of ['home', 'away']) {
      const s = meta[spec.match][sideKey];
      const gi = groups.indexOf(s.g);
      const x1 = gi * cellW + cellW / 2;
      const y1 = 46 + s.pos * 26 + chipH;
      const x2 = boxX0 + mi * pitch + boxW / 2;
      svg += `<path data-m="${spec.match}" d="M ${x1} ${y1} C ${x1} ${y1 + 110}, ${x2} ${matchY - 110}, ${x2} ${matchY}"
        fill="none" stroke="${posColor[s.pos]}" stroke-width="1" opacity="0.65"
        ${posDash[s.pos] ? `stroke-dasharray="${posDash[s.pos]}"` : ''}/>`;
    }
  });

  // group columns
  groups.forEach((g, gi) => {
    const cx = gi * cellW + cellW / 2;
    svg += `<text x="${cx}" y="26" text-anchor="middle" fill="#ffffff" font-size="15" font-weight="800" font-family="Inter, sans-serif">${g}</text>`;
    const res = sim.groupResults[g];
    const thirdQ = sim.qualifiedThirds.some(t => t.group === g);
    for (let pos = 0; pos < 3; pos++) {
      if (pos === 2 && !thirdQ) continue;
      const row = res.table[pos];
      const t = team(row.id);
      const y = 46 + pos * 26;
      const col = posColor[pos];
      const mId = chipDest[`${g}:${pos}`];
      svg += `<g data-hover="chip" data-m="${mId}">
        <rect x="${cx - chipW / 2}" y="${y}" width="${chipW}" height="${chipH}" rx="10"
          fill="#1c1c1c" stroke="${col}" stroke-width="1" ${pos === 2 ? 'stroke-dasharray="3 3"' : ''}/>
        <text x="${cx}" y="${y + 14}" text-anchor="middle" fill="${pos === 1 ? '#ababab' : '#ffffff'}" font-size="10.5">${pos + 1} · ${t.code}</text>
      </g>`;
    }
  });

  // round-of-32 boxes
  BRACKET.r32.forEach((spec, mi) => {
    const x = boxX0 + mi * pitch;
    const h = team(meta[spec.match].home.tid);
    const a = team(meta[spec.match].away.tid);
    svg += `<g data-hover="match" data-m="${spec.match}">
      <rect x="${x}" y="${matchY}" width="${boxW}" height="${boxH}" fill="#1c1c1c" stroke="#4d4d4d" stroke-width="1" stroke-dasharray="4 4"/>
      <text x="${x + boxW / 2}" y="${matchY + 16}" text-anchor="middle" fill="#808080" font-size="9">M${spec.match}</text>
      <text x="${x + boxW / 2}" y="${matchY + 36}" text-anchor="middle" fill="#ffffff" font-size="11">${h.code}</text>
      <text x="${x + boxW / 2}" y="${matchY + 56}" text-anchor="middle" fill="#ffffff" font-size="11">${a.code}</text>
    </g>`;
  });

  svg += '</svg>';

  // mobile: vertical card stack of the 16 round-of-32 fixtures
  const miniSlot = s => {
    const t = team(s.tid);
    const badge = (s.pos === 0 ? '1' : s.pos === 1 ? '2' : '3') + s.g;
    return `<div class="fm-slot"><span class="fm-badge pos${s.pos}">${badge}</span>
      <span class="flag">${t.flag}</span><span class="slot-name">${t.name}</span></div>`;
  };
  let stack = '<div class="flow-stack" id="flowStack">';
  BRACKET.r32.forEach(spec => {
    const m = meta[spec.match];
    stack += `<div class="flow-mini-card" data-hover="match" data-m="${spec.match}">
      <div class="fm-no">Match ${spec.match} · Round of 32</div>
      ${miniSlot(m.home)}<div class="fm-vs">vs</div>${miniSlot(m.away)}
    </div>`;
  });
  stack += '</div>';

  wrap.innerHTML = svg + stack;
}

function flowSideRule(matchId, side) {
  const sim = state.flowView.sim;
  const s = state.flowView.meta[matchId][side];
  const t = team(s.tid);
  if (s.pos === 0) {
    return `<span class="tip-row"><span class="tip-strong">${t.flag} ${t.name}</span> — won Group ${s.g}.
      FIFA's schedule sends 1${s.g} straight to Match ${matchId}.</span>`;
  }
  if (s.pos === 1) {
    return `<span class="tip-row"><span class="tip-strong">${t.flag} ${t.name}</span> — Group ${s.g} runners-up.
      2${s.g} is fixed to Match ${matchId}.</span>`;
  }
  const rank = sim.thirdsRanked.findIndex(r => r.id === s.tid) + 1;
  return `<span class="tip-row"><span class="tip-strong">${t.flag} ${t.name}</span> — #${rank}-ranked third (3${s.g}).
    Match ${matchId} may only host a third from groups ${THIRD_ALLOWED[matchId].join('/')}; FIFA's allocation
    table resolves the eight qualified thirds so every slot draws from its allowed set — and no third
    ever meets its own group's winner.</span>`;
}

function flowTip(matchId) {
  const m = state.flowView.meta[matchId];
  const h = team(m.home.tid), a = team(m.away.tid);
  return `<span class="tip-head">MATCH ${matchId} · ROUND OF 32 · ${h.code} v ${a.code}</span>
    ${flowSideRule(matchId, 'home')}
    ${flowSideRule(matchId, 'away')}
    <span class="tip-rule">Winner advances to Match ${NEXT_MATCH[matchId].match} in the round of 16.</span>`;
}

function clearFlowFocus() {
  const wrap = $('#flowWrap');
  if (!wrap) return;
  const svg = $('#flowSvg');
  if (svg) svg.classList.remove('focus');
  wrap.querySelectorAll('.hi').forEach(el => el.classList.remove('hi'));
}

function setFlowFocus(matchId) {
  const wrap = $('#flowWrap');
  if (!wrap) return;
  const svg = $('#flowSvg');
  wrap.querySelectorAll('.hi').forEach(el => el.classList.remove('hi'));
  if (svg) {
    svg.classList.add('focus');
    svg.querySelectorAll(`[data-m="${matchId}"]`).forEach(el => el.classList.add('hi'));
  }
  wrap.querySelectorAll(`.flow-mini-card[data-m="${matchId}"]`).forEach(el => el.classList.add('hi'));
}

// ---------- knockout bracket ----------

function matchById(sim, id) {
  if (!sim) return null;
  for (const r of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    const m = sim.rounds[r].find(x => x.match === id);
    if (m) return m;
  }
  return null;
}

// Build ONE coherent projected ("chalk") bracket from the slot-occupancy
// Monte Carlo. The round of 32 is seeded with the most-likely team to emerge
// from the groups into each slot; from there the HEAD-TO-HEAD favourite of
// each shown matchup advances. This keeps the bracket self-consistent: the
// team shown winning a tie (always ≥50%) is the one that fills the next slot.
function buildChalk() {
  const p = state.predict;
  if (!p) return null;
  const topId = dist => {
    let bid = null, bc = -1;
    for (const k in dist) if (dist[k] > bc) { bc = dist[k]; bid = k; }
    return bid;
  };
  const winnerOf = {}, loserOf = {}, occ = {};
  for (const roundKey of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    for (const spec of BRACKET[roundKey]) {
      const id = spec.match;
      const s = p.slots[id] || { home: {}, away: {}, win: {} };
      // a slot is "real" when reality has filled it: a confirmed fixture team,
      // or the winner/loser advanced from a finished feeder match
      const realHome = koFixTeam(id, 'home') || realSlotTeam(spec.home);
      const realAway = koFixTeam(id, 'away') || realSlotTeam(spec.away);
      const resolve = (ref, dist, fixed) => {
        if (fixed) return fixed;
        const [kind, key] = ref.split(':');
        if (kind === 'M') return winnerOf[key] || null;   // winner advances
        if (kind === 'L') return loserOf[key] || null;     // loser → bronze
        return topId(dist);                                // group-origin slot
      };
      const home = resolve(spec.home, s.home, realHome);
      const away = resolve(spec.away, s.away, realAway);
      const reach = (tid, dist, isReal) => isReal ? 1 : (tid ? (dist[tid] || 0) / p.n : 0);
      let winner = home || away, loser = null, pHome = 0.5;
      if (home && away) {
        const real = state.known && state.known.ko && state.known.ko[id];
        if (real && real.winner && (real.winner === home || real.winner === away)) {
          winner = real.winner; loser = winner === home ? away : home;
          pHome = winner === home ? 1 : 0; // actual result
        } else {
          pHome = koWinProb(team(home).elo, team(away).elo);
          winner = pHome >= 0.5 ? home : away;
          loser = winner === home ? away : home;
        }
      }
      winnerOf[id] = winner; loserOf[id] = loser;
      occ[id] = {
        home, away, winner, loser, pHome,
        homeReal: !!realHome, awayReal: !!realAway,
        homeReach: reach(home, s.home, !!realHome), awayReach: reach(away, s.away, !!realAway),
      };
    }
  }
  return { occ, n: p.n };
}
// per-match accessor over the cached chalk bracket
function chalkMatch(id) { return state.chalk ? state.chalk.occ[id] : null; }

// the FIFA-confirmed team assigned to a knockout slot (from the live feed)
function koFixTeam(id, side) {
  const f = state.koFixtures && state.koFixtures[id];
  return f ? (side === 'home' ? f.home : f.away) : null;
}
// the team that has really filled a slot via a played knockout result: the
// winner of a finished feeder match (M:n), or its loser for the bronze (L:n).
// This advances actual results round-by-round even before the next tie's
// other side is known.
function realSlotTeam(ref) {
  if (!state.known || !state.known.ko) return null;
  const [kind, key] = ref.split(':');
  const r = state.known.ko[key];
  if (!r || !r.winner) return null;
  if (kind === 'M') return r.winner;
  if (kind === 'L') return r.winner === r.home ? r.away : r.home;
  return null;
}

// opts: { groupsDone, revealed:Set, live:matchId, interactive:bool, mode }
// mode 'matchday' (default) fills slots from `sim` with scores; mode
// 'predict' fills them from state.predict with the most-likely team + %.
// omit opts entirely with a sim for a full matchday reveal.
function renderBracket(sim, opts = {}) {
  const mode = opts.mode || 'matchday';
  let revealed = opts.revealed;
  if (!revealed) revealed = sim ? new Set(ALL_MATCH_IDS) : new Set();
  const groupsDone = sim ? (opts.groupsDone !== undefined ? opts.groupsDone : true) : false;
  const interactive = !!opts.interactive;
  const liveId = opts.live;

  state.koMode = mode;
  state.bracketView = { sim, revealed, groupsDone, interactive, mode };
  if (mode === 'matchday') {
    state.mdView = { sim, revealed, groupsDone, interactive, live: liveId };
    if (sim) setKoStatus('⚽ MATCHDAY · one simulated tournament, with scores.');
  }
  syncKoModeButtons();
  ensureConfirmed();
  if (mode === 'predict') state.chalk = buildChalk();
  // An R32 slot is gold only when its exact POSITION is locked by real
  // results: the 1x slot once a group winner is clinched, the 2x slot once a
  // runner-up is clinched. Advancement alone (team is top-2 but order still
  // open, e.g. two group rivals) does NOT lock a specific slot.
  const lockW = state.lockWinnerGroup || {}, lockR = state.lockRunnerGroup || {};
  const confirmedSlot = (id, ref) => {
    if (ROUND_OF[id] !== 'r32') return '';
    const [kind, g] = ref.split(':');
    if (kind === 'W' && lockW[g]) return ' confirmed';
    if (kind === 'RU' && lockR[g]) return ' confirmed';
    return '';
  };
  // the team that has mathematically locked this R32 slot, from real results
  // (so secured fixtures show even before any simulation is run)
  const lockedSlotTeam = (id, ref) => {
    if (ROUND_OF[id] !== 'r32') return null;
    const [kind, g] = ref.split(':');
    if (kind === 'W') return lockW[g] || null;
    if (kind === 'RU') return lockR[g] || null;
    return null;
  };
  // FIFA-confirmed knockout matchup (from the live feed): the actual team
  // assigned to this slot, including third-place allocations. This is the
  // authoritative source for a confirmed fixture (e.g. USA v Bosnia).
  const feedTeam = (id, side) => {
    const f = state.koFixtures && state.koFixtures[id];
    return f ? (side === 'home' ? f.home : f.away) : null;
  };

  const refKnown = ref => {
    const [kind, key] = ref.split(':');
    if (kind === 'M' || kind === 'L') return revealed.has(key);
    return groupsDone;
  };

  // ----- matchday slot (simulated team + score) -----
  function slotHtml(ref, m, side, id) {
    let name = `<span class="slot-origin">${shortSeed(ref)}</span>`;
    let score = '', cls = '', pen = '';
    if (sim && m && refKnown(ref)) {
      const tid = side === 'home' ? m.home : m.away;
      const t = team(tid);
      // gold if this slot is real: a confirmed FIFA fixture, a winner advanced
      // from a played knockout tie, or a clinched group position (sim agrees)
      if (feedTeam(id, side) === tid || realSlotTeam(ref) === tid || confirmedSlot(id, ref)) cls += ' confirmed';
      name = `<span class="slot-origin">${shortSeed(ref, tid)}</span><span class="flag">${t.flag}</span><span class="slot-name">${t.name}</span>`;
      if (revealed.has(m.match)) {
        const g = side === 'home' ? m.hg : m.ag;
        score = `<span class="slot-score">${g}</span>`;
        const won = m.winner === tid;
        cls += won ? ' winner' : ' loser';
        if (m.pens) pen = `<span class="pen-note">${side === 'home' ? m.pens.h : m.pens.a}p</span>`;
      }
    } else {
      // no simulated placement yet — show any team locked into this slot by
      // real results (a confirmed FIFA fixture, or a clinched group position),
      // so secured fixtures appear on a fresh sheet without a simulation
      const lockTid = feedTeam(id, side) || realSlotTeam(ref) || lockedSlotTeam(id, ref);
      if (lockTid) {
        const t = team(lockTid);
        cls += ' confirmed';
        name = `<span class="slot-origin">${shortSeed(ref, lockTid)}</span><span class="flag">${t.flag}</span><span class="slot-name">${t.name}</span>`;
      }
    }
    return `<div class="match-slot ${cls}">${name}${pen}${score}</div>`;
  }

  // ----- predictive slot (projected team in the chalk bracket + reach %) -----
  // A FIFA-confirmed fixture overrides the projection: show the real team,
  // gold, at 100% (it has actually reached this slot).
  function slotHtmlPredict(ref, id, side) {
    const cm = chalkMatch(id);
    const tid = cm && cm[side];
    if (!tid) {
      return `<div class="match-slot pre"><span class="slot-origin">${shortSeed(ref)}</span><span class="slot-name muted">—</span></div>`;
    }
    const t = team(tid);
    const real = side === 'home' ? cm.homeReal : cm.awayReal; // confirmed / advanced
    const reach = side === 'home' ? cm.homeReach : cm.awayReach; // 1 when real
    const isConf = real || !!confirmedSlot(id, ref);
    const won = cm.winner === tid;
    return `<div class="match-slot predict ${won ? 'winner' : ''}${isConf ? ' confirmed' : ''}">
      <span class="slot-origin">${shortSeed(ref, tid)}</span>
      <span class="flag">${t.flag}</span>
      <span class="slot-name">${t.name}</span>
      <span class="slot-pct">${pct(reach)}</span>
      <span class="slot-bar" style="width:${Math.min(100, reach * 100)}%"></span>
    </div>`;
  }

  // win / draw / win odds bar shown inline on every knockout box, computed
  // from the two teams currently in it (real where confirmed, projected
  // otherwise) — so the percentages show without entering predictive mode.
  function oddsLine(h, a) {
    if (!h || !a) return '';
    const [la, lb] = goalLambdas(team(h).elo, team(a).elo);
    const [w, d, l] = outcomeProbs(la, lb);
    return `<div class="match-odds">
      <span class="mo-bar"><i style="width:${(w * 100).toFixed(1)}%"></i><i class="mo-d" style="width:${(d * 100).toFixed(1)}%"></i><i class="mo-a" style="flex:1"></i></span>
      <span class="mo-nums">${Math.round(w * 100)} · ${Math.round(d * 100)} · ${Math.round(l * 100)}</span>
    </div>`;
  }
  // the two teams occupying a box, mode-aware (mirrors the slot renderers)
  function boxTeams(id) {
    const spec = SPEC_BY_ID[id];
    if (mode === 'predict') { const cm = chalkMatch(id); return cm ? [cm.home, cm.away] : [null, null]; }
    const m = matchById(sim, id);
    if (sim && m && refKnown(spec.home) && refKnown(spec.away)) return [m.home, m.away];
    return [
      feedTeam(id, 'home') || realSlotTeam(spec.home) || lockedSlotTeam(id, spec.home),
      feedTeam(id, 'away') || realSlotTeam(spec.away) || lockedSlotTeam(id, spec.away),
    ];
  }

  function matchBox(id, side) {
    const spec = SPEC_BY_ID[id];
    const r32 = ROUND_OF[id] === 'r32' ? 'r32' : '';
    const [bh, ba] = boxTeams(id);
    const odds = oddsLine(bh, ba);
    if (mode === 'predict') {
      return `<div class="match-box predict-box ${r32}" data-mid="${id}" data-side="${side}">
        <span class="match-no">M${id}</span>
        ${slotHtmlPredict(spec.home, id, 'home')}
        ${slotHtmlPredict(spec.away, id, 'away')}
        ${odds}
      </div>`;
    }
    const m = matchById(sim, id);
    const played = revealed.has(id);
    const live = liveId === id;
    const realLock = played && m && m.real;
    const liveReal = m && m.live;
    const clickable = interactive && !played && !live && m && refKnown(spec.home) && refKnown(spec.away);
    return `<div class="match-box ${r32} ${played ? 'match-played' : ''} ${live ? 'match-live pulsing' : ''} ${realLock ? 'real-locked' : ''} ${liveReal ? 'live-real' : ''} ${clickable ? 'clickable' : ''}" data-mid="${id}" data-side="${side}">
      <span class="match-no">M${id}${m && m.et && played ? ' · AET' : ''}</span>
      ${slotHtml(spec.home, m, 'home', id)}
      ${slotHtml(spec.away, m, 'away', id)}
      ${odds}
    </div>`;
  }

  function column(ids, title, count, roundKey, side) {
    const liveRound = liveId && ROUND_OF[liveId] === roundKey;
    return `<div class="bracket-round ${liveRound ? 'round-live' : ''}" data-side="${side}">
      <div class="round-title">${title} <span class="round-count">· ${count}</span></div>
      ${ids.map(id => matchBox(id, side)).join('')}
    </div>`;
  }

  const L = BRACKET_LAYOUT.left, R = BRACKET_LAYOUT.right;
  let champ = null, champPct = '';
  if (mode === 'predict') {
    const cm = chalkMatch('104');
    if (cm && cm.winner) {
      champ = team(cm.winner);
      const p = state.predict;
      champPct = p ? pct((p.slots['104'].win[cm.winner] || 0) / p.n) : '';
    }
  } else {
    const finalM = matchById(sim, '104');
    champ = sim && revealed.has('104') ? team(finalM.winner) : null;
  }

  const platePct = champPct ? `<div class="champ-pct">${champPct} to lift it</div>` : '';
  const centerCol = `<div class="bracket-round bracket-center" style="justify-content:center; gap:12px;" data-side="center">
    <div class="round-title">FINAL <span class="round-count">· JUL 19 · NY/NJ</span></div>
    ${matchBox('104', 'center')}
    <div class="champion-plate">
      <div class="trophy">🏆</div>
      <span class="champ-flag">${champ ? champ.flag : '◌'}</span>
      <div class="mono-micro">${mode === 'predict' ? 'PREDICTED CHAMPION' : 'WORLD CHAMPIONS'}</div>
      <div class="champ-name">${champ ? champ.name : '—'}</div>
      ${platePct}
    </div>
    <div class="round-title" style="padding-top:10px">BRONZE <span class="round-count">· M103</span></div>
    ${matchBox('103', 'center')}
  </div>`;

  $('#bracket').innerHTML =
    column(L.r32, 'R32', 'L1', 'r32', 'left') +
    column(L.r16, 'R16', 'L2', 'r16', 'left') +
    column(L.qf, 'QF', 'L3', 'qf', 'left') +
    column(L.sf, 'SF', 'M101', 'sf', 'left') +
    centerCol +
    column(R.sf, 'SF', 'M102', 'sf', 'right') +
    column(R.qf, 'QF', 'R3', 'qf', 'right') +
    column(R.r16, 'R16', 'R2', 'r16', 'right') +
    column(R.r32, 'R32', 'R1', 'r32', 'right');

  $('#bracket').classList.toggle('mode-predict', mode === 'predict');

  // draw the connector tree once the columns have laid out
  requestAnimationFrame(drawBracketLines);

  // mobile: round-stacked vertical layout (same match boxes, so the
  // delegated tooltip + click-to-play handlers cover both renderings)
  const champPlate = `<div class="champion-plate">
    <div class="trophy">🏆</div>
    <span class="champ-flag">${champ ? champ.flag : '◌'}</span>
    <div class="mono-micro">${mode === 'predict' ? 'PREDICTED CHAMPION' : 'WORLD CHAMPIONS'}</div>
    <div class="champ-name">${champ ? champ.name : '—'}</div>
    ${platePct}
  </div>`;
  const stackRound = (ids, title, key, sub) => {
    const liveRound = liveId && ROUND_OF[liveId] === key;
    return `<div class="stack-round ${liveRound ? 'round-live' : ''}">
      <div class="stack-round-head">${title} <span class="rc">${sub}</span></div>
      ${ids.map(id => matchBox(id, 'left')).join('')}
    </div>`;
  };
  $('#bracketStack').innerHTML =
    stackRound(ROUND_IDS.r32, 'ROUND OF 32', 'r32', '16 TIES') +
    stackRound(ROUND_IDS.r16, 'ROUND OF 16', 'r16', '8 TIES') +
    stackRound(ROUND_IDS.qf, 'QUARTER-FINALS', 'qf', '4 TIES') +
    stackRound(ROUND_IDS.sf, 'SEMI-FINALS', 'sf', 'M101–102') +
    stackRound(ROUND_IDS.final, 'THE FINAL', 'final', 'JUL 19 · NY/NJ') +
    champPlate +
    stackRound(ROUND_IDS.third, 'BRONZE FINAL', 'third', 'M103');
}

// SVG connector tree: link each fixture to the two it feeds from. Drawn
// from rendered positions so it tracks the wallchart at any width.
function drawBracketLines() {
  const bracket = $('#bracket');
  if (!bracket) return;
  let svg = bracket.querySelector('.bracket-lines');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bracket-lines');
    bracket.prepend(svg);
  }
  const W = bracket.scrollWidth, H = bracket.scrollHeight;
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const base = bracket.getBoundingClientRect();
  const boxRect = id => {
    const el = bracket.querySelector(`.match-box[data-mid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left - base.left, right: r.right - base.left, cy: r.top - base.top + r.height / 2 };
  };
  let paths = '';
  for (const id of ALL_MATCH_IDS) {
    const spec = SPEC_BY_ID[id];
    const parent = boxRect(id);
    if (!parent) continue;
    for (const ref of [spec.home, spec.away]) {
      const [kind, key] = ref.split(':');
      if (kind !== 'M') continue; // only winner-advances links form the tree
      const child = boxRect(key);
      if (!child) continue;
      let x1, x2;
      if (child.cy <= parent.cy + 0.5 && child.right <= parent.left + 1) { x1 = child.right; x2 = parent.left; }
      else if (child.left >= parent.right - 1) { x1 = child.left; x2 = parent.right; }
      else if (child.right <= parent.left + 1) { x1 = child.right; x2 = parent.left; }
      else { x1 = child.right; x2 = parent.left; }
      const mx = (x1 + x2) / 2;
      paths += `<path d="M${x1.toFixed(1)} ${child.cy.toFixed(1)} H${mx.toFixed(1)} V${parent.cy.toFixed(1)} H${x2.toFixed(1)}"/>`;
    }
  }
  svg.innerHTML = paths;
}

// Predictive tooltip: the projected (chalk) matchup for this slot, the
// head-to-head favourite that advances (always ≥50%), and how likely each
// shown team is to actually reach this slot.
function bracketTipPredict(id) {
  const p = state.predict;
  let html = `<span class="tip-head">MATCH ${id} · ${ROUND_LABELS[ROUND_OF[id]]} · PROJECTED</span>`;
  html += dateRow(koDate(id), koVenue(id));
  if (state.koFixtures && state.koFixtures[id]) {
    const f = state.koFixtures[id], fh = team(f.home), fa = team(f.away);
    html += `<span class="tip-row tip-confirmed">✓ <span class="tip-strong">Confirmed by FIFA</span> — ${fh.flag} ${fh.name} v ${fa.name} ${fa.flag}</span>`;
  }
  const cm = chalkMatch(id);
  if (!p || !cm || !cm.home || !cm.away) {
    html += `<span class="tip-row">Earlier rounds resolve first — this tie fills once both sides are projected.</span>`;
    return html;
  }
  const h = team(cm.home), a = team(cm.away);
  const pH = cm.pHome; // head-to-head incl. ET / pens
  const [la, lb] = goalLambdas(h.elo, a.elo);
  const [w90, d90, l90] = outcomeProbs(la, lb);
  const w = team(cm.winner);
  const favPct = cm.winner === cm.home ? pH : 1 - pH;
  html += `<span class="tip-row"><span class="tip-strong">${h.flag} ${h.name}</span> v
    <span class="tip-strong">${a.name} ${a.flag}</span> <span style="color:#4d4d4d">— projected tie</span></span>
    <div class="tip-odds-bar"><span class="home-share" style="width:${w90 * 100}%"></span><span class="draw-share" style="width:${d90 * 100}%"></span><span class="away-share" style="flex:1"></span></div>
    <span class="tip-row tip-mono">${h.code} <span class="tip-strong">${pct(w90)}</span> · draw ${pct(d90)} · <span class="tip-strong">${pct(l90)}</span> ${a.code} <span style="color:#4d4d4d">(90′)</span></span>
    <span class="tip-row tip-mono">${w.flag} <span class="tip-strong">${w.name}</span> favoured to advance · <span class="tip-strong">${pct(favPct)}</span> <span style="color:#4d4d4d">(incl. ET / pens)</span></span>`;
  // how likely each shown team is to actually reach this slot
  html += `<span class="tip-rule">Chance to reach this slot:</span>
    <div class="tip-pred-row"><span class="tpr-name">${h.flag} ${h.name}</span>
      <span class="tpr-track"><span class="tpr-fill" style="width:${Math.min(100, cm.homeReach * 100)}%"></span></span>
      <span class="tpr-val">${pct(cm.homeReach)}</span></div>
    <div class="tip-pred-row"><span class="tpr-name">${a.flag} ${a.name}</span>
      <span class="tpr-track"><span class="tpr-fill" style="width:${Math.min(100, cm.awayReach * 100)}%"></span></span>
      <span class="tpr-val">${pct(cm.awayReach)}</span></div>`;
  html += `<span class="tip-rule" style="color:#4d4d4d">Projected bracket: most-likely teams out of the groups, favourites advance · ${p.n.toLocaleString()} sims.</span>`;
  return html;
}

function bracketTip(id) {
  const view = state.bracketView;
  if (!view) return null;
  if (view.mode === 'predict') return bracketTipPredict(id);
  const { sim, revealed, groupsDone, interactive } = view;
  const spec = SPEC_BY_ID[id];
  const m = matchById(sim, id);
  const refKnown = ref => {
    const [kind, key] = ref.split(':');
    if (kind === 'M' || kind === 'L') return revealed.has(key);
    return groupsDone;
  };

  let html = `<span class="tip-head">MATCH ${id} · ${ROUND_LABELS[ROUND_OF[id]]}</span>`;
  html += dateRow(koDate(id), koVenue(id));
  if (state.koFixtures && state.koFixtures[id]) {
    const f = state.koFixtures[id], fh = team(f.home), fa = team(f.away);
    html += `<span class="tip-row tip-confirmed">✓ <span class="tip-strong">Confirmed by FIFA</span> — ${fh.flag} ${fh.name} v ${fa.name} ${fa.flag}</span>`;
  }

  if (!sim || !m || !refKnown(spec.home) || !refKnown(spec.away)) {
    html += `<span class="tip-row"><span class="tip-strong">${originLabel(spec.home)}</span> v
      <span class="tip-strong">${originLabel(spec.away)}</span> — slots fill as earlier rounds resolve.</span>`;
    if (NEXT_MATCH[id]) html += `<span class="tip-rule">Winner advances to Match ${NEXT_MATCH[id].match}.</span>`;
    return html;
  }

  const h = team(m.home), a = team(m.away);
  const pH = koWinProb(h.elo, a.elo);
  const [la, lb] = goalLambdas(h.elo, a.elo);
  const [w90, d90, l90] = outcomeProbs(la, lb);
  const played = revealed.has(id);

  html += `<span class="tip-row"><span class="tip-strong">${h.flag} ${h.name}</span> v
    <span class="tip-strong">${a.name} ${a.flag}</span></span>
    <div class="tip-odds-bar"><span class="home-share" style="width:${w90 * 100}%"></span><span class="draw-share" style="width:${d90 * 100}%"></span><span class="away-share" style="flex:1"></span></div>
    <span class="tip-row tip-mono">${h.code} <span class="tip-strong">${pct(w90)}</span> · draw ${pct(d90)} · <span class="tip-strong">${pct(l90)}</span> ${a.code}
      <span style="color:#4d4d4d">— pre-match (90′)</span></span>
    <span class="tip-row tip-mono" style="color:var(--color-steel)">${h.code} <span class="tip-strong">${pct(pH)}</span> · ${pct(1 - pH)} ${a.code} to advance (incl. ET / pens)</span>`;

  if (played) {
    html += `<span class="tip-rule">FULL TIME: <span class="tip-strong">${h.code} ${m.hg}–${m.ag} ${a.code}</span>${m.et ? ' after extra time' : ''}.</span>`;
    for (const c of m.cards || []) {
      const ct = team(c.team);
      html += `<span class="tip-row">🟥 ${c.minute}′ — ${ct.name} down to ten men.</span>`;
    }
    if (m.pens) {
      const seq = s => s.map(k => (k ? '●' : '○')).join('');
      html += `<span class="tip-row">Shoot-out <span class="tip-strong">${m.pens.h}–${m.pens.a}</span>:
        <span class="tip-mono">${h.code} ${seq(m.pens.seqH)} · ${a.code} ${seq(m.pens.seqA)}</span></span>`;
    }
    const w = team(m.winner), l = team(m.loser);
    if (l.elo - w.elo >= 80) {
      html += `<span class="tip-row" style="color:var(--color-peri)">UPSET — ${w.name} beat the odds (${pct(m.winner === m.home ? pH : 1 - pH)} pre-match).</span>`;
    }
  } else if (interactive) {
    html += `<span class="tip-action">▸ CLICK TO PLAY THIS FIXTURE</span>`;
  }
  if (NEXT_MATCH[id] && !played) {
    html += `<span class="tip-rule">Winner advances to Match ${NEXT_MATCH[id].match}.</span>`;
  }
  return html;
}

// ---------- knockout view mode (matchday ⇄ predictive) ----------

function setKoStatus(html) {
  const el = $('#koModeStatus');
  if (el) el.innerHTML = html;
}

function syncKoModeButtons() {
  $$('.ko-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.komode === state.koMode));
}

// One-shot, silent pull of current real results. Sets state.known so every
// simulation continues from reality; failures are swallowed so the app still
// runs pre-tournament.
async function syncLiveQuiet() {
  try {
    const feed = makeRealFeed(WC_DATA);
    const snap = await feed.snapshot();
    const folded = buildKnown(snap);
    state.known = folded.known;
    state.knownFolded = folded;
    // merge feed dates/venues over the hardcoded knockout schedule
    if (folded.dates) {
      state.matchDates = {
        group: Object.assign({}, folded.dates.group),
        ko: Object.assign({}, MATCH_DATES_KO, folded.dates.ko),
      };
    }
    if (folded.venues) {
      state.matchVenues = {
        group: Object.assign({}, folded.venues.group),
        ko: Object.assign({}, MATCH_VENUES_KO, folded.venues.ko),
      };
    }
    state.koFixtures = folded.koFixtures || {};
    // expose confirmed fixtures to the engine so simulations (incl. matchday)
    // honour FIFA's third-place allocation instead of reshuffling locked ties
    state.known.koFixtures = state.koFixtures;
    return folded;
  } catch (e) {
    return null;
  }
}

function setRealNote(html) {
  const el = $('#realNote');
  if (el) el.innerHTML = html;
}

// Pull real data and refresh whatever's on screen. Real data is always on:
// run on load and on demand via the ↻ REAL DATA button.
async function refreshRealData(announce) {
  const btn = $('#btnRefresh');
  if (btn) { btn.disabled = true; btn.textContent = 'SYNCING…'; }
  setRealNote('<span class="real-syncing">● syncing real results…</span>');
  const folded = await syncLiveQuiet();
  state.predict = null; // force predictive to re-project on next open
  if (btn) { btn.disabled = false; btn.textContent = '↻ REAL DATA'; }

  if (!folded) {
    setRealNote('<span class="real-off">○ no real data reachable — showing a clean pre-tournament sheet</span>');
  } else if (folded.finished + folded.live === 0) {
    setRealNote('<span class="real-on">● real data on · tournament not started — all results simulated</span>');
  } else {
    setRealNote(`<span class="real-on">● real data on · <b>${folded.finished}</b> result${folded.finished === 1 ? '' : 's'} locked${folded.live ? ` · <b>${folded.live}</b> in play` : ''} · every simulation continues from here</span>`);
  }

  // refresh current view with the new reality, unless mid-animation.
  // re-render the bracket even with no simulation so secured fixtures show.
  if (!state.matchday) {
    renderGroups(state.sim || null);
    renderThirds(); // best-thirds race reflects the new real data
    if (state.sim) renderFlow(state.sim);
    if (state.koMode === 'predict') enterPredict();
    else renderBracket(state.sim || null);
  }
  if (announce) setNote(folded && folded.finished + folded.live ? `REAL DATA SYNCED · ${knownCount()} RESULT${knownCount() === 1 ? '' : 'S'} LOCKED` : 'REAL DATA SYNCED');
}

const PREDICT_RUNS = 1500;

async function enterPredict() {
  if (state.predictBusy) return;
  state.predictBusy = true;
  hideTip();
  setKoStatus('◎ Projecting from real results …');
  // ensure we have the latest real data; pull quietly if Live wasn't run
  let pulled = null;
  if (!state.known) pulled = await syncLiveQuiet();
  await sleep(20); // let the status repaint before the synchronous run
  const t0 = performance.now();
  state.predict = slotMonteCarlo(WC_DATA, PREDICT_RUNS, state.known || undefined);
  const ms = Math.round(performance.now() - t0);
  renderBracket(null, { mode: 'predict' });
  const basis = state.known
    ? `conditioned on ${knownCount()} real result${knownCount() === 1 ? '' : 's'}`
    : (pulled === null ? 'no live data reachable — pre-tournament projection' : 'pre-tournament projection');
  setKoStatus(`◎ PREDICTIVE · projected bracket — favourites advance · ${basis} · ${PREDICT_RUNS.toLocaleString()} sims · ${ms}ms`);
  state.predictBusy = false;
}

function setKoMode(mode) {
  if (mode === state.koMode && mode === 'predict') return;
  if (mode === 'predict') {
    state.koMode = 'predict';
    syncKoModeButtons();
    enterPredict();
  } else {
    state.koMode = 'matchday';
    syncKoModeButtons();
    const v = state.mdView;
    if (v) renderBracket(v.sim, { ...v, mode: 'matchday' });
    else renderBracket(null, { mode: 'matchday' });
    setKoStatus(state.sim || (state.matchday && state.matchday.sim)
      ? '⚽ MATCHDAY · one simulated tournament, with scores.'
      : 'Simulated bracket — run Matchday or Run Once to fill it.');
  }
}

// ---------- monte carlo ----------

const MC_COLS = [
  { key: 'groupWin', label: 'WIN GRP' },
  { key: 'r32', label: 'R32' },
  { key: 'r16', label: 'R16' },
  { key: 'qf', label: 'QF' },
  { key: 'sf', label: 'SF' },
  { key: 'final', label: 'FINAL' },
  { key: 'champion', label: 'CHAMPION' },
];

function renderMC() {
  const wrap = $('#mcWrap');
  if (!state.mc) {
    wrap.innerHTML = `<p class="footnote">Run ×1000 to estimate each team's probability of winning its group and
      reaching every knockout round. Probabilities are Monte Carlo frequencies over full-tournament simulations.</p>`;
    return;
  }
  const { tally, n } = state.mc;
  const rows = Object.keys(tally).map(id => ({ id, ...tally[id] }));
  rows.sort((a, b) => state.sortDir * (a[state.sort] - b[state.sort]) ||
    (b.champion - a.champion) || (b.final - a.final) || (b.sf - a.sf));

  const fmt = v => {
    const p = (100 * v) / n;
    if (v === 0) return '<span style="color:#4d4d4d">0</span>';
    return p >= 99.95 ? '100' : p.toFixed(1);
  };

  let head = `<tr><th>#</th><th>TEAM</th><th>RATING</th>`;
  for (const c of MC_COLS) {
    head += `<th class="${state.sort === c.key ? 'sorted' : ''}" data-sort="${c.key}">${c.label} ${state.sort === c.key ? (state.sortDir === -1 ? '▾' : '▴') : ''}</th>`;
  }
  head += '</tr>';

  const SHORT = { groupWin: 'GRP', r32: 'R32', r16: 'R16', qf: 'QF', sf: 'SF', final: 'FIN', champion: 'CUP' };

  let body = '';
  let cards = '';
  rows.forEach((r, i) => {
    const t = team(r.id);
    body += `<tr><td class="rank-cell">${String(i + 1).padStart(2, '0')}</td>
      <td class="team-cell"><span class="flag">${t.flag}</span>${t.name} <span class="mono-micro" style="color:#4d4d4d">${groupOf(r.id)}</span></td>
      <td>${t.elo}</td>`;
    let funnel = '';
    for (const c of MC_COLS) {
      const p = (100 * r[c.key]) / n;
      body += `<td class="prob-cell"><span class="prob-bar" style="width:${Math.min(100, p)}%"></span>
        <span class="prob-num ${p >= 50 ? 'prob-hot' : ''}">${fmt(r[c.key])}</span></td>`;
      funnel += `<div class="stage ${c.key === 'champion' ? 'champ' : ''} ${state.sort === c.key ? 'sorted' : ''}">
        <span class="sbar" style="height:${Math.min(100, p)}%"></span>
        <span class="slabel">${SHORT[c.key]}</span>
        <span class="sval">${fmt(r[c.key])}</span>
      </div>`;
    }
    body += '</tr>';
    cards += `<div class="mc-card">
      <div class="mc-card-head">
        <span class="rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="flag">${t.flag}</span>
        <span class="name">${t.name}</span>
        <span class="grp">${groupOf(r.id)}</span>
        <span class="rating">${t.elo}</span>
      </div>
      <div class="mc-funnel">${funnel}</div>
    </div>`;
  });

  const sortControl = `<div class="mc-sort-wrap">
    <label for="mcSort">Sort by</label>
    <select id="mcSort">${MC_COLS.map(c => `<option value="${c.key}" ${state.sort === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
  </div>`;

  wrap.innerHTML = `
    <p class="mono-label" style="margin-bottom:4px">${state.mcContext || (n.toLocaleString() + ' TOURNAMENTS SIMULATED')} · VALUES IN %</p>
    ${sortControl}
    <div class="mc-table-wrap"><table class="mc-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
    <div class="mc-stack">${cards}</div>`;

  wrap.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.sortDir *= -1;
      else { state.sort = k; state.sortDir = -1; }
      renderMC();
    });
  });
  const sel = wrap.querySelector('#mcSort');
  if (sel) sel.addEventListener('change', () => { state.sort = sel.value; state.sortDir = -1; renderMC(); });
}

// ---------- modes ----------

function setNote(html) { $('#modeNote').innerHTML = html; }

function resetAll() {
  state.token++;
  state.sim = null;
  state.matchday = null;
  state.mc = null;
  state.mcContext = '';
  state.predict = null;
  state.mdView = null;
  state.koMode = 'matchday';
  hideTip();
  $('#matchdayStage').classList.remove('active');
  // real data stays on — the cleared sheet still shows results already played
  renderGroups(null);
  renderThirds(null);
  renderFlow(null);
  renderBracket(null);
  renderMC();
  setKoStatus('Simulated bracket — run Matchday or Run Once to fill it.');
  setNote(state.known && knownCount() ? `SHEET CLEAR · ${knownCount()} REAL RESULT${knownCount() === 1 ? '' : 'S'} STILL ON` : 'SHEET CLEAR · KICK-OFF JUN 11 · ESTADIO AZTECA');
}

function runOnce() {
  state.token++;
  state.matchday = null;
  hideTip();
  $('#matchdayStage').classList.remove('active');
  state.sim = simulateTournament(WC_DATA, state.known || undefined);
  renderGroups(state.sim);
  renderThirds(state.sim);
  renderFlow(state.sim);
  renderBracket(state.sim);
  const champ = team(state.sim.champion);
  const from = state.known ? ` · FROM ${knownCount()} REAL RESULT${knownCount() === 1 ? '' : 'S'}` : '';
  setNote(`ONE TOURNAMENT SIMULATED${from} · CHAMPION <span class="live">${champ.name.toUpperCase()} ${champ.flag}</span>`);
}

async function runThousand() {
  state.token++;
  const myToken = state.token;
  hideTip();
  $('#matchdayStage').classList.remove('active');
  setNote('SIMULATING ×1000 …');
  await sleep(30);
  if (myToken !== state.token) return;
  const t0 = performance.now();
  state.mc = monteCarlo(WC_DATA, 1000, null, state.known || undefined);
  const ms = Math.round(performance.now() - t0);
  state.sort = 'champion'; state.sortDir = -1;
  state.mcContext = state.known
    ? `1000 TOURNAMENTS · CONDITIONED ON ${knownCount()} REAL RESULT${knownCount() === 1 ? '' : 'S'}`
    : '';
  renderMC();
  const from = state.known ? ` · FROM ${knownCount()} REAL RESULTS` : '';
  setNote(`1000 TOURNAMENTS · ${(72 * 1000 + 31 * 1000).toLocaleString()} MATCHES${from} · ${ms}ms`);
  $('#mcSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- matchday (drama) mode ----------

function feedItem({ homeId, awayId, hg, ag, winner, pens, et, tag, suspense }) {
  const h = team(homeId), a = team(awayId);
  const div = document.createElement('div');
  div.className = 'feed-match';
  const scoreTxt = suspense ? '· — ·'
    : `${hg}–${ag}${pens ? ` <span style="font-size:9px">(${pens.h}–${pens.a}p)</span>` : et ? ' aet' : ''}`;
  div.innerHTML = `
    <span class="fm-team home ${!suspense && winner === homeId ? 'win' : ''}">${h.name} ${h.flag}</span>
    <span class="fm-score ${suspense ? 'suspense pulsing' : ''}">${scoreTxt}</span>
    <span class="fm-team ${!suspense && winner === awayId ? 'win' : ''}">${a.flag} ${a.name}</span>
    ${tag ? `<span class="fm-tag">${tag}</span>` : ''}`;
  return div;
}

function isUpset(m) {
  const w = team(m.winner), l = team(m.loser);
  return l.elo - w.elo >= 80;
}

function mdState() { return state.matchday; }

function mdBracketOpts(extra = {}) {
  const md = mdState();
  return { groupsDone: md.groupsDone, revealed: md.revealed, interactive: md.phase === 'knockout', ...extra };
}

async function startMatchday() {
  state.token++;
  const myToken = state.token;
  state.sim = null;
  hideTip();
  state.matchday = {
    sim: simulateTournament(WC_DATA, state.known || undefined),
    revealed: new Set(),
    groupsDone: false,
    phase: 'groups',
    busy: false,
  };
  renderThirds(null);
  renderFlow(null);
  renderBracket(null);
  $('#matchdayStage').classList.add('active');
  $('#matchdayStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#stageTitle').textContent = ROUND_LABELS.groups;
  $('#nextRoundBtn').textContent = 'GROUP STAGE IN PROGRESS …';
  $('#nextRoundBtn').disabled = true;
  $('#upsetFlash').textContent = '';
  setNote(state.known ? `MATCHDAY MODE · CONTINUING FROM ${knownCount()} REAL RESULT${knownCount() === 1 ? '' : 'S'}` : 'MATCHDAY MODE · GROUP STAGE IN PROGRESS');

  const md = mdState();
  const alive = () => state.token === myToken && mdState() === md;

  // reveal games into the group cards matchday-by-matchday (no side list).
  // real results are already "played", so show them straight away.
  const revealed = new Set();
  for (const g of Object.keys(GROUPS)) {
    for (const m of md.sim.groupResults[g].matches) {
      if (m.real || m.live) revealed.add(pairKey(m.home, m.away));
    }
  }
  renderGroups(md.sim, revealed);
  $('#groupsGrid').scrollIntoView({ behavior: 'smooth', block: 'start' });

  for (let mdNo = 1; mdNo <= 3; mdNo++) {
    await sleep(document.hidden ? 0 : 560);
    if (!alive()) return;
    for (const g of Object.keys(GROUPS)) {
      for (const fx of GROUP_FIXTURES[g]) {
        if (fx.md === mdNo) revealed.add(pairKey(fx.a, fx.b));
      }
    }
    $('#stageTitle').textContent = `GROUP STAGE · MATCHDAY ${mdNo} OF 3`;
    renderGroups(md.sim, revealed);
  }
  if (!alive()) return;

  md.groupsDone = true;
  md.phase = 'knockout';
  // pre-reveal any knockout matches already decided in reality (lock, not clickable)
  for (const id of ALL_MATCH_IDS) {
    const km = matchById(md.sim, id);
    if (km && km.real) md.revealed.add(id);
  }
  renderThirds(md.sim);
  renderFlow(md.sim);
  renderBracket(md.sim, mdBracketOpts());
  $('#stageTitle').textContent = 'KNOCKOUT — CLICK A FIXTURE TO PLAY IT';
  $('#upsetFlash').textContent = 'GROUPS COMPLETE — 32 TEAMS PLACED. EVERY FIXTURE IS NOW IN YOUR HANDS.';
  $('#nextRoundBtn').textContent = 'OPEN THE KNOCKOUT SHEET ▸';
  $('#nextRoundBtn').disabled = false;
  setNote('MATCHDAY MODE · KNOCKOUT — CLICK FIXTURES TO PLAY THEM');
}

async function playMatch(id) {
  const md = mdState();
  if (!md || (md.phase !== 'knockout' && md.phase !== 'done') || md.busy || md.revealed.has(id)) return;
  const m = matchById(md.sim, id);
  if (!m) return;
  state.token++;
  const myToken = state.token;
  md.busy = true;
  hideTip();

  renderBracket(md.sim, mdBracketOpts({ live: id }));
  const isFinal = id === '104';
  await sleep(isFinal ? 1800 : 850);
  if (state.token !== myToken || mdState() !== md) return;

  md.revealed.add(id);
  md.busy = false;
  renderBracket(md.sim, mdBracketOpts());

  const isUp = isUpset(m);
  if (isUp) {
    const w = team(m.winner), l = team(m.loser);
    $('#upsetFlash').textContent = `UPSET — ${w.name.toUpperCase()} ELIMINATE ${l.name.toUpperCase()}`;
  }

  if (isFinal) {
    md.phase = 'done';
    state.sim = md.sim;
    const champ = team(md.sim.champion);
    $('#upsetFlash').textContent = `${champ.flag} ${champ.name.toUpperCase()} ARE WORLD CHAMPIONS`;
    $('#stageTitle').textContent = ROUND_LABELS.final;
    setNote(`FULL TIME · CHAMPION <span class="live">${champ.name.toUpperCase()} ${champ.flag}</span>`);
    $('#nextRoundBtn').textContent = 'RUN IT BACK ⟲';
    $('#nextRoundBtn').disabled = false;
    renderBracket(md.sim, mdBracketOpts({ interactive: true }));
  }
}

function skipMatchday() {
  const md = mdState();
  if (!md) return;
  state.token++;
  state.sim = md.sim;
  state.matchday = null;
  hideTip();
  $('#matchdayStage').classList.remove('active');
  renderGroups(state.sim);
  renderThirds(state.sim);
  renderFlow(state.sim);
  renderBracket(state.sim);
  const champ = team(state.sim.champion);
  setNote(`SKIPPED TO FULL TIME · CHAMPION <span class="live">${champ.name.toUpperCase()} ${champ.flag}</span>`);
}

// ============================================================
//  LIVE MODE — ingest real results, continue the simulation
// ============================================================

// real partial standings from finished group results only
function realGroupStandings(known) {
  const res = {};
  for (const g of Object.keys(GROUPS)) {
    const ids = GROUPS[g];
    const stats = {};
    ids.forEach(id => { stats[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }; });
    const matches = [];
    let played = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const kf = known.groups[pairKey(ids[i], ids[j])];
        if (!kf) continue;
        const a = ids[i], b = ids[j];
        const ag = kf.home === a ? kf.hg : kf.ag;
        const bg = kf.home === a ? kf.ag : kf.hg;
        applyResult(stats[a], ag, bg);
        applyResult(stats[b], bg, ag);
        matches.push({ home: a, away: b, hg: ag, ag: bg });
        played++;
      }
    }
    res[g] = { table: rankGroup(Object.values(stats), matches), played };
  }
  return res;
}

function renderGroupsLive(standings) {
  state.groupsView = { sim: null, live: standings };
  ensureQualOdds();
  const grid = $('#groupsGrid');
  grid.innerHTML = '';
  for (const g of Object.keys(GROUPS)) {
    const gs = standings[g];
    const complete = gs.played === 6;
    const card = document.createElement('div');
    card.className = 'group-card' + (complete ? ' resolved' : '');
    let rows = '';
    gs.table.forEach((row, i) => {
      const t = team(row.id);
      const cls = gs.played > 0 ? (i === 0 ? 'row-q1' : i === 1 ? 'row-q2' : 'row-out') : '';
      rows += `<tr class="${cls}" data-team="${t.id}">
        <td class="team-cell"><span class="flag">${t.flag}</span>${t.name}</td>
        <td>${row.w}-${row.d}-${row.l}</td>
        <td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td>
        <td class="pts-cell">${row.pts}</td>
        ${koCell(t.id, cls === 'row-out')}
      </tr>`;
    });
    card.innerHTML = `
      <div class="group-head">
        <span class="group-letter">${g}</span>
        <span class="mono-micro">${complete ? 'FINAL' : 'LIVE · ' + gs.played + '/6'}</span>
      </div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>W-D-L</th><th>GD</th><th>Pts</th><th class="ko-th" title="Chance to reach the knockout round">KO%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    grid.appendChild(card);
  }
}

function renderLiveMeta(folded, sourceLabel) {
  $('#liveMeta').innerHTML = `
    <span>SOURCE <b>${sourceLabel}</b></span>
    <span>REAL RESULTS LOCKED <b>${folded.finished}</b></span>
    <span>IN PLAY <b>${folded.live}</b></span>
    <span>GROUP <b>${folded.groupFinished}/72</b></span>
    <span>KNOCKOUT <b>${folded.koFinished}/31</b></span>`;
}

function wireMatchCard(fx) {
  const h = team(fx.home), a = team(fx.away);
  const label = fx.stage === 'ko' ? 'M' + fx.matchNo : 'GRP ' + fx.groupKey;
  let statusTxt, cls;
  if (fx.status === 'LIVE') {
    statusTxt = `<span class="wm-min">● ${fx.minute}'</span>`;
    cls = 'live';
  } else {
    statusTxt = `<span>FT${fx.et ? ' · AET' : ''}${fx.pens ? ' · PENS' : ''}</span>`;
    cls = 'finished';
  }
  const evs = (fx.events || []).filter(e => e.type === 'red');
  const evTxt = evs.length ? `<span class="wm-events">🟥 ${evs.map(e => team(e.team).code + ' ' + e.minute + "'").join(', ')}</span>` : `<span class="wm-events"></span>`;
  const winH = fx.status === 'FINISHED' && (fx.winner ? fx.winner === fx.home : fx.hg > fx.ag);
  const winA = fx.status === 'FINISHED' && (fx.winner ? fx.winner === fx.away : fx.ag > fx.hg);
  return `<div class="wire-match ${cls}">
    <span class="wm-team ${winH ? 'win' : ''}"><span class="flag">${h.flag}</span>${h.name}</span>
    <span class="wm-score">${fx.hg}</span>
    <span class="wm-team ${winA ? 'win' : ''}"><span class="flag">${a.flag}</span>${a.name}</span>
    <span class="wm-score">${fx.ag}</span>
    <span class="wm-status">${statusTxt}<span>${label}</span>${evTxt}</span>
  </div>`;
}

function renderLiveWire(snapshot) {
  const live = snapshot.filter(f => f.status === 'LIVE');
  const finished = snapshot.filter(f => f.status === 'FINISHED');
  const sched = snapshot.filter(f => f.status === 'SCHEDULED').length;
  const recent = finished.slice(-9).reverse();
  let html = live.map(wireMatchCard).join('') + recent.map(wireMatchCard).join('');
  if (!html) html = `<p class="footnote" style="margin:0">Waiting for kickoff…</p>`;
  if (sched) html += `<div class="wire-match finished" style="opacity:.5"><span class="wm-team">… ${sched} fixtures still to come</span><span></span><span></span><span></span></div>`;
  $('#liveWire').innerHTML = html;
}

function applyLiveSnapshot(snapshot, sourceLabel) {
  const folded = buildKnown(snapshot);
  state.known = folded.known;
  renderLiveWire(snapshot);
  renderLiveMeta(folded, sourceLabel);

  renderGroupsLive(realGroupStandings(folded.known));
  renderThirds(null);

  // odds conditioned on everything real so far (incl. in-play scorelines)
  state.mc = monteCarlo(WC_DATA, 700, null, folded.known);
  state.mcContext = `LIVE · ${folded.finished} REAL RESULTS${folded.live ? ' · ' + folded.live + ' IN PLAY' : ''}`;
  renderMC();

  // projection of flow + bracket — only re-sample when a match finishes
  const sig = folded.groupFinished + ':' + folded.koFinished;
  if (sig !== (state.live && state.live.lastSig)) {
    if (folded.groupFinished === 72) {
      const proj = simulateTournament(WC_DATA, folded.known);
      renderFlow(proj);
      renderBracket(proj);
    } else {
      renderFlow(null);
      renderBracket(null);
    }
    if (state.live) state.live.lastSig = sig;
  }
}

function liveSourceLabel() {
  const s = state.live && state.live.feed && state.live.feed.lastSource;
  if (s === 'fifa') return 'LIVE · api.fifa.com (official, no key)';
  if (s === 'wc26ir') return 'LIVE · worldcup26.ir (fallback)';
  return 'LIVE API';
}

function knownCount() {
  if (!state.known) return 0;
  return Object.keys(state.known.groups).length + Object.keys(state.known.ko).length;
}

// One-shot pull of the current real results. Sets state.known, which
// every other mode (Run Once, Matchday, ×1000, Team Focus) then uses.
async function pullLive() {
  if (!state.live) return;
  $('#liveRefresh').disabled = true;
  $('#liveRefresh').textContent = 'FETCHING…';
  try {
    const snap = await state.live.feed.snapshot();
    applyLiveSnapshot(snap, liveSourceLabel());
    const f = buildKnown(snap);
    const note = f.finished + f.live === 0
      ? '● LIVE DATA SYNCED · NO MATCHES PLAYED YET · RUN ANY MODE TO PROJECT'
      : `● LIVE DATA SYNCED · ${f.finished} RESULT${f.finished === 1 ? '' : 'S'}${f.live ? ' · ' + f.live + ' IN PLAY' : ''} · EVERY MODE NOW USES THIS DATA`;
    setNote(note);
  } catch (e) {
    $('#liveMeta').innerHTML = `<span style="color:var(--color-peri)">LIVE API ERROR — ${String(e.message || e)}. The proxy tries api.fifa.com then worldcup26.ir.</span>`;
    setNote('LIVE MODE · FETCH FAILED — SEE PANEL');
  }
  $('#liveRefresh').disabled = false;
  $('#liveRefresh').textContent = '↻ REFRESH';
}

function startLiveMode() {
  state.token++;
  state.matchday = null;
  hideTip();
  $('#matchdayStage').classList.remove('active');
  $('#liveStage').classList.add('active');
  $('#liveStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  state.live = { feed: makeRealFeed(WC_DATA), lastSig: null };
  $('#liveMeta').innerHTML = '<span>Fetching current results from api.fifa.com…</span>';
  $('#liveWire').innerHTML = '<p class="footnote" style="margin:0">Loading live results…</p>';
  pullLive();
}

// ============================================================
//  TEAM FOCUS — who will they play?
// ============================================================

function h2hOdds(aId, bId) {
  // group fixtures: hosts carry home advantage, matching the simulation
  const [la, lb] = goalLambdas(effElo(team(aId), true), effElo(team(bId), true));
  return outcomeProbs(la, lb); // [win, draw, loss] for team a
}

function barRow(labelHtml, p, dim) {
  return `<div class="prob-row ${dim ? 'dim' : ''}">
    <span class="pr-label">${labelHtml}</span>
    <span class="pr-track"><span class="pr-fill" style="width:${Math.min(100, p * 100)}%"></span></span>
    <span class="pr-val">${p > 0 && p < 0.001 ? '<0.1' : (p * 100).toFixed(p >= 0.1 ? 0 : 1)}%</span>
  </div>`;
}

function populateFocusTeams() {
  const sel = $('#focusTeam');
  const ids = Object.keys(TEAMS).sort((a, b) => team(b).elo - team(a).elo);
  sel.innerHTML = ids.map(id => `<option value="${id}">${team(id).flag} ${team(id).name} · ${groupOf(id)}</option>`).join('');
  sel.value = 'ARG';
}

function runFocus() {
  const teamId = $('#focusTeam').value;
  const n = Number($('#focusRuns').value);
  $('#focusRun').disabled = true;
  $('#focusRun').textContent = 'RUNNING…';
  // let the button repaint before the synchronous run
  setTimeout(() => {
    const t0 = performance.now();
    const res = teamFocusMonteCarlo(WC_DATA, teamId, n, state.known || undefined);
    state.focus = res;
    renderFocus(res, teamId, Math.round(performance.now() - t0));
    $('#focusRun').disabled = false;
    $('#focusRun').textContent = 'RUN ▸';
  }, 20);
}

function renderFocus(res, teamId, ms) {
  const t = team(teamId);
  const g = groupOf(teamId);
  const n = res.n;
  const opps = GROUPS[g].filter(id => id !== teamId);

  // group opponents with single-match H2H odds
  let h2h = '';
  for (const oId of opps) {
    const [w, d, l] = h2hOdds(teamId, oId);
    const o = team(oId);
    h2h += `<div class="h2h-row">
      <div class="h2h-name"><span class="flag">${o.flag}</span>${o.name} <span class="mono-micro" style="color:#4d4d4d">${o.elo}</span></div>
      <div class="h2h-bar"><span class="win" style="width:${w * 100}%"></span><span class="draw" style="width:${d * 100}%"></span><span class="loss" style="width:${l * 100}%"></span></div>
      <div class="h2h-pct"><span>W ${(w * 100).toFixed(0)}%</span><span>D ${(d * 100).toFixed(0)}%</span><span>L ${(l * 100).toFixed(0)}%</span></div>
    </div>`;
  }

  // group finish distribution
  const gf = res.groupFinish;
  const finishRows = [1, 2, 3, 4].map(pos =>
    barRow(`Finish ${pos}${['st', 'nd', 'rd', 'th'][pos - 1]}`, gf[pos] / n)).join('');
  const advance = res.reach.r32 / n;

  // advancement odds
  const reachRows = [
    ['Reach R32', res.reach.r32], ['Reach R16', res.reach.r16], ['Reach QF', res.reach.qf],
    ['Reach SF', res.reach.sf], ['Reach Final', res.reach.final], ['Win the Cup', res.reach.champion],
  ].map(([lbl, c]) => barRow(`<span class="${lbl === 'Win the Cup' ? 'tip-strong' : ''}">${lbl}</span>`, c / n)).join('');

  // knockout opponent distributions
  const ROUND_NAME = { r32: 'ROUND OF 32', r16: 'ROUND OF 16', qf: 'QUARTER-FINAL', sf: 'SEMI-FINAL', final: 'FINAL' };
  let oppBlocks = '';
  for (const round of ['r32', 'r16', 'qf', 'sf', 'final']) {
    const reach = res.reach[round];
    if (!reach) continue;
    const entries = Object.entries(res.opp[round]).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const rows = entries.map(([oId, c]) =>
      barRow(`<span class="flag">${team(oId).flag}</span>${team(oId).name}`, c / reach)).join('');
    oppBlocks += `<div class="focus-round-block">
      <div class="frb-head"><span>${ROUND_NAME[round]} OPPONENT</span><span class="reach">reach ${(100 * reach / n).toFixed(0)}%</span></div>
      ${rows || '<p class="footnote" style="margin:0">—</p>'}
    </div>`;
  }

  $('#focusOut').innerHTML = `
    <div class="focus-hero">
      <span class="fh-flag">${t.flag}</span>
      <div>
        <div class="fh-name">${t.name}</div>
        <div class="fh-meta">GROUP ${g} · RATING ${t.elo} · ${n.toLocaleString()} SIMULATIONS${state.known ? ' · CONDITIONED ON LIVE RESULTS' : ''} · ${ms}ms</div>
      </div>
    </div>
    <div class="focus-grid">
      <div class="focus-panel">
        <h4>Confirmed group opponents · single-match odds</h4>
        ${h2h}
        <h4 style="margin-top:16px">Group finish · advance ${(advance * 100).toFixed(0)}%</h4>
        ${finishRows}
      </div>
      <div class="focus-panel">
        <h4>How far do they go?</h4>
        ${reachRows}
      </div>
      <div class="focus-panel">
        <h4>Who do they meet? · conditional on reaching</h4>
        ${oppBlocks}
      </div>
    </div>`;
}

// ---------- collapsible sections ----------
// Click a section's heading (or a stage's title) to fold its body away.
function initCollapsibles() {
  const make = (section, titleEl) => {
    if (!section || !titleEl) return;
    section.classList.add('collapsible');
    titleEl.classList.add('collapse-toggle');
    titleEl.insertAdjacentHTML('afterbegin', '<span class="chev">▾</span>');
    titleEl.addEventListener('click', () => section.classList.toggle('collapsed'));
  };
  $$('.dashed-section').forEach(sec => make(sec, sec.querySelector('.heading')));
  // stages: hook the static eyebrow label (the title text is rewritten by JS)
  make($('#liveStage'), $('#liveStage .live-head .mono-micro'));
  make($('#matchdayStage'), $('#matchdayStage .matchday-head .mono-micro'));
}

// ---------- wiring ----------

document.addEventListener('DOMContentLoaded', () => {
  initCollapsibles();
  $('#btnOnce').addEventListener('click', runOnce);
  $('#btnThousand').addEventListener('click', runThousand);
  $('#btnMatchday').addEventListener('click', startMatchday);
  $('#btnReset').addEventListener('click', resetAll);

  // real data is always on — manual re-pull on demand
  $('#btnRefresh').addEventListener('click', () => refreshRealData(true));

  // team focus
  populateFocusTeams();
  $('#btnFocus').addEventListener('click', () => $('#focusSection').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#focusRun').addEventListener('click', runFocus);
  $('#nextRoundBtn').addEventListener('click', () => {
    const md = mdState();
    if (!md) return;
    if (md.phase === 'done') startMatchday();
    else if (md.phase === 'knockout') $('#bracketSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#skipBtn').addEventListener('click', skipMatchday);

  // tooltips: group rows, single games, and third chips
  bindTip($('#groupsGrid'), 'tr[data-team]', el => groupRowTip(el.dataset.team));
  bindTip($('#groupsGrid'), '.gg[data-ga]', el => groupGameTip(el.dataset.ga, el.dataset.gb));
  bindTip($('#thirdsStrip'), '.third-chip[data-team]', el => groupRowTip(el.dataset.team));

  // best-thirds view toggle (projected % ⇄ current placement)
  $('#thirdsStrip').addEventListener('click', ev => {
    const b = ev.target.closest('[data-tview]');
    if (b) { state.thirdsView = b.dataset.tview; renderThirds(); }
  });

  // flow map: tooltip + match highlighting
  const flowWrap = $('#flowWrap');
  bindTip(flowWrap, '[data-hover]', el => state.flowView ? flowTip(el.dataset.m) : null);
  flowWrap.addEventListener('mouseover', ev => {
    const el = ev.target.closest('[data-hover]');
    if (el && flowWrap.contains(el)) setFlowFocus(el.dataset.m);
  });
  flowWrap.addEventListener('mouseout', ev => {
    const el = ev.target.closest('[data-hover]');
    if (el && !(ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('[data-hover]') === el)) {
      clearFlowFocus();
    }
  });

  // bracket: tooltip + click-to-play (matchday) — bound to the wrap so
  // both the desktop wallchart and the mobile stacked rounds are covered
  const bracketWrap = $('#bracketWrap');
  bindTip(bracketWrap, '.match-box[data-mid]', el => bracketTip(el.dataset.mid));
  bracketWrap.addEventListener('click', ev => {
    const el = ev.target.closest('.match-box.clickable');
    if (el && bracketWrap.contains(el)) playMatch(el.dataset.mid);
  });

  // knockout view mode toggle: MATCHDAY (scores) ⇄ PREDICTIVE (likelihoods)
  $('#koModeToggle').addEventListener('click', ev => {
    const btn = ev.target.closest('.ko-mode-btn');
    if (btn) setKoMode(btn.dataset.komode);
  });

  // keep the connector tree aligned when the viewport changes
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(drawBracketLines, 120);
  }, { passive: true });

  // touch: dismiss the bottom-sheet tooltip on scroll or tap-away
  const dismissSheet = ev => {
    if (!tipEl.classList.contains('mobile-sheet') || tipEl.style.display !== 'block') return;
    if (ev.type === 'scroll') { hideTip(); clearFlowFocus(); return; }
    const t = ev.target;
    const onInteractive = t && typeof t.closest === 'function' && t.closest('[data-team],[data-hover],[data-mid],[data-ga]');
    if (!onInteractive) { hideTip(); clearFlowFocus(); }
  };
  window.addEventListener('scroll', dismissSheet, { passive: true });
  document.addEventListener('touchstart', dismissSheet, { passive: true });

  resetAll();
  // real data is always on: pull it on load, then refresh the sheet
  refreshRealData(false);
});
