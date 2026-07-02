# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page dashboard for AoFrio's office World Cup 2026 knockout sweepstakes, deployed on Vercel. It is a static `index.html` plus one serverless function (`api/data.js`) that pulls live results from KickoffAPI while keeping the API key server-side. There is **no build step, no tests, no linter, and no framework** — all app logic is hand-written vanilla JS inside `index.html`.

## Running / deploying

- **Local with live data:** `vercel dev` (serves `index.html` and runs `api/data.js` as a function). Requires `KICKOFF_API_KEY` in `.env` / `.env.local`.
- **Local without a server:** just open `index.html` in a browser. The `fetch("api/data")` fails silently and the page falls back to inline `window.WC_DATA` (if injected) or its built-in sample `MATCHES`.
- **Deploy:** push to the GitHub repo imported into Vercel; it auto-deploys. Framework preset is **Other** (static + function, no build).
- **Env vars** (set in Vercel -> Project -> Settings): `KICKOFF_API_KEY` (required); `KICKOFF_LEAGUE_ID` (optional override for auto-detection); `KICKOFF_SEASON` (defaults to 2026).

## Architecture

**Data flow:** browser loads `index.html` -> on load it `fetch`es `/api/data` -> the serverless function calls KickoffAPI, normalises the response into the `WC_DATA` shape (`{updatedAt, source, season, groups, matches}`), and returns JSON (edge-cached ~60s) -> the page overlays those results onto a hardcoded bracket and renders.

**The bracket is authoritative, the API only supplies scores.** `WC26_BRACKET` in `index.html` (matches `P73`-`P104`) is the official FIFA draw: R32 team pairings are fixed and later rounds carry `fa`/`fb` feeder links so winners propagate. `buildOfficialBracket()` matches live fixtures to bracket slots **by normalised team pair** (order-independent), so spurious or missing fixtures in the feed cannot corrupt the bracket structure. Winner propagation runs round-by-round via `winnerOf`/`loserOf` (the third-place match `P103` uses `losers:true`).

**Two data surfaces derived per render** (`applyRealData` in `index.html`): `MATCHES` (the bracket, for the visual) and `STAT_MATCHES` (flat list used for sweepstakes scoring / standings). `_renderAll()` runs `applyRealData -> renderGroups -> renderBracket -> renderStandings`.

## Gotchas when editing

- **`OWNERS` (country -> colleague name) is duplicated** in both `api/data.js` and `index.html`. Team roster / name-normalisation changes must be made in **both** files or scores and the bracket will disagree.
- **Name normalisation exists in two places too:** server-side `normalizeName`/`ALIASES`/`strip` in `api/data.js`, and client-side `_bnorm` in `index.html`. The bracket-to-fixture join depends on both producing matching keys, so keep alias handling consistent across them.
- **`index.html` is a generated copy** of `wc26-sweepstakes-dashboard.html`, which lives in the *parent* `WC26` folder (not in this repo). Per the README, the canonical dashboard is edited there and re-copied over `index.html`. Check whether an edit belongs upstream before changing `index.html` directly.
- **`api/data.js` reads across many response shapes** (KickoffAPI field names vary) via `pick(...)` fallbacks and best-effort standings parsing — preserve the fallback chains rather than assuming one shape.
- Knockout **round is inferred from fixture date** (`stageByDate`), not from the feed's stage label.
