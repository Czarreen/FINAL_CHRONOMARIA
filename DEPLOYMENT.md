# Chronomaria — Deployment Guide

This guide walks you through deploying Chronomaria to free cloud hosting using **Vercel** (frontend) and **Render** (backend + Python GA service).

## Live URLs

| Service | URL |
|---|---|
| Frontend | https://final-chronomaria.vercel.app |
| Node.js API | https://chronomaria-api.onrender.com |
| Python GA | https://smu-chronomaria.onrender.com |
| Database | Supabase (managed, always live) |

---

## Architecture Overview

```
Browser
  └─► Vercel (React/Vite static site)       → https://final-chronomaria.vercel.app
        └─► Render: Node.js API              → https://chronomaria-api.onrender.com
              └─► Render: Python GA          → https://smu-chronomaria.onrender.com
              └─► Supabase (PostgreSQL)      → already live
```

---

## Prerequisites

- GitHub account with the Chronomaria repo pushed to it
- Vercel account — [vercel.com](https://vercel.com) (free)
- Render account — [render.com](https://render.com) (free)
- Your Supabase credentials (in `Backend/.env`)
- Your Gemini API key (for the AI assistant feature)

---

## Step 1 — Push the repo to GitHub

If not already done:

```bash
git remote add origin https://github.com/<your-username>/Chronomaria.git
git push -u origin main
```

---

## Step 2 — Deploy the Python GA Service on Render

1. Log in to [render.com](https://render.com)
2. Click **New +** → **Web Service**
3. Connect your GitHub repo
4. Fill in the settings:

   | Field | Value |
   |---|---|
   | Name | `smu-chronomaria` |
   | Root Directory | `GeneticAlgorithm` |
   | Environment | `Python 3` |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `python optimizer.py` |
   | Instance Type | **Free** |

5. No environment variables needed for the GA service.
6. Click **Create Web Service** and wait for the first deploy to finish.
7. Deployed URL: `https://smu-chronomaria.onrender.com`

---

## Step 3 — Deploy the Node.js Backend on Render

1. Click **New +** → **Web Service** again
2. Connect the same GitHub repo
3. Fill in the settings:

   | Field | Value |
   |---|---|
   | Name | `chronomaria-api` |
   | Root Directory | `Backend/node-api` |
   | Environment | `Node` |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

4. Under **Environment Variables**, add the following (get values from `Backend/.env`):

   | Key | Value |
   |---|---|
   | `SUPABASE_URL` | `https://twjretkdejnordbveorb.supabase.co` |
   | `SUPABASE_ANON_KEY` | *(your anon key)* |
   | `SUPABASE_SERVICE_ROLE_KEY` | *(your service role key)* |
   | `DB_HOST` | *(your DB host)* |
   | `DB_PORT` | `6543` |
   | `DB_USER` | *(your DB user)* |
   | `DB_PASSWORD` | *(your DB password)* |
   | `DB_NAME` | `postgres` |
   | `DB_SSL` | `true` |
   | `PYTHON_SERVICE_URL` | `https://smu-chronomaria.onrender.com` |
   | `FRONTEND_ORIGIN` | `https://final-chronomaria.vercel.app` |

5. Click **Create Web Service** and wait for the deploy.
6. Deployed URL: `https://chronomaria-api.onrender.com`

---

## Step 4 — Deploy the Frontend on Vercel

1. Log in to [vercel.com](https://vercel.com)
2. Click **Add New** → **Project**
3. Import your GitHub repo
4. Configure the project:

   | Field | Value |
   |---|---|
   | Framework Preset | `Vite` |
   | Root Directory | `Frontend` |
   | Build Command | `npm run build` |
   | Output Directory | `dist` |

5. Under **Environment Variables**, add:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE_URL` | `https://chronomaria-api.onrender.com` |
   | `GEMINI_API_KEY` | *(your Gemini API key)* |

6. Click **Deploy**.
7. Deployed URL: `https://final-chronomaria.vercel.app`

---

## Step 5 — Verify Everything Works

Run through this checklist:

- [ ] `https://chronomaria-api.onrender.com/health` returns `{"status":"ok","service":"node-api"}`
- [ ] `https://smu-chronomaria.onrender.com` returns `{"status":"ok","service":"genetic-algorithm"}`
- [ ] Frontend loads at https://final-chronomaria.vercel.app with no CORS errors in browser console (F12 → Console)
- [ ] Login / authentication works
- [ ] Course Offerings page loads data
- [ ] Subjects and Rooms pages load data
- [ ] Faculty Loading / automatic scheduling runs
- [ ] CSV import works on a small test file

---

## Important Limitations of the Free Tier

| Issue | What Happens | Workaround |
|---|---|---|
| Render free spins down after 15 min of no traffic | First request after idle takes 30–60 seconds | Wait for it, or upgrade to Render Starter ($7/mo) |
| Python GA has 512 MB RAM | Very large scheduling runs may crash | Keep department sizes reasonable for demos |
| Render free = 750 instance-hours/month total | ~375h per service — plenty for demo/academic use | Monitor usage in Render dashboard |

---

## Redeployment (After Code Changes)

Both Vercel and Render auto-deploy on every `git push` to `main`. Just push your changes:

```bash
git add .
git commit -m "your message"
git push origin main
```

All three services will rebuild and redeploy automatically.

---

## Local Development (Unchanged)

To run locally as before:

```bash
python run.py
```

This still starts all three services on `localhost` (ports 3000, 5000, 8000).
