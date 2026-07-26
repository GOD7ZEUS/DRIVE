# Drive

A project/task tracking app: projects with status and milestones, tasks with assignees and due dates, a dashboard overview, per-task comments/activity log, role-based accounts scoped by company/department, and a light/dark theme toggle. Available as a web app (`npm run dev`) or a downloadable Windows desktop app.

## Stack

- **Backend**: Node/Express using the built-in `node:sqlite` module — data stored in `server/tracker.db` (or the path in `DB_PATH`). Auth via JWT in an httpOnly cookie, passwords hashed with `bcryptjs`.
- **Frontend**: React (Vite) + React Router, plain CSS with small keyframe animations.
- **Desktop**: Electron (v43+, ships Node 24 with built-in `node:sqlite` — no native module/compiler needed) wraps the same server + built frontend into a downloadable Windows app.

## First run

The first person to open the app (web or desktop) is walked through creating the **Super Admin** account right in the UI — no `.env` editing required. For local development you can still pre-seed one via `server/.env` (see below) if you want a fixed dev login.

## Setup

```
npm run install:all
```

Create `server/.env` (gitignored, not committed) with:

```
SUPER_ADMIN_EMAIL=your-email@example.com
SUPER_ADMIN_PASSWORD="your-password"
JWT_SECRET=some-long-random-string
```

Quote the password if it contains `#` — dotenv treats an unquoted `#` as a comment. The super admin account is seeded automatically on first server start if no `super_admin` row exists yet.

## Run (development, web)

```
npm run dev
```

This starts the API on http://localhost:3001 and the web app on http://localhost:5173 (Vite will print the actual port).

To run them separately: `npm run dev:server` and `npm run dev:client`.

## Run (desktop app)

```
npm run electron:dev
```

builds the client, starts the server in-process, and opens it in an Electron window.

To produce a downloadable build:

```
npm run electron:build
```

This writes two things to `desktop/dist/`:
- `Drive 1.0.0.exe` — a single portable executable. This is the one to share/download; no install step needed, just run it.
- `win-unpacked/` — the same app unpacked into a folder, useful for testing.

Each user's data lives in their own per-machine location (`%APPDATA%/drive-desktop/drive.db`), and the very first launch walks them through creating their own Super Admin account.

## Roles & company/department scoping

- **Super Admin** — the seeded account; can create/delete Admin and View accounts from the "Users" page, and sees every project across every company. Cannot be deleted or edited via the API.
- **Admin** — full read/write on projects, milestones, tasks, and comments, scoped to their own Company + Department. Every project they create is automatically tagged with their account's Company/Department. No access to user management.
- **View** — read-only, scoped to their own Company + Department; all create/edit/delete controls are hidden, and the API rejects mutating requests from this role.

When a Super Admin creates an Admin or View account, they set that account's **Company** and **Department**. From then on that account only ever sees data tagged with the same Company + Department — effectively each department gets its own dedicated view without needing separate pages. Cross-tenant record access returns `404`, not `403`, so one company's data doesn't leak the existence of another's.

There is no public signup — accounts only exist once a Super Admin creates them from the Users page.

### Company/Department keys

Company and Department are never free-typed twice. Super Admin picks an existing one from a dropdown (populated from real `companies`/`departments` tables) or chooses "+ Add new…" to mint one — the first time a name is used it gets an auto-generated primary key, and picking it again always reuses that same key (matched case-insensitively, so "Royal Construct" and "royal construct" resolve to the same row). Departments are keyed under their company (`departments.company_id`), and all access scoping compares these ids, not the display names, so a typo can't accidentally split or merge someone's data. The ids show up in the UI as small `Co.#` / `Dept.#` tags wherever Super Admin can see them.

Super Admin navigates **Companies → Departments → Projects**: the "Companies" page lists every company with department/project counts, expands to show its departments, and clicking a department jumps straight to that filtered project list. Admin/View accounts skip all of this — they only ever see their own company+department automatically.

## Using it on a phone

Both the web app and the API bind to all network interfaces (not just `localhost`), so from a phone on the **same WiFi** as the machine running `npm run dev`:

1. Find the machine's LAN IP (Windows: `ipconfig`, look for "IPv4 Address").
2. Open `http://<that-IP>:5173` in the phone's browser.
3. If Windows Firewall prompts to allow Node.js, allow it on **private networks**.

The Electron `.exe` is a Windows desktop build only — it doesn't run on a phone; the browser route above is the way to use this app on mobile.

## Using it from anywhere (mobile data, outside your WiFi)

The LAN steps above only work when both devices share the same WiFi/router. To reach the app from mobile data or any other network, it needs to be exposed to the public internet. This project uses a free **Cloudflare Tunnel** for that:

1. Build and start the production server (serves the built app + API from one origin on port 3001):
   ```
   npm run start:prod
   ```
2. In a separate terminal, start a quick tunnel pointed at it:
   ```
   cloudflared tunnel --url http://localhost:3001
   ```
   (Install once with `winget install --id Cloudflare.cloudflared -e` if you don't have it.)
3. cloudflared prints a public HTTPS URL like `https://random-words.trycloudflare.com` — that's usable from any network, any device, no firewall/router changes needed.

Things worth knowing about this approach:
- It only works while this PC is on and both `start:prod` and `cloudflared` keep running — closing either takes the link down.
- The URL is random and **changes every time you restart the tunnel** (this is the free, no-signup "quick tunnel"). For a stable, permanent URL you'd need a free Cloudflare account plus a domain, or move to a real hosting provider (Railway, Render, a VPS, etc.) so the app runs independently of this PC.
- The public URL only serves the built (`vite build`) client, not the dev server with hot-reload — re-run `npm run start:prod` after making changes and rebuilding.

## Deploying for real, always-on access (Fly.io)

The tunnel above depends on this PC and this terminal staying on. For a link that works from anywhere, anytime, independent of this machine, this repo is set up to deploy to [Fly.io](https://fly.io) — `Dockerfile` builds the app (client + server in one image), `fly.toml` configures a single always-on machine plus a persistent volume so the SQLite database survives restarts and redeploys (Fly's free tier, unlike some others, supports a small persistent volume).

You'll need to do the account/auth steps yourself — here's the full sequence, run from `C:\Users\nilad\project-tracker`:

```
flyctl auth login
flyctl launch --no-deploy
flyctl volumes create drive_data --region bom --size 1
flyctl secrets set JWT_SECRET=91c3fe63559acbab98dfb920027b2ce3d7f5ed2a9d2bbfbc30054863a83132ab
flyctl deploy
```

- `auth login` opens a browser to sign in or create a Fly account. Fly currently asks for a payment method even for free-tier usage (to prevent abuse) — you won't be charged as long as you stay within the free allowance, but have a card ready.
- `launch --no-deploy` reads the existing `fly.toml`/`Dockerfile` and will ask you to confirm the app name (`drive-royalconstruct` — pick something else if that's taken) and region (defaults to Mumbai/`bom`).
- The `volumes create` command only needs to run once ever, before the first deploy.
- The `JWT_SECRET` above was randomly generated for you — feel free to use it as-is, it's not shared anywhere else.
- No local Docker install needed — `flyctl deploy` builds the image on Fly's remote builder.

After that, the app is live at `https://<your-app-name>.fly.dev`, and the first visitor is walked through creating the Super Admin account (no env vars to set for that). To ship a code change later, just run `flyctl deploy` again from this directory.

## API

All endpoints are under `http://localhost:3001/api` and (except `/auth/login`) require the `token` auth cookie:

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PATCH/DELETE /users` (Super Admin only)
- `GET /companies`, `GET /companies/:id/departments` (Super Admin only)
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` — scoped by company/department for non-Super-Admin roles
- `GET/POST /projects/:id/milestones`, `PATCH/DELETE /milestones/:id`
- `GET/POST /projects/:id/tasks`, `GET/PATCH/DELETE /tasks/:id`
- `GET/POST /tasks/:id/comments`
- `GET /dashboard` — scoped the same way
