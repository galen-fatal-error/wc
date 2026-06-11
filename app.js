/* ============================================================
   WC26 BRACKET LAB — UI layer
   Renders groups, placement flow, wallchart bracket, Monte
   Carlo odds, the paced "matchday mode", and the cursor
   tooltip layer (ranking data, pairing rules, match odds).
   ============================================================ */

'use strict';

const $ = sel => document.querySelector(sel);
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

// ---------- group stage ----------

function renderGroups(sim, resolvedGroups) {
  state.groupsView = { sim, resolved: resolvedGroups || null };
  const grid = $('#groupsGrid');
  grid.innerHTML = '';
  for (const g of Object.keys(GROUPS)) {
    const card = document.createElement('div');
    card.className = 'group-card';
    const done = sim && (!resolvedGroups || resolvedGroups.has(g));
    if (done) card.classList.add('resolved');

    let rowsHtml = '';
    if (done) {
      const res = sim.groupResults[g];
      const thirdQualified = sim.qualifiedThirds.some(t => t.group === g);
      res.table.forEach((row, i) => {
        const t = team(row.id);
        const cls = i === 0 ? 'row-q1' : i === 1 ? 'row-q2'
          : (i === 2 && thirdQualified) ? 'row-q3-in' : 'row-out';
        rowsHtml += `<tr class="${cls}" data-team="${t.id}">
          <td class="team-cell"><span class="flag">${t.flag}</span>${t.name}</td>
          <td>${row.w}-${row.d}-${row.l}</td>
          <td>${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</td>
          <td class="pts-cell">${row.pts}</td>
        </tr>`;
      });
    } else {
      GROUPS[g].forEach(id => {
        const t = team(id);
        rowsHtml += `<tr data-team="${t.id}">
          <td class="team-cell"><span class="flag">${t.flag}</span>${t.name}</td>
          <td>0-0-0</td><td>0</td><td class="pts-cell">0</td>
        </tr>`;
      });
    }

    card.innerHTML = `
      <div class="group-head">
        <span class="group-letter">${g}</span>
        <span class="mono-micro">${done ? 'FINAL' : 'GRP · 0/6 PLAYED'}</span>
      </div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>W-D-L</th><th>GD</th><th>Pts</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
    grid.appendChild(card);
  }
}

function groupRowTip(teamId) {
  const t = team(teamId);
  const g = groupOf(teamId);
  const view = state.groupsView || {};
  const sim = view.sim;
  const done = sim && (!view.resolved || view.resolved.has(g));

  let html = `<span class="tip-head">${t.flag} ${t.name} · GROUP ${g}</span>`;

  // live mode: show real partial standings
  if (view.live) {
    const gs = view.live[g];
    const row = gs.table.find(r => r.id === teamId);
    const pos = gs.table.findIndex(r => r.id === teamId) + 1;
    html += `<span class="tip-row tip-mono">PTS <span class="tip-strong">${row.pts}</span> ·
      W${row.w} D${row.d} L${row.l} · GD <span class="tip-strong">${row.gf - row.ga > 0 ? '+' : ''}${row.gf - row.ga}</span>
      · ${row.p} of 3 played</span>
      <span class="tip-row">Provisional <span class="tip-strong">${pos}${['st','nd','rd','th'][pos - 1]}</span> in Group ${g}
      ${gs.played < 6 ? '— group still in progress' : '— group complete'}.</span>
      <span class="tip-rule">Live standings from real results. Top two qualify; ranking by points → GD → goals → head-to-head.</span>`;
    return html;
  }
  if (!done) {
    html += `<span class="tip-row">FIFA rating <span class="tip-strong">${t.elo}</span> — drives every simulated result.</span>
      <span class="tip-rule">Group ranking order (FIFA Art. 13): points → goal difference → goals scored →
      head-to-head → fair play → drawing of lots.</span>`;
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

function renderThirds(sim) {
  const strip = $('#thirdsStrip');
  if (!sim) {
    strip.innerHTML = `<span class="mono-label">Best thirds · ranking of all 12 third-placed teams — top 8 advance</span>
      <div class="thirds-row"><span class="third-chip">awaiting simulation</span></div>`;
    return;
  }
  let chips = '';
  sim.thirdsRanked.forEach((row, i) => {
    const t = team(row.id);
    const q = i < 8;
    chips += `<span class="third-chip ${q ? 'qualified' : ''}" data-team="${t.id}">
      <span class="rank-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="flag">${t.flag}</span>3${row.group} ${t.code} · ${row.pts}pt
    </span>`;
  });
  strip.innerHTML = `<span class="mono-label">Best thirds · top 8 of 12 advance <span style="color:var(--color-peri)">▸ qualified</span></span>
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

// opts: { groupsDone, revealed:Set, live:matchId, interactive:bool }
// omit opts entirely with a sim for a full reveal.
function renderBracket(sim, opts = {}) {
  let revealed = opts.revealed;
  if (!revealed) revealed = sim ? new Set(ALL_MATCH_IDS) : new Set();
  const groupsDone = sim ? (opts.groupsDone !== undefined ? opts.groupsDone : true) : false;
  const interactive = !!opts.interactive;
  const liveId = opts.live;

  state.bracketView = { sim, revealed, groupsDone, interactive };

  const refKnown = ref => {
    const [kind, key] = ref.split(':');
    if (kind === 'M' || kind === 'L') return revealed.has(key);
    return groupsDone;
  };

  function slotHtml(ref, m, side) {
    let name = `<span class="slot-origin">${originLabel(ref)}</span>`;
    let score = '', cls = '', pen = '';
    if (sim && m && refKnown(ref)) {
      const tid = side === 'home' ? m.home : m.away;
      const t = team(tid);
      name = `<span class="flag">${t.flag}</span><span class="slot-name">${t.name}</span>`;
      if (revealed.has(m.match)) {
        const g = side === 'home' ? m.hg : m.ag;
        score = `<span class="slot-score">${g}</span>`;
        const won = m.winner === tid;
        cls = won ? 'winner' : 'loser';
        if (m.pens) pen = `<span class="pen-note">${side === 'home' ? m.pens.h : m.pens.a}p</span>`;
      }
    }
    return `<div class="match-slot ${cls}">${name}${pen}${score}</div>`;
  }

  function matchBox(id) {
    const spec = SPEC_BY_ID[id];
    const m = matchById(sim, id);
    const played = revealed.has(id);
    const live = liveId === id;
    const realLock = played && m && m.real;
    const liveReal = m && m.live;
    const clickable = interactive && !played && !live && m && refKnown(spec.home) && refKnown(spec.away);
    return `<div class="match-box ${played ? 'match-played' : ''} ${live ? 'match-live pulsing' : ''} ${realLock ? 'real-locked' : ''} ${liveReal ? 'live-real' : ''} ${clickable ? 'clickable' : ''}" data-mid="${id}">
      <span class="match-no">M${id}${m && m.et && played ? ' · AET' : ''}</span>
      ${slotHtml(spec.home, m, 'home')}
      ${slotHtml(spec.away, m, 'away')}
    </div>`;
  }

  function column(ids, title, count, roundKey) {
    const liveRound = liveId && ROUND_OF[liveId] === roundKey;
    return `<div class="bracket-round ${liveRound ? 'round-live' : ''}">
      <div class="round-title">${title} <span class="round-count">· ${count}</span></div>
      ${ids.map(matchBox).join('')}
    </div>`;
  }

  const L = BRACKET_LAYOUT.left, R = BRACKET_LAYOUT.right;
  const finalM = matchById(sim, '104');
  const champ = sim && revealed.has('104') ? team(finalM.winner) : null;

  const centerCol = `<div class="bracket-round" style="justify-content:center; gap:14px;">
    <div class="round-title">FINAL <span class="round-count">· JUL 19 · NY/NJ</span></div>
    ${matchBox('104')}
    <div class="champion-plate">
      <span class="champ-flag">${champ ? champ.flag : '◌'}</span>
      <div class="mono-micro">WORLD CHAMPIONS</div>
      <div class="champ-name">${champ ? champ.name : '—'}</div>
    </div>
    <div class="round-title" style="padding-top:10px">BRONZE <span class="round-count">· M103</span></div>
    ${matchBox('103')}
  </div>`;

  $('#bracket').innerHTML =
    column(L.r32, 'R32', 'L1', 'r32') +
    column(L.r16, 'R16', 'L2', 'r16') +
    column(L.qf, 'QF', 'L3', 'qf') +
    column(L.sf, 'SF', 'M101', 'sf') +
    centerCol +
    column(R.sf, 'SF', 'M102', 'sf') +
    column(R.qf, 'QF', 'R3', 'qf') +
    column(R.r16, 'R16', 'R2', 'r16') +
    column(R.r32, 'R32', 'R1', 'r32');

  // mobile: round-stacked vertical layout (same match boxes, so the
  // delegated tooltip + click-to-play handlers cover both renderings)
  const champPlate = `<div class="champion-plate">
    <span class="champ-flag">${champ ? champ.flag : '◌'}</span>
    <div class="mono-micro">WORLD CHAMPIONS</div>
    <div class="champ-name">${champ ? champ.name : '—'}</div>
  </div>`;
  const stackRound = (ids, title, key, sub) => {
    const liveRound = liveId && ROUND_OF[liveId] === key;
    return `<div class="stack-round ${liveRound ? 'round-live' : ''}">
      <div class="stack-round-head">${title} <span class="rc">${sub}</span></div>
      ${ids.map(matchBox).join('')}
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

function bracketTip(id) {
  const view = state.bracketView;
  if (!view) return null;
  const { sim, revealed, groupsDone, interactive } = view;
  const spec = SPEC_BY_ID[id];
  const m = matchById(sim, id);
  const refKnown = ref => {
    const [kind, key] = ref.split(':');
    if (kind === 'M' || kind === 'L') return revealed.has(key);
    return groupsDone;
  };

  let html = `<span class="tip-head">MATCH ${id} · ${ROUND_LABELS[ROUND_OF[id]]}</span>`;

  if (!sim || !m || !refKnown(spec.home) || !refKnown(spec.away)) {
    html += `<span class="tip-row"><span class="tip-strong">${originLabel(spec.home)}</span> v
      <span class="tip-strong">${originLabel(spec.away)}</span> — slots fill as earlier rounds resolve.</span>`;
    if (NEXT_MATCH[id]) html += `<span class="tip-rule">Winner advances to Match ${NEXT_MATCH[id].match}.</span>`;
    return html;
  }

  const h = team(m.home), a = team(m.away);
  const pH = koWinProb(h.elo, a.elo);
  const played = revealed.has(id);

  html += `<span class="tip-row"><span class="tip-strong">${h.flag} ${h.name}</span> v
    <span class="tip-strong">${a.name} ${a.flag}</span></span>
    <div class="tip-odds-bar"><span class="home-share" style="width:${pH * 100}%"></span><span class="away-share" style="flex:1"></span></div>
    <span class="tip-row tip-mono">${h.code} <span class="tip-strong">${pct(pH)}</span> · ${pct(1 - pH)} ${a.code}
      <span style="color:#4d4d4d">— pre-match odds (${h.elo} v ${a.elo})</span></span>`;

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
  if (state.live && state.live.timer) clearInterval(state.live.timer);
  state.live = null;
  state.known = null;
  state.mc = null;
  state.mcContext = '';
  hideTip();
  $('#matchdayStage').classList.remove('active');
  $('#liveStage').classList.remove('active');
  renderGroups(null);
  renderThirds(null);
  renderFlow(null);
  renderBracket(null);
  renderMC();
  setNote('SHEET CLEAR · KICK-OFF JUN 11 · ESTADIO AZTECA');
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
  renderGroups(null);
  renderThirds(null);
  renderFlow(null);
  renderBracket(null);
  $('#matchdayStage').classList.add('active');
  $('#matchdayStage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#stageTitle').textContent = ROUND_LABELS.groups;
  $('#nextRoundBtn').textContent = 'GROUP STAGE IN PROGRESS …';
  $('#nextRoundBtn').disabled = true;
  $('#feed').innerHTML = '';
  $('#upsetFlash').textContent = '';
  setNote(state.known ? `MATCHDAY MODE · CONTINUING FROM ${knownCount()} REAL RESULT${knownCount() === 1 ? '' : 'S'}` : 'MATCHDAY MODE · GROUP STAGE IN PROGRESS');
  await sleep(400);
  if (myToken !== state.token) return;

  const md = mdState();
  const alive = () => state.token === myToken && mdState() === md;

  const resolved = new Set();
  for (const g of Object.keys(GROUPS)) {
    for (const m of md.sim.groupResults[g].matches) {
      if (!alive()) return;
      const div = feedItem({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, winner: m.hg > m.ag ? m.home : m.hg < m.ag ? m.away : null });
      $('#feed').appendChild(div);
      requestAnimationFrame(() => div.classList.add('revealed'));
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      if (!document.hidden) await sleep(95); // skip the drip-feed if the tab is backgrounded
    }
    if (!alive()) return;
    resolved.add(g);
    renderGroups(md.sim, resolved);
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

  let tag = '';
  if (id === '103') tag = 'BRONZE';
  else if (isUpset(m)) tag = 'UPSET';
  else if (m.pens) tag = 'PENS';
  else if ((m.cards || []).length) tag = 'RED CARD';
  const div = feedItem({ homeId: m.home, awayId: m.away, hg: m.hg, ag: m.ag, winner: m.winner, pens: m.pens, et: m.et, tag: tag || null });
  div.classList.add('revealed');
  if (tag === 'UPSET') div.classList.add('upset');
  $('#feed').prepend(div);

  if (tag === 'UPSET') {
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
      </tr>`;
    });
    card.innerHTML = `
      <div class="group-head">
        <span class="group-letter">${g}</span>
        <span class="mono-micro">${complete ? 'FINAL' : 'LIVE · ' + gs.played + '/6'}</span>
      </div>
      <table class="group-table">
        <thead><tr><th>Team</th><th>W-D-L</th><th>GD</th><th>Pts</th></tr></thead>
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
  const [la, lb] = goalLambdas(team(aId).elo, team(bId).elo);
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

// ---------- wiring ----------

document.addEventListener('DOMContentLoaded', () => {
  $('#btnOnce').addEventListener('click', runOnce);
  $('#btnThousand').addEventListener('click', runThousand);
  $('#btnMatchday').addEventListener('click', startMatchday);
  $('#btnReset').addEventListener('click', resetAll);

  // live mode — one-shot pull of real results, then every mode uses it
  $('#btnLive').addEventListener('click', startLiveMode);
  $('#liveRefresh').addEventListener('click', pullLive);
  $('#liveClear').addEventListener('click', resetAll);

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

  // tooltips: group rows + third chips
  bindTip($('#groupsGrid'), 'tr[data-team]', el => groupRowTip(el.dataset.team));
  bindTip($('#thirdsStrip'), '.third-chip[data-team]', el => groupRowTip(el.dataset.team));

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

  // touch: dismiss the bottom-sheet tooltip on scroll or tap-away
  const dismissSheet = ev => {
    if (!tipEl.classList.contains('mobile-sheet') || tipEl.style.display !== 'block') return;
    if (ev.type === 'scroll') { hideTip(); clearFlowFocus(); return; }
    const t = ev.target;
    const onInteractive = t && typeof t.closest === 'function' && t.closest('[data-team],[data-hover],[data-mid]');
    if (!onInteractive) { hideTip(); clearFlowFocus(); }
  };
  window.addEventListener('scroll', dismissSheet, { passive: true });
  document.addEventListener('touchstart', dismissSheet, { passive: true });

  resetAll();
});
