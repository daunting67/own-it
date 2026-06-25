# Own It — Deployment Guide

## Overview

| Layer | Service | Cost |
|-------|---------|------|
| Frontend | Vercel | Free |
| Backend | Railway | Free tier |
| Database | Supabase | Free tier |

---

## Step 1 — Set up the database (Supabase)

1. Go to [supabase.com](https://supabase.com) → New project
2. Name it `ownit`, choose a region close to New Zealand (e.g. Singapore)
3. Set a strong database password — save it somewhere safe
4. Once created, go to **Settings → Database → Connection string (URI)**
5. Copy the connection string — it looks like:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.xxxx.supabase.co:5432/postgres
   ```

---

## Step 2 — Deploy the backend (Railway)

1. Go to [railway.app](https://railway.app) → New project → Deploy from GitHub repo
2. Point it at the `own-it` repo, select the `server` directory
3. Under **Variables**, add:

   | Variable | Value |
   |----------|-------|
   | `DATABASE_URL` | Your Supabase connection string from Step 1 |
   | `JWT_SECRET` | A long random string (use a password manager to generate 32+ chars) |
   | `ALLOWED_ORIGINS` | Your Vercel frontend URL (add after Step 3) |
   | `PORT` | `3001` |

4. Railway will auto-detect Node.js and run `npm start`
5. Note your Railway URL — looks like `https://own-it-server.up.railway.app`

**Run database migration (first deploy only):**
In Railway's terminal or locally with the DATABASE_URL set:
```bash
cd server
npx prisma db push
node src/seed.js
```

This creates all tables and the initial admin account:
- Email: `admin@ownit.co.nz`
- Password: `changeme123` ← **change this immediately after first login**

---

## Step 3 — Deploy the frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → New project → Import from GitHub
2. Select the `own-it` repo, set **Root Directory** to `client`
3. Under **Environment Variables**, add:

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | Your Railway backend URL from Step 2 |

4. Deploy. Vercel gives you a URL like `https://own-it.vercel.app`

5. Go back to Railway → update `ALLOWED_ORIGINS` to your Vercel URL

---

## Step 4 — Custom domain (optional)

If you have `ownit.co.nz` or similar:
1. In Vercel → project settings → Domains → add your domain
2. Follow Vercel's DNS instructions (usually a CNAME record)

---

## Step 5 — Create user accounts

Log in as admin (`admin@ownit.co.nz` / `changeme123`) and immediately:
1. Change the admin password via the user management panel
2. Create accounts for each team member with the correct role

**Available roles:**
- `super_admin` — full access to everything
- `hr_manager` — People & HR module
- `payroll_officer` — Payroll module
- `director` — read-only across all modules
- `hs_manager`, `ops_manager`, `site_manager`, `trainer`, `worker`

---

## Adding Azure AD SSO later

When IT is ready to set this up, the steps are:
1. Register an app in Azure AD with scopes: `openid`, `profile`, `email`, `User.Read`
2. Add `@azure/msal-browser` to the frontend, `@azure/msal-node` to the backend
3. Replace the login form with Microsoft's sign-in button
4. Map Azure AD object IDs to Own It user records

The database schema is already ready for this — no migrations needed.

---

## Local development

```bash
# Backend
cd server
cp .env.example .env   # fill in your DATABASE_URL and JWT_SECRET
npm install
npx prisma db push
node src/seed.js
npm run dev            # runs on http://localhost:3001

# Frontend (new terminal)
cd client
npm install
npm run dev            # runs on http://localhost:5173
```
