# NextPlay Task Manager

A responsive Kanban task manager built with React, TypeScript, and Supabase.

[Live demo](https://nextplay-task-manager-gold.vercel.app) · [Source code](https://github.com/Savanjadav/nextplay-task-manager)

## Overview

Organize tasks across **To Do**, **In Progress**, **In Review**, and **Done**. Open the app to start an anonymous guest session without an email address or password. A new guest starts with an empty board.

Tasks are stored in Supabase PostgreSQL. The browser restores its saved guest session on return, and database Row Level Security (RLS) keeps each guest's tasks separate. Guest access depends on that browser's stored session: clearing site data or switching browsers does not recover the previous board.

## Features

- **Task management:** create, view, edit, and permanently delete tasks with confirmation. Each task has a required title, a priority (Low, Normal, or High), and optional description and due date. Open a card to view its full details.
- **Column movement:** drag a card by its grip or use its keyboard-accessible **Move to…** control. Cross-column moves save the task status to Supabase. Cards use creation order; custom within-column ordering is not persisted.
- **Search and filters:** case-insensitive title and description search, priority and status filters, combined conditions, and **Clear Filters**. Filtering uses loaded tasks without additional database requests.
- **Feedback and recovery:** loading states, validation, retry actions, pending-save feedback, and confirmed move messages. A save is applied to the board only after the database confirms it.
- **Responsive layout:** desktop sidebar, mobile navigation drawer, scrollable board columns, and dialogs that fit smaller screens. Keyboard focus is visible, dialogs manage focus, and tasks can move without dragging.

If a move's save result is uncertain, the card stays at its last confirmed status and a recovery notice offers **Refresh Board**. A successful refresh reconciles the board with Supabase. The notice survives unrelated edits and filters until successful reconciliation or explicit **Dismiss**; dismissal does not change stored tasks. If creation confirmation is interrupted, check the board before submitting again to avoid duplicates.

## Technology stack

| Technology | Purpose |
| --- | --- |
| React | User interface and component state |
| TypeScript | Typed application code and task models |
| Vite | Development server and production builds |
| Tailwind CSS | Styling and responsive layouts |
| Supabase PostgreSQL | Persistent task storage |
| Supabase Auth (`@supabase/supabase-js`) | Anonymous guest sessions |
| Supabase RLS | Owner-scoped database access |
| `@dnd-kit/react` | Pointer drag-and-drop interactions |
| Lucide React | Icons |
| Vercel | Static application hosting |

## Local setup

### Prerequisites

- Node.js **22.15 or later** on a compatible release, with npm. The locked Vite dependency requires `^20.19.0 || >=22.12.0`, while the locked Supabase SDK requires `>=22.0.0`. The service tests additionally use Node's `registerHooks` API, available from 22.15. Node 26.x was used for the verified local and production builds; it is not the only supported major version.
- Git to clone the repository.
- A Supabase project with the database and anonymous authentication configured as below.
- Google Chrome for the optional browser test suite.

```sh
git clone https://github.com/Savanjadav/nextplay-task-manager.git
cd nextplay-task-manager
npm ci
cp .env.example .env.local
```

Edit `.env.local` with your own project's public configuration:

```dotenv
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_publishable_or_anon_key
```

Use the **HTTPS project-root URL**, with no API path, credentials, query, or fragment. The key must be a Supabase publishable key or a legacy `anon` key. Never use a service-role key, Supabase secret key, or database password. `.env.local` is ignored by Git.

### Supabase setup

For a new project:

1. Open Supabase's SQL Editor and review and run [schema.sql](supabase/schema.sql). It creates `public.tasks`, its constraints and index, and enables RLS. It does not create ownership policies or grant browser CRUD access.
2. Run [verify_schema.sql](supabase/verify_schema.sql) and [verify_rls.sql](supabase/verify_rls.sql). Inspect the schema and effective grants before continuing. Supabase projects can have different default privileges; unexpected grants must be reviewed before applying the policy script.
3. Review and run [rls_policies.sql](supabase/rls_policies.sql), then rerun the verification queries. This script adds four ownership policies and grants CRUD to `authenticated` only.
4. Enable **anonymous sign-ins** in Supabase Authentication settings.
5. Put the project's public URL and publishable or legacy anonymous key in `.env.local`.

These SQL scripts are for **initial setup**, not repeatable migrations. They stop if the table or policies already exist, or if unexpected privileges are present. Do not rerun them over an existing database without inspection. See [Supabase setup and verification](supabase/README.md) for the preflight expectations.

### Run and build

```sh
npm run dev
```

Open the local URL printed by Vite. After changing environment configuration, restart the development server.

```sh
npm run build
npm run preview
```

The build type-checks the application and writes production assets to `dist`. The preview command serves that build locally at the URL it prints.

## Database and security

| Field | Database behavior |
| --- | --- |
| `id` | UUID primary key, generated by PostgreSQL |
| `user_id` | Required owner UUID referencing `auth.users`; deleting the user cascades to their tasks |
| `title` | Required, contains a non-whitespace character, maximum 200 characters |
| `description` | Optional text |
| `status` | Required: `todo` (default), `in_progress`, `in_review`, or `done` |
| `priority` | Required: `low`, `normal` (default), or `high` |
| `created_at` | Required timestamp with time zone, defaults to `now()` |
| `due_date` | Optional calendar date |

An anonymous sign-in still creates an authenticated Supabase user. Every task belongs to that user's ID. The SELECT, INSERT, UPDATE, and DELETE policies compare `auth.uid()` with `user_id`. UPDATE checks both the existing and resulting row, preventing ownership transfers. Signed-out `anon` requests have no task CRUD permissions under the supplied security configuration.

The task service verifies the current guest, supplies ownership on creation, rejects immutable input fields, and filters reads and mutations by owner. Those client checks provide additional safeguards; **RLS and database grants enforce authorization**. Vite embeds `VITE_` values in browser assets, so the public URL and client key are expected to be readable. They do not grant privileged database access.

## Architecture and decisions

| Area | Location and responsibility |
| --- | --- |
| Authentication | `src/features/auth/`: restore or create the guest session, handle startup and retry |
| Task service | `src/features/tasks/taskService.ts`: validation and typed Supabase operations |
| Task state | `src/features/tasks/useTasks.ts`: loading, confirmed rows, pending moves, and recovery |
| Board | `src/features/board/`: columns, cards, pointer drops, and accessible movement |
| Dialogs and filters | `src/features/tasks/`: shared create/edit/delete dialog and derived filtering |
| Layout | `src/components/layout/`: header, sidebar, and mobile drawer |

The browser talks directly to Supabase; there is no separate application server. React state holds one confirmed task collection from which columns, counts, and filters are derived. The workspace is keyed by guest ID so identity changes reset task state and discard stale UI responses. Shared in-flight initialization handles React Strict Mode effect replay. Moves persist status, while a refresh reconciles uncertain outcomes.

See [Architecture](docs/ARCHITECTURE.md) for request flows and recovery details, and [Design system](docs/DESIGN_SYSTEM.md) for layout and interaction guidelines.

## Testing

Run from the repository root after installing dependencies:

```sh
npm run build
npm run lint
node --test tests/taskService.test.mjs
node --test tests/board.test.mjs
```

Service tests use the real SDK with simulated Auth and Data API responses. Default browser tests launch headless Chrome against a temporary Vite server, render the real app under Strict Mode, and simulate authentication and task-service responses. They do not write to Supabase. On macOS the suite uses the standard Chrome application path; elsewhere it uses `google-chrome`. Set `CHROME_BIN` to the executable if needed.

The verified baseline is **15 service tests passed** and **7 simulated Chrome tests passed**, with **4 optional live branches skipped**. Coverage includes validation, guest changes, stale responses, CRUD feedback, filters, movement, and persistent recovery notices. Skipped live branches are not passing live tests.

### Optional live verification

These checks connect to the Supabase project configured in `.env.local`. Run one mode at a time, preferably against a dedicated test project. All live modes create anonymous Auth accounts, which remain after the run. Mutation modes create identifiable tasks and attempt cleanup; inspect any cleanup failure before rerunning.

```sh
NEXTPLAY_LIVE_BOARD=1 node --test tests/board.test.mjs
```

This mode checks anonymous sign-in, session restoration, isolation, and an empty-board read without task writes. Mutation modes use the same command with one of these flags instead:

| Flag | Check |
| --- | --- |
| `NEXTPLAY_LIVE_CREATE=1` | Creation and persistence |
| `NEXTPLAY_LIVE_EDIT=1` | Editing and persistence |
| `NEXTPLAY_LIVE_DELETE=1` | Deletion confirmation and persistence |
| `NEXTPLAY_LIVE_FILTERS=1` | Combined filtering of live fixtures |
| `NEXTPLAY_LIVE_DRAG=1` | Pointer moves, persistence, and isolation |

For database ownership checks, see the opt-in [guest RLS verifier](supabase/README.md#live-guest-isolation-verification). It requires an independently supplied project hostname.

### Hosted verification

The production smoke test verified public HTTPS and assets, anonymous sign-in, session restoration, task CRUD, pointer dragging, keyboard movement, persistence after reload, and two-guest isolation. Browser layouts were checked at **320, 375, 768, 1024, and 1440 px**, including mobile navigation and dialog usability. Temporary tasks were removed.

Hosted network-interruption recovery, physical touch-device testing, and screen-reader walkthroughs were **not performed**. Simulated recovery coverage is separate from hosted verification; no complete WCAG compliance claim is made.

## Deployment

The live application is hosted on Vercel's Hobby plan with the GitHub repository connected.

| Setting | Verified configuration |
| --- | --- |
| Framework | Vite |
| Root directory | Repository root |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | Vercel's compatible npm default |
| Node.js | 26.x |
| Production branch | `main` |
| Required variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

The verified production deployment uses commit `cda8ae349ff9c922d4010ce6dd6c5ea10dea6d52`. Both variables are configured for Production and Preview; **Preview currently shares the production Supabase backend**. Development is unset. Use a separate backend before running preview work that should not touch production data. Changing Vite build-time variables requires a new build. The application uses only `/`, so no routing rewrite is needed.

## Limitations and future improvements

Guest accounts have no recovery flow or cross-device transfer. The app does not provide collaboration, team assignments, comments, activity history, custom within-column ordering, or overdue/due-soon indicators. Due dates are displayed as calendar dates.

Possible next steps include recoverable accounts, collaboration, persistent ordering, due-date indicators, further accessibility and physical-device testing, and stronger anonymous-signup abuse protection.
