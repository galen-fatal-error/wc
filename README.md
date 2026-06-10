# WC26 Bracket Lab

An interactive FIFA World Cup 2026 tournament simulator — part accurate simulation, part entertainment. Live at [wc.galen.ca](https://wc.galen.ca).

Built on the schedule FIFA actually published: the real 12 groups (including the March 2026 playoff winners), the real round-of-32 bracket paths (matches 73–104), and FIFA's third-place allocation constraints, with match outcomes sampled from Poisson goal distributions tilted by FIFA ranking difference.

## Modes

- **Run Once** — simulate the full tournament instantly: group tables, best-thirds ranking, placement flow into the round of 32, and the knockout wallchart through to the final at MetLife.
- **Matchday Mode** — the group stage streams in match by match, then every knockout fixture is yours to click. Hover for pre-match odds; play a fixture to reveal the score, red cards, and kick-by-kick shootouts.
- **Run ×1000** — Monte Carlo over 1000 full tournaments, producing a sortable odds table (win group / reach each round / champion) per team.

## Running locally

Static site, no build step:

```sh
python3 -m http.server 8741
# open http://localhost:8741
```

## Files

- `data.js` — teams, ratings, groups, and the official bracket mapping
- `engine.js` — match model, group tiebreakers, thirds allocation solver, Monte Carlo
- `app.js` — rendering, tooltips, matchday mode
- `index.html` / `styles.css` — shell and the blueprint design system

Ratings are the April 2026 FIFA World Ranking order with point totals approximated where unpublished. No wagering advice on this sheet.
