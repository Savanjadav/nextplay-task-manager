# Kanban Board Architecture

## 1. Architecture overview

Use a single-page React and TypeScript app built with Vite and styled with Tailwind CSS. Vercel serves the static build from `dist`. The browser uses one Supabase client for Anonymous Auth and the PostgreSQL Data API. Row Level Security (RLS) enforces task ownership. dnd-kit handles drag interactions inside the React board. This stack supports the guest-owned Kanban workflow. [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite) · [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous) · [dnd-kit React](https://dndkit.com/react/quickstart/)

## 2. Proposed folder structure

The source and configuration paths below are planned for implementation.

```text
NextPlay-Assessment/
├── docs/
│   ├── DESIGN_SYSTEM.md
│   └── ARCHITECTURE.md
├── src/
│   ├── features/
│   │   ├── auth/
│   │   │   ├── AuthFeedback.tsx
│   │   │   ├── AuthProvider.tsx
│   │   │   └── useAuth.ts
│   │   ├── tasks/
│   │   │   ├── TaskDialog.tsx
│   │   │   ├── TaskFilterControls.tsx
│   │   │   ├── taskFilters.ts
│   │   │   ├── taskService.ts
│   │   │   └── useTasks.ts
│   │   └── board/
│   │       ├── KanbanBoard.tsx
│   │       ├── KanbanColumn.tsx
│   │       └── TaskCard.tsx
│   ├── lib/
│   │   └── supabase.ts
│   ├── types/
│   │   └── task.ts
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── supabase/
│   ├── schema.sql
│   └── rls_policies.sql
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## 3. Folder responsibilities

| Path | Responsibility |
| --- | --- |
| `docs/` | Holds scope and architecture decisions for implementation. |
| `src/` | Contains the React entry point, app shell and global Tailwind theme and base styles. |
| `src/features/auth/` | Owns guest authentication, auth context, and startup feedback. |
| `src/features/tasks/` | Owns authenticated task queries, validation and the shared task dialog. |
| `src/features/board/` | Keeps columns, cards and their configuration together. |
| `src/lib/` | Holds the shared, typed Supabase client. |
| `supabase/` | Holds versioned schema, constraints, grants and RLS policies for review and reproduction. |
| Project root | Holds the Vite HTML entry, build and TypeScript configuration, dependency manifest and environment template. |

Add `public/` when a static asset needs to be served by name. Extract shared UI after a second use makes the common behavior clear. Keep feature-specific types, hooks and helpers beside their callers.

## 4. Component responsibilities

| Component | Data received | Responsibilities and actions |
| --- | --- | --- |
| `App` | Guest session and startup state from the session hook | Own the page shell and header, display startup feedback and retry, and mount the board for the current guest. |
| `GuestBoard` | Guest user ID | Call `useTasks`, show loading, error or empty feedback, and pass fetched tasks to the board. |
| `KanbanBoard` | Fetched task rows | Filter tasks into the four configured columns. Each column counts and renders its own rows. |
| `KanbanColumn` | Status, heading, visible tasks and pending move IDs | Provide a drop target for its status, including when empty. Render cards and highlight the current target. |
| `TaskCard` | Task and pending-move flag | Render the title and available metadata. Expose a focusable drag handle and indicate when a move is saving. |
| `TaskDialog` | Guest ID, optional selected task and save/dismiss callbacks | Own the draft and validation for creating or editing. Close on confirmation and restore focus. |

Use native form controls in the task creation dialog. Keep feedback markup close to where it appears.

## 5. State-management strategy

Use React state and effects. Data flows through props and actions through callbacks.

- **App scope.** `AuthProvider` exposes startup status, the current session and a retry action through `useAuth`. The signed-in user and ID are available at `session.user` and `session.user.id`. Key the board by user ID so changes in identity reset board state. Refresh of the same guest's token keeps the board mounted.
- **Board scope.** `useTasks` owns the task load state and exposes a retry. The guest-keyed board mounts only after authentication succeeds. An identity change or sign-out immediately unmounts the old board. Cleanup ignores results from superseded requests. Strict Mode effect replay shares the request for the current guest and attempt.
- **Local UI.** `TaskDialog` owns its draft, submit state and form error across creation, editing, and deletion. The keyed guest workspace owns whether the dialog is open.
- **Derived views.** The guest workspace owns search, priority and status selections. It derives visible cards from the current task array and preserves all four columns. The workspace resets its filters when the guest changes.

## 6. Supabase integration strategy

1. `supabase.ts` validates configuration and initializes a single browser client with SDK session persistence and token refresh. `AuthProvider` restores the session first and calls anonymous sign-in only when restoration succeeds and there is no session. Share one in-flight initialization across mounts to handle React development remounts. Subscribe to auth changes, clean up the subscription on unmount and clear the board if identity is lost. [Supabase client initialization](https://supabase.com/docs/reference/javascript/initializing) · [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
2. `src/features/tasks/taskService.ts` exposes `getTasks()`, `createTask(input)`, `updateTask(taskId, updates)` and `deleteTask(taskId)`. Fetches page through tasks ordered by `created_at DESC, id ASC`. Create and update return the database row. Delete returns `{ deleted: boolean }`.
3. Each operation checks the current user with Supabase Auth. Reads, updates and deletes filter by owner. Creates use the authenticated user ID and let PostgreSQL generate the ID and creation timestamp. RLS enforces ownership on the server, including both the current and resulting row for updates. [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser) · [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
4. The service trims titles, enforces the 200-character limit, validates status, priority and calendar dates, and rejects immutable fields. Omitted fields use database defaults on create or stay unchanged on update. Blank or null descriptions and due dates clear those nullable fields. Status and priority must be valid values when supplied.
5. `TaskServiceError.code` distinguishes required authentication, invalid input, a missing or inaccessible update target, request failures and network failures. Delete returns `{ deleted: false }` for missing or inaccessible tasks. Errors contain user-facing messages without raw Supabase details.
6. The authenticated board reads Supabase through `getTasks()` in development and production. Each fetched `Task` goes directly to the existing board and card components. The shared model preserves IDs, status, priority, nullable metadata, and timestamps. The four configured statuses determine the columns and counts.
7. The shell remains available during task loading and errors. The board shows counts only after a successful load. A zero-row result renders all four empty columns and an empty-board message. A request failure shows a task-only Retry. The development mock fixture is outside the app's task source.

Run the isolated service checks with `node --test tests/taskService.test.mjs` on Node.js 22.15 or later. They exercise real SDK request construction with simulated Auth and Data API responses. The [live RLS results](../supabase/README.md#task-42-live-guest-isolation-verification) cover database ownership enforcement.

### Guest authentication verification

Enable anonymous sign-ins in the Supabase project and configure the public values from `.env.example` in `.env.local` before running `npm run dev`. The SDK stores and refreshes the browser session. The workspace shows loading or retry feedback while keeping the header and navigation available. If the session is lost, the board closes and waits for a retry.

Supabase gives each guest a user ID and the `authenticated` role. The task ownership policies match `auth.uid()` to `tasks.user_id`. Guest identity depends on that browser's stored session. Clearing site data, switching profiles or using a private window can create a distinct guest and make the previous guest's saved tasks inaccessible from the new session. Anonymous accounts have no built-in recovery or cross-device access. [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)

1. Open the dev app in a fresh browser profile with DevTools Network open. Check for one successful `POST /auth/v1/signup` during startup and the live board after sign-in. This also checks duplicate requests while React Strict Mode is active.
2. Refresh in that profile. Check that the board opens without another signup and the guest user ID stays the same. Compare the user ID using the Supabase Auth Users dashboard or the guest's user ID in DevTools Application storage.
3. Open the app in a separate browser profile or private window. Check that the new signup returns a different user ID.
4. Use a fresh profile with the network offline or the signup request blocked. Check that a friendly error with Retry appears and that requests stop. Restore connectivity, click Retry, and verify that the board opens.

### Task creation

**New Task** is available once the authenticated board loads. The native dialog focuses the title on open, contains keyboard focus, and returns focus to the trigger on close. Cancel and Escape close it while idle. The dialog scrolls on short screens while keeping its actions visible.

The form trims and validates the required title against the 200-character limit. Status defaults to To Do and priority to Normal. The description and native date field are optional. Dates are passed as calendar strings. The dialog submits through `createTask(input, expectedGuestId)`. The expected ID is a session guard. The service obtains the row owner independently from Supabase Auth, validates the input again, and lets PostgreSQL assign the ID and timestamp.

A synchronous guard blocks repeat submits during the request. The dialog stays open with progress feedback until Supabase returns a row. On success, `useTasks` merges that row by ID in the board's existing sort order. The column and total counts update without a board reload. Errors keep the draft and allow a manual retry. If the network interrupted confirmation, check the board before submitting again. Guest changes unmount the old dialog and board, and the old request cannot update the new guest's UI.

Headless Chrome verified live creation in In Review with optional fields, one persisted row after refresh under the same guest, and isolation in a separate guest context. Cleanup used the owner's `deleteTask()` service and confirmed the uniquely named fixture was gone. To repeat this controlled write and cleanup, run `NEXTPLAY_LIVE_CREATE=1 node --test tests/board.test.mjs`. The default simulated checks cover validation, focus, pending and failed submissions, retry, guest changes and widths of 320, 375, 768, 1024 and 1440 px.

### Task editing

Click a card or activate its edit button with Enter or Space. The shared native dialog prepopulates title, description, status, priority and due date. It compares normalized values and closes an unchanged form without a request. Clearing a description or due date sends null. Changed fields go to `updateTask(taskId, changes, expectedGuestId)`; the service authenticates the current guest and restricts the update by task ID and owner.

The board applies only the row returned by Supabase, replacing it by ID in the existing sort order. A changed status moves the card to the matching column and updates the counts. Focus returns to that card in its new column. Failed saves keep the draft for manual retry. A missing or inaccessible task offers **Refresh Board**, which closes the dialog and refetches. Task loading and mutation dialogs are mutually exclusive in the current UI. The keyed guest workspace unmounts the old dialog and ignores its response if the guest changes.

Run `NEXTPLAY_LIVE_EDIT=1 node --test tests/board.test.mjs` for the opt-in persistence check. It creates a unique task through the UI, edits all five fields, checks column counts and identity after refresh, and verifies isolation from a separate guest. It deletes the fixture through its owner's session and verifies removal by readback.

### Task deletion

Open a task and choose **Delete Task**. The same native dialog switches to a confirmation that names the task and explains that deletion is permanent. It focuses **Cancel** first. Cancel or Escape returns to the edit draft with its unsaved values intact. While a delete is pending, the dialog blocks dismissal and repeated confirmation.

The dialog calls `deleteTask(taskId, expectedGuestId)`. The service verifies the active guest, filters by task ID and authenticated owner, and relies on RLS. Only `{ deleted: true }` removes the card. The column and total counts update without refetching, and focus moves to the column heading. Confirmed IDs stay excluded from later load responses for that guest. Changing guests unmounts the old dialog and discards its pending UI response.

A failed request leaves the card visible and the confirmation open for a manual retry. A zero-row result or an unconfirmed network outcome offers **Refresh Board** to reconcile with Supabase. Neither outcome is reported as a successful delete.

Run `NEXTPLAY_LIVE_DELETE=1 node --test tests/board.test.mjs` to create and remove a unique fixture through the UI. The live check confirmed that cancel sent no DELETE, the confirmed action sent one DELETE, and the fixture stayed absent after refresh under the same guest. A separate guest could not see the fixture. [Task 4.2 live RLS results](../supabase/README.md#task-42-live-guest-isolation-verification) cover denied cross-owner deletion.

### Search and filters

The header search trims the query and matches case-insensitive substrings in titles and descriptions. Priority and status use the existing task values. A card must meet every active condition. **Clear Filters** restores the loaded task list and returns focus to search. All four columns remain visible. Their counts reflect visible cards, and the board summary distinguishes visible and loaded totals. A guest with zero saved tasks sees the existing empty board. A filtered view with zero matches shows a separate message.

Filters use confirmed React task state and make no Supabase requests. Saves and deletes update the underlying task list, so a card can enter or leave the filtered view as its data changes. If a save moves the card out of view, the board confirms that the task was saved and explains how to reveal it. Changing guests remounts the workspace, clears the filter state, and leaves existing stale-response guards in place.

The opt-in `NEXTPLAY_LIVE_FILTERS=1 node --test tests/board.test.mjs` check creates three uniquely named tasks through the UI, combines search with priority and status, and clears the filters. It checks that filtering caused no task requests, compares the saved rows after refresh, and removes only the three fixtures through the owning session with readback.

### Board verification

Run `node --test tests/board.test.mjs` on a Node.js version supported by Vite with Chrome installed. Set `CHROME_BIN` if Chrome is in a different location. The default browser test simulates the auth state and task service while rendering the real app in Strict Mode. Use `NEXTPLAY_LIVE_BOARD=1 node --test tests/board.test.mjs` to opt into a fresh guest on the configured project and verify a successful read-only task request and empty board. The live check creates an anonymous Auth identity and makes no task writes.

## 7. TypeScript data models

| Type or field | Conceptual shape |
| --- | --- |
| `TaskStatus` | One of `todo`, `in_progress`, `in_review`, `done` |
| `TaskPriority` | One of `low`, `normal`, `high` |
| `Task.id`, `Task.user_id` | Required UUID strings |
| `Task.title` | Required nonblank string |
| `Task.status` | Required `TaskStatus` |
| `Task.created_at` | Required timestamp string from PostgreSQL `timestamptz` |
| `Task.description` | Present on the row as a string or null |
| `Task.priority` | Required `TaskPriority`. The database defaults to `normal`. |
| `Task.due_date` | Present on the row as a YYYY-MM-DD calendar string or null |

`CreateTaskInput` requires a title and supports optional description, status, priority and due date. `UpdateTaskInput` supports partial changes to those same fields. Both inputs derive from `Task`; the service maintains the allowlist at runtime. Keep due dates as calendar strings and use local calendar dates for urgency comparisons.

## 8. Drag-and-drop data flow

With `@dnd-kit/react` 0.5.3, `DragDropProvider` runs the `PointerSensor` for mouse, pen and touch, `useDraggable` registers each card by task UUID, `useDroppable` registers each status column, and `DragOverlay` previews the dragged card. Empty columns are full drop targets. Column feedback uses the library's collision detection. On release, the board checks the actual pointer location and validates the containing column's status. Same-column, canceled, and off-board drops cause no writes. [dnd-kit React quickstart](https://dndkit.com/react/quickstart/)

Use the grip to drag without opening the edit dialog. Touch dragging starts with a short hold on the grip. Scrolling remains available outside the grip. Keyboard users and anyone moving a card to a column outside the viewport can use the card's **Move to…** control. Activating the grip with the keyboard focuses that control. The board announces confirmed moves and failures and restores keyboard focus to the move control or its column when appropriate.

Both inputs call `updateTask(taskId, { status }, expectedGuestId)`. The card stays in the source column while saving. The returned row updates the same task ID and the visible counts. A pending move locks that task against further moves and edits, while other tasks remain interactive. A request started before a confirmed move cannot restore its earlier status. The guest-keyed workspace drops pending UI state when the guest changes.

Search and filters remain active, including when the destination has no visible cards. A status filter may hide the card after a successful move. The board confirms the saved destination and explains how to reveal the card. A failed move leaves the original card in place. If the connection interrupts confirmation, the guest sees a persistent **Refresh Board** notice. Search, filters and unrelated task operations leave it in place. A failed refresh offers another attempt. A successful fetch clears only uncertainty that existed when that fetch started. **Dismiss** hides the notice without changing tasks. Guest changes discard the old workspace and its recovery state.

Run `NEXTPLAY_LIVE_DRAG=1 node --test tests/board.test.mjs` for the controlled live verification. The browser creates a unique fixture, drags it forward and backward through empty columns under an active priority filter, verifies the saved status after refresh and isolation from another guest, and removes the fixture with its owner's session.

## 9. Error-handling approach

| Situation | User-facing behavior |
| --- | --- |
| Authentication startup | Show “Starting your guest session…” while pending. On failure, explain that the session could not start and offer Retry. |
| Board fetch or connection failure | Show “Couldn’t load your tasks” and offer Retry. Distinguish a failed request from a successful empty result. |
| Task creation | Show field-level validation and preserve the draft on failure. Disable repeat submits while pending. On an uncertain result, reload first and let the user check whether the task exists before resubmitting. |
| Task move | Restore the card and show “Couldn’t save the move.” If reconciliation is needed, offer to reload when automatic reload fails. |
| Empty list or filtered result | Show a create prompt for a new board and a clear-filters action for zero matches. Keep the columns visible. |
| Loading | Show explicit startup and board-loading feedback. Confine saving feedback to the form or affected card during ordinary writes. |

Render short, actionable messages and announce state changes where appropriate. Keep raw Supabase errors, tokens and task contents out of user-visible diagnostics.

## 10. Environment configuration

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL used by the browser client |
| `VITE_SUPABASE_ANON_KEY` | Public anon key for the same project |

Commit `.env.example` with empty placeholders. Use `.env.local` for local values and configure the equivalents on Vercel for the intended build environments. Validate both values before client startup. Vite embeds these values in the frontend bundle, so enforce authorization through database grants and RLS. Keep service-role keys out of the browser, repository and build environment. [Vite environment variables](https://vite.dev/guide/env-and-mode) · [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)

When setting up Git, ignore `.env`, `.env.*`, `node_modules/`, `dist/` and the root `/assessment.pdf`. Place an exception for `!.env.example` after the environment ignore patterns. Check the staged file list before the first commit.

### Production build settings

Select **Vite** in Vercel and use the repository root, the default npm install command, `npm run build`, and output directory `dist`. Select Node.js 26.x to match the locally verified major version. Set both public variables above for Production and for any Preview deployment that should connect to Supabase. Use the HTTPS project root URL. The only application route is `/`.

Verify anonymous sign-in is enabled for the Supabase project behind the build. This sign-in flow makes a direct Auth request and requires no OAuth redirect configuration. Before sharing the deployment, open the root in a fresh browser and check sign-in, the empty board, an owned task change, and session restoration. [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) · [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)

## 11. Architecture decisions and trade-offs

- **Direct browser access.** Supabase provides auth and persistence, while grants and RLS are the authorization boundary. The app uses a single static Vite build.
- **One board feature.** Keep components focused, with descriptive props and callbacks. Centralize queries in the task service and keep request state in the hook so UI behavior can be tested independently of Supabase.
- **One task collection.** Derive columns, filters and statistics from it. Use the drag preview for feedback and merge returned rows for confirmed moves. Reload after ambiguous writes. Cross-device synchronization and manual reordering are deferred.
- **Persisted browser guest.** Refreshes and browser restarts can restore the same guest while the SDK's browser storage remains available. Clearing that storage or opening another browser starts a separate board.

## 12. Implementation notes for upcoming tasks

1. During scaffolding, pick compatible React, Vite and Tailwind versions and use one dnd-kit API family. This plan targets the documented `@dnd-kit/react` API. Record exact versions in the lockfile.
2. Build the four-column layout against sample data. Define status and priority once, then align the database constraints with those values.
3. Apply the schema and RLS SQL from `supabase/` before connecting a new project to the board. Verify same-browser restoration, separate guest ownership, forged-owner inserts and denied unauthenticated requests against Supabase.
4. Verify task creation and move persistence, including empty-column drops, touch and keyboard interactions, and failure recovery. Search and filtering are implemented. Due-date urgency indicators and additional statistics remain optional.
5. Smoke-test the production build in a fresh browser and verify Vercel environment settings. Repository visibility remains open. A private repository link should be checked for reviewer access before submission.
