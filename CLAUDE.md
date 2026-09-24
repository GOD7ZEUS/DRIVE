# Drive — Project Brief

A multi-tenant construction project/task tracker, live at https://drive-e0o3.onrender.com.

## Ownership

- Owner/user: Niladri Ghosal, `nghosal@royalconstruct.com`, Royal Infraconstru Limited (also runs SATTAVA Power Manufacturers LLP and a private client company through the same instance).
- Master account: `niladripro7@gmail.com` — the one account with `is_master=1`, sitting above even Super Admin.
- Repo: `https://github.com/GOD7ZEUS/DRIVE.git`, branch `main`.
- Hosting: Render (free tier), Docker-based deploy, auto-deploys on push to `main`. A desktop Electron build also exists under `desktop/`, and an Android APK wrapper under `mobile/` (Capacitor, just loads the live production URL in a native shell — no separate deploy, see README's "Run (Android app)").

## Tech stack

- **Frontend**: React (Vite) + React Router, plain CSS (`client/src/index.css`) with light/dark theme via CSS variables.
- **Backend**: Node/Express, JWT-in-httpOnly-cookie auth (`server/src/middleware/auth.js`).
- **Database**: Turso (libSQL, SQLite-compatible) via `@libsql/client` in production; falls back to a local SQLite file (`server/tracker.db`) in dev when `TURSO_DATABASE_URL` isn't set. Migrations are additive-only via an `ensureColumn()` helper in `server/src/db.js` — never destructive. One exception: adding the `pro_admin` role required a full table-rebuild since SQLite can't `ALTER` a `CHECK` constraint.
- **Local dev**: `npm run dev` from the repo root runs server (:3001) + client (:5173) concurrently.

## Roles (highest to lowest)

1. **Master** — a `super_admin` with `is_master=1`. Sees everything, including private companies. Only Master can: create/edit/delete other `super_admin` or `pro_admin` accounts, mark a company private, delete companies/departments, lock a project's documents with a password, set the Activity Log.
2. **Super Admin** — sees everything except companies Master has marked private (invisible in every listing and 404s on direct access — never a distinguishable 403).
3. **Pro Admin** — Master-created only, assigned to exactly one company. Has full Super-Admin-equivalent power (departments, users, projects, milestones, tasks, plans, rollout dates) but confined to that one company. Cannot create companies or promote anyone to `super_admin`/`pro_admin`. Any admin/view user a Pro Admin creates is always visible only to that Pro Admin + Master, regardless of whether the company is private.
4. **Admin** — locked to one company+department, can edit most things there but not description/department-moves (Super Admin/Pro Admin tier only).
5. **View** — read-only, but unscoped: sees every company/department's projects/tasks/dashboard (same visibility as a regular Super Admin, i.e. every company except ones Master marked private), just with zero write access anywhere.

## Data model

`companies` → `departments` → `sub_departments` (sub-departments have no management page — only created/picked inline from the New Project form or a project's Edit tab) → `projects` → `milestones` / `tasks` → `comments`. Users carry `company_id`/`department_id` (Pro Admin: company_id only, `department_id` null = whole company).

## Features built (roughly in order)

- First/last name on users; every assignee/responsible-person picker shows names (falls back to email).
- Master can edit any user's role, name, company, department.
- Assignee/responsible-person pickers show every non-master user across every company — except a Pro Admin's own picker, which is narrowed to just their company.
- Project Rollout Date with full revision history (`project_rollout_dates`, insert-only, newest-first) — fully replaced the old "Deadline" field. Dashboard TAT math uses the earliest rollout date as baseline, not the latest revision.
- App-wide DD-MM-YYYY display everywhere (`dateFormat.js`), ISO kept internally.
- Company/department rename editing (previously creation-only).
- Private companies (`companies.is_private`) — fully invisible to every non-master Super Admin: hidden from every list, 404 (not 403) on direct access, via `blockedByPrivacy()` and a reusable SQL exclusion fragment.
- Pro Admin role (details above) with strict user-visibility exclusivity, enforced on both list views and direct-by-ID PATCH/DELETE.
- Master can delete companies/departments — blocked while non-empty (departments/projects/users must be cleared first, no cascading deletes).
- Sub Department tier, inline-only creation.
- Ability to change a project's company/department/sub-department after creation (previously permanent) — Super Admin/Pro Admin only.
- Project description editing restricted to Super Admin/Pro Admin.
- User filter on the Projects page (beside Company) — filters by Responsible Person, client-side against the loaded list.
- Project card UI: status badge pinned right regardless of description length, Rollout/RESP shown as spaced pill tags, bold purple meta text, line breaks preserved in descriptions (`.multiline` CSS class).
- Master-only password lock on a project's Plan Documents — locks only document viewing/downloading (rest of the project stays open); no bypass via direct link; password verified fresh every request; client remembers a verified password in memory only, never persisted; Master always bypasses.
- Security Question setup/change now requires the current login password first; added a "Change Security Question" option to the account menu.
- Activity Log (Master-only nav item) — records every delete/meaningful edit across projects, milestones, tasks, users, companies, departments, with who/what/when. Auto-prunes entries older than 30 days (startup sweep + 6-hour interval + prune-on-read).
- Removed leftover explanatory subtitle lines under the Companies and Activity Log headings.

## Deploy/verify loop

implement → build-check (`npm run build` in `client/`) → run locally via `npm run dev` and test both via `curl` (backend permission matrix) and the browser (UI) → commit → `git push origin main` → poll production until the new bundle/route is actually live (Render's basic health check alone doesn't prove new code deployed — poll for a distinguishing signal like a new bundle hash or a JSON response instead of the old 404 page) → final live check against production using throwaway test data, cleaned up immediately after, never touching real data.

## Notes for whoever picks this up

- "Shreeja India" (a private test company) was deleted at some point, most likely by Niladri via the delete-company UI — flagged, not a bug.
- Render free tier cold-starts after idling; that's a startup-delay quirk, not a data-loss risk (data lives in Turso, separate from Render's ephemeral disk).
- No outstanding bugs or half-finished work as of the last session — every feature above is live, tested, and confirmed on production.
