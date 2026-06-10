/* ============================================================
   WC26 BRACKET LAB — simulation engine
   Pure logic, no DOM. Consumes data.js (TEAMS, GROUPS, BRACKET).
   ============================================================ */

'use strict';

// ---------- randomness ----------

function rng() { return Math.random(); }

// Poisson sample via Knuth
function poisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

// ---------- match model ----------
// FIFA-points difference -> expected score for team A. FIFA's own SUM
// ranking formula uses a 600-point logistic, so ratings plug in directly.
// Goals are sampled from Poisson distributions whose means are tilted
// by the elo gap around a base of ~1.25 goals/team (international avg
// is ~2.5 total). This produces realistic draw rates (~25%) in group
// play and sane scorelines, while preserving elo win probabilities.

function eloExpected(eloA, eloB) {
  return 1 / (1 + Math.pow(10, (eloB - eloA) / 600));
}

function goalLambdas(eloA, eloB) {
  const exp = eloExpected(eloA, eloB); // 0..1
  const totalGoals = 2.55;
  // tilt: strong favourites score more AND concede less
  const tilt = Math.pow(exp / (1 - exp), 0.62);
  const lamA = (totalGoals * tilt) / (1 + tilt);
  const lamB = totalGoals - lamA;
  return [Math.max(0.18, lamA), Math.max(0.18, lamB)];
}

// Simulate 90 minutes. Returns {a, b} goals.
function simGoals(eloA, eloB) {
  const [la, lb] = goalLambdas(eloA, eloB);
  return { a: poisson(la), b: poisson(lb) };
}

// Group match: draw allowed.
function simGroupMatch(teamA, teamB) {
  const g = simGoals(teamA.elo, teamB.elo);
  return { home: teamA.id, away: teamB.id, hg: g.a, ag: g.b };
}

// Knockout match: 90 minutes with possible red cards (which tilt the
// remaining scoring rates), then extra time, then penalties.
const RED_CARD_P = 0.05; // per team per knockout match

function redMinute() {
  // dismissals skew late
  return Math.round(15 + 75 * Math.pow(rng(), 0.55));
}

function simKnockoutMatch(teamA, teamB) {
  const [laBase, lbBase] = goalLambdas(teamA.elo, teamB.elo);
  let effA = laBase, effB = lbBase;
  const cards = [];
  if (rng() < RED_CARD_P) {
    const min = redMinute();
    cards.push({ team: teamA.id, minute: min });
    const rem = (90 - min) / 90;
    effA -= laBase * rem * 0.4;
    effB += lbBase * rem * 0.3;
  }
  if (rng() < RED_CARD_P) {
    const min = redMinute();
    cards.push({ team: teamB.id, minute: min });
    const rem = (90 - min) / 90;
    effB -= lbBase * rem * 0.4;
    effA += laBase * rem * 0.3;
  }
  cards.sort((x, y) => x.minute - y.minute);

  let hg = poisson(Math.max(0.1, effA));
  let ag = poisson(Math.max(0.1, effB));
  let et = false, pens = null;
  if (hg === ag) {
    et = true;
    // ET at a third of the match rate, carrying any red-card handicap
    hg += poisson(Math.max(0.05, effA / 3));
    ag += poisson(Math.max(0.05, effB / 3));
    if (hg === ag) {
      // shootout: slight edge to the rating favourite via per-kick prob
      const pA = 0.5 + (eloExpected(teamA.elo, teamB.elo) - 0.5) * 0.18;
      pens = simShootout(pA);
    }
  }
  const winnerId = pens
    ? (pens.aWins ? teamA.id : teamB.id)
    : (hg > ag ? teamA.id : teamB.id);
  return {
    home: teamA.id, away: teamB.id, hg, ag, et, cards,
    pens: pens ? { h: pens.aScore, a: pens.bScore, seqH: pens.seqA, seqA: pens.seqB } : null,
    winner: winnerId,
    loser: winnerId === teamA.id ? teamB.id : teamA.id,
  };
}

// Kick-by-kick best-of-five with early termination, then sudden death.
function simShootout(pA) {
  const pa = 0.75 + (pA - 0.5) * 0.3;
  const pb = 0.75 - (pA - 0.5) * 0.3;
  const seqA = [], seqB = [];
  let a = 0, b = 0, kA = 0, kB = 0;
  while (kA < 5 || kB < 5) {
    if (kA < 5) {
      const s = rng() < pa; seqA.push(s); if (s) a++; kA++;
      if (a > b + (5 - kB) || b > a + (5 - kA)) break;
    }
    if (kB < 5) {
      const s = rng() < pb; seqB.push(s); if (s) b++; kB++;
      if (a > b + (5 - kB) || b > a + (5 - kA)) break;
    }
  }
  while (a === b) {
    const sa = rng() < pa, sb = rng() < pb;
    seqA.push(sa); seqB.push(sb);
    if (sa) a++;
    if (sb) b++;
    if (seqA.length > 20) { if (rng() < pA) a++; else b++; break; }
  }
  return { aWins: a > b, aScore: a, bScore: b, seqA, seqB };
}

// ---------- analytic odds (for tooltips) ----------

function poissonPmf(lambda, kMax) {
  const arr = [];
  let p = Math.exp(-lambda);
  for (let k = 0; k <= kMax; k++) { arr.push(p); p *= lambda / (k + 1); }
  return arr;
}

function outcomeProbs(la, lb) {
  const A = poissonPmf(la, 12), B = poissonPmf(lb, 12);
  let w = 0, d = 0, l = 0;
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      const p = A[i] * B[j];
      if (i > j) w += p; else if (i === j) d += p; else l += p;
    }
  }
  const s = w + d + l;
  return [w / s, d / s, l / s];
}

// P(team A wins a knockout tie) incl. extra time and penalties.
function koWinProb(eloA, eloB) {
  const [la, lb] = goalLambdas(eloA, eloB);
  const [w90, d90] = outcomeProbs(la, lb);
  const [wET, dET] = outcomeProbs(la / 3, lb / 3);
  const pPens = 0.5 + (eloExpected(eloA, eloB) - 0.5) * 0.18;
  return w90 + d90 * (wET + dET * pPens);
}

// ---------- group stage ----------

// FIFA tiebreakers (within group): points, GD, GF, head-to-head points,
// head-to-head GD, head-to-head GF, then drawing of lots (random here;
// fair-play points are not modelled).
function simulateGroup(groupTeams) {
  const stats = {};
  for (const t of groupTeams) {
    stats[t.id] = { id: t.id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }
  const matches = [];
  for (let i = 0; i < groupTeams.length; i++) {
    for (let j = i + 1; j < groupTeams.length; j++) {
      const m = simGroupMatch(groupTeams[i], groupTeams[j]);
      matches.push(m);
      applyResult(stats[m.home], m.hg, m.ag);
      applyResult(stats[m.away], m.ag, m.hg);
    }
  }
  const table = rankGroup(Object.values(stats), matches);
  return { table, matches };
}

function applyResult(s, gf, ga) {
  s.p++; s.gf += gf; s.ga += ga;
  if (gf > ga) { s.w++; s.pts += 3; }
  else if (gf === ga) { s.d++; s.pts += 1; }
  else s.l++;
}

function rankGroup(rows, matches) {
  const cmp = (x, y) =>
    (y.pts - x.pts) ||
    ((y.gf - y.ga) - (x.gf - x.ga)) ||
    (y.gf - x.gf);
  rows.sort(cmp);
  // resolve full ties with head-to-head among tied teams, then random
  for (let i = 0; i < rows.length - 1; i++) {
    let j = i;
    while (j + 1 < rows.length && cmp(rows[i], rows[j + 1]) === 0) j++;
    if (j > i) {
      const tied = rows.slice(i, j + 1);
      const h2h = {};
      for (const r of tied) h2h[r.id] = { pts: 0, gd: 0, gf: 0, r: rng() };
      const ids = new Set(tied.map(r => r.id));
      for (const m of matches) {
        if (ids.has(m.home) && ids.has(m.away)) {
          const hs = h2h[m.home], as = h2h[m.away];
          hs.gd += m.hg - m.ag; as.gd += m.ag - m.hg;
          hs.gf += m.hg; as.gf += m.ag;
          if (m.hg > m.ag) hs.pts += 3;
          else if (m.hg < m.ag) as.pts += 3;
          else { hs.pts += 1; as.pts += 1; }
        }
      }
      tied.sort((x, y) => {
        const hx = h2h[x.id], hy = h2h[y.id];
        return (hy.pts - hx.pts) || (hy.gd - hx.gd) || (hy.gf - hx.gf) || (hy.r - hx.r);
      });
      rows.splice(i, tied.length, ...tied);
      i = j;
    }
  }
  return rows;
}

// Rank the 12 third-placed teams; top 8 advance.
// Criteria: points, GD, GF, then random (proxy for fair play / lots).
function rankThirds(groupResults) {
  const thirds = [];
  for (const g of Object.keys(groupResults)) {
    const row = groupResults[g].table[2];
    thirds.push({ ...row, group: g, r: rng() });
  }
  thirds.sort((x, y) =>
    (y.pts - x.pts) ||
    ((y.gf - y.ga) - (x.gf - x.ga)) ||
    (y.gf - x.gf) ||
    (y.r - x.r));
  return thirds;
}

// ---------- third-place allocation ----------
// BRACKET.thirdSlots: [{ match, allowed: ['A','B',...] }] — each R32 slot
// that hosts a third-placed team, with the groups it may draw from.
// Assign the 8 qualified thirds to slots via backtracking so every slot
// constraint is satisfied (FIFA's published allocation guarantees a
// perfect matching exists for every combination).
function allocateThirds(qualifiedThirds, thirdSlots) {
  const groups = qualifiedThirds.map(t => t.group);
  const byGroup = {};
  qualifiedThirds.forEach(t => { byGroup[t.group] = t; });

  // order slots by fewest options first (most constrained)
  const slots = thirdSlots.map(s => ({
    ...s,
    options: s.allowed.filter(g => groups.includes(g)),
  })).sort((a, b) => a.options.length - b.options.length);

  const assignment = {};
  const used = new Set();

  function backtrack(idx) {
    if (idx === slots.length) return true;
    const slot = slots[idx];
    for (const g of slot.options) {
      if (used.has(g)) continue;
      used.add(g);
      assignment[slot.match] = byGroup[g];
      if (backtrack(idx + 1)) return true;
      used.delete(g);
      delete assignment[slot.match];
    }
    return false;
  }

  if (!backtrack(0)) {
    // should not happen with FIFA's table; fall back to greedy any-order
    const remaining = [...qualifiedThirds];
    for (const slot of slots) {
      const pick = remaining.find(t => slot.options.includes(t.group)) || remaining[0];
      assignment[slot.match] = pick;
      remaining.splice(remaining.indexOf(pick), 1);
    }
  }
  return assignment; // matchId -> third-place team row
}

// ---------- full tournament ----------
// BRACKET = {
//   r32: [{ match, home: 'W:A'|'RU:B'|'T:<slotKey>', away: ... }],
//   thirdSlots: [{ match, allowed: [...] }],
//   r16: [{ match, home: 'M:73', away: 'M:74' }], qf, sf, final, third
// }

function resolveSlot(ref, ctx) {
  const [kind, key] = ref.split(':');
  if (kind === 'W') return ctx.winners1[key];
  if (kind === 'RU') return ctx.runners[key];
  if (kind === 'T') return ctx.thirdAssign[key]; // key is match id
  if (kind === 'M') return ctx.matchWinners[key];
  if (kind === 'L') return ctx.matchLosers[key];
  throw new Error('bad slot ref ' + ref);
}

function simulateTournament(data) {
  const { TEAMS, GROUPS, BRACKET } = data;
  const team = id => TEAMS[id];

  // group stage
  const groupResults = {};
  for (const g of Object.keys(GROUPS)) {
    groupResults[g] = simulateGroup(GROUPS[g].map(team));
  }

  const winners1 = {}, runners = {};
  for (const g of Object.keys(groupResults)) {
    winners1[g] = team(groupResults[g].table[0].id);
    runners[g] = team(groupResults[g].table[1].id);
  }

  const thirdsRanked = rankThirds(groupResults);
  const qualifiedThirds = thirdsRanked.slice(0, 8);
  const thirdAssignRows = allocateThirds(qualifiedThirds, BRACKET.thirdSlots);
  const thirdAssign = {};
  for (const m of Object.keys(thirdAssignRows)) {
    thirdAssign[m] = team(thirdAssignRows[m].id);
  }

  const ctx = { winners1, runners, thirdAssign, matchWinners: {}, matchLosers: {} };
  const rounds = { r32: [], r16: [], qf: [], sf: [], third: [], final: [] };

  for (const roundKey of ['r32', 'r16', 'qf', 'sf', 'third', 'final']) {
    for (const spec of BRACKET[roundKey]) {
      const a = resolveSlot(spec.home, ctx);
      const b = resolveSlot(spec.away, ctx);
      const m = simKnockoutMatch(a, b);
      m.match = spec.match;
      m.homeRef = spec.home;
      m.awayRef = spec.away;
      ctx.matchWinners[spec.match] = team(m.winner);
      ctx.matchLosers[spec.match] = team(m.loser);
      rounds[roundKey].push(m);
    }
  }

  return {
    groupResults,
    thirdsRanked,
    qualifiedThirds,
    thirdAssign,       // matchId -> team object
    rounds,
    champion: rounds.final[0].winner,
    runnerUp: rounds.final[0].loser,
  };
}

// ---------- monte carlo ----------

function monteCarlo(data, n, onProgress) {
  const tally = {};
  for (const id of Object.keys(data.TEAMS)) {
    tally[id] = { groupWin: 0, r32: 0, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 };
  }
  for (let i = 0; i < n; i++) {
    const sim = simulateTournament(data);
    for (const g of Object.keys(sim.groupResults)) {
      tally[sim.groupResults[g].table[0].id].groupWin++;
    }
    const seen = id => tally[id];
    for (const m of sim.rounds.r32) { seen(m.home).r32++; seen(m.away).r32++; }
    for (const m of sim.rounds.r16) { seen(m.home).r16++; seen(m.away).r16++; }
    for (const m of sim.rounds.qf)  { seen(m.home).qf++;  seen(m.away).qf++; }
    for (const m of sim.rounds.sf)  { seen(m.home).sf++;  seen(m.away).sf++; }
    const f = sim.rounds.final[0];
    seen(f.home).final++; seen(f.away).final++;
    tally[sim.champion].champion++;
    if (onProgress && (i + 1) % 50 === 0) onProgress(i + 1, n);
  }
  return { tally, n };
}
