# SolarSquare LRM Operations Dashboard — Vercel Deploy

Plain HTML + Vercel Serverless Functions. No build step. Same service account as `solarsquare-qa`.

---

## 1. Push to GitHub

Create a new **private** repo (e.g. `solarsquare-lrm`) and push this folder.

```bash
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/Analyticssse-cloud/solarsquare-lrm.git
git push -u origin main
```

---

## 2. Deploy on Vercel

1. Go to **vercel.com → Add New → Project → Import** the repo.
2. Framework preset: **Other** (no build step needed).
3. Build command: *(leave blank)*
4. Output directory: `public`
5. Add these **Environment Variables** (same values as `solarsquare-qa`):

| Variable         | Value                                      |
|------------------|--------------------------------------------|
| `SHEET_ID`       | `17iOry-amF9Qnw9HzMd1lsjKdj-HFvxBpP768uK-m4BU` |
| `GOOGLE_SA_EMAIL`| your service account email                 |
| `GOOGLE_SA_KEY`  | full private key (keep `\n` sequences)     |

6. Click **Deploy**.

---

## 3. Verify

- Open `https://your-project.vercel.app` → dashboard should load.
- Open `https://your-project.vercel.app/api/dashboard?from=2026-06-17&to=2026-06-17` → should return JSON.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 500 on `/api/dashboard` | Sheet not shared with `GOOGLE_SA_EMAIL`, or Sheets API not enabled in Google Cloud |
| Empty data | Check `SHEET_ID` is correct and Ozontel tab has today's data |
| `GOOGLE_SA_KEY` error | Wrap the value in quotes in Vercel, keep literal `\n` characters |

---

## Project structure

```
public/
  index.html          Frontend (plain HTML, fetches /api/dashboard)
api/
  _sheets.js          Shared Google Sheets helper (not an endpoint)
  dashboard.js        GET /api/dashboard?from=&to=
package.json
vercel.json
```
