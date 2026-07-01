# WC26 Sweepstakes Bracket — Vercel deploy

Live AoFrio World Cup 2026 office-sweepstakes knockout bracket. The page is a single
`index.html`; a small serverless function (`api/data.js`) pulls live results from
KickoffAPI (key kept server-side) so the deployed site stays current on its own.

## Repo layout

```
index.html          the dashboard (copy of wc26-sweepstakes-dashboard.html)
api/data.js          serverless endpoint → live WC_DATA from KickoffAPI
logos/aofrio/...      AoFrio logo
package.json
vercel.json
.gitignore
```

## 0. One-time: put the dashboard in as index.html

The `index.html` in this folder is a placeholder. Copy the real dashboard over it
(run from the parent `WC26` folder):

- Windows (PowerShell/CMD): `copy /Y wc26-sweepstakes-dashboard.html wc26-vercel\index.html`
- Mac/Linux: `cp wc26-sweepstakes-dashboard.html wc26-vercel/index.html`

Re-copy this whenever you change the dashboard.

## 1. Create the GitHub repo (under nicoscience) and push

```
cd wc26-vercel
git init
git add .
git commit -m "WC26 sweepstakes bracket"
git branch -M main
# create an empty repo at https://github.com/new (Owner: nicoscience, name: wc26-sweepstakes)
git remote add origin https://github.com/nicoscience/wc26-sweepstakes.git
git push -u origin main
```

(If you have the GitHub CLI: `gh repo create nicoscience/wc26-sweepstakes --public --source=. --push`.)

## 2. Import to Vercel

1. Go to https://vercel.com/new and import `nicoscience/wc26-sweepstakes`.
2. Framework preset: **Other** (it's a static site + serverless function — no build needed).
3. Before deploying, add an Environment Variable:
   - **Name:** `KICKOFF_API_KEY`  **Value:** your KickoffAPI key
   - (optional) `KICKOFF_LEAGUE_ID` if auto-detect ever picks the wrong competition, and `KICKOFF_SEASON` (defaults to 2026)
4. Deploy. Your dashboard is live at `https://wc26-sweepstakes.vercel.app` (or your custom domain).

## How live data works

- On load, the page calls `/api/data`. The function fetches KickoffAPI with your key,
  normalises team names, classifies knockout rounds by date, and returns the data as JSON.
- Results are edge-cached for ~60s, so many viewers won't blow your API quota.
- The **bracket structure is the official FIFA draw** (matches P73–P104) hardcoded in the
  page; live scores are overlaid onto it by matching team pairs. Spurious/missing fixtures
  in the feed can't break the bracket.
- Opening `index.html` directly from disk (no server) still works — the `/api/data` call
  just fails and it falls back to built-in sample data (or data injected by
  `wc26-refresh.mjs`).

## Updating the API key later

Vercel → Project → Settings → Environment Variables → edit `KICKOFF_API_KEY`, then redeploy.
