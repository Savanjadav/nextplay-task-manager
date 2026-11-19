# Supabase setup and verification

This directory contains the initial task schema, ownership policies, read-only inspection queries, and an opt-in live isolation verifier. See the root [README](../README.md#local-setup) for environment configuration and application commands.

## Initial database setup

Use a new Supabase project and inspect each script before running it in the SQL Editor. These are initial-setup scripts, not idempotent migrations: they deliberately stop on an existing table, existing policies, or unexpected grants. No browser app code runs these scripts automatically.

1. Run the entire [schema.sql](schema.sql) script as one query. It creates `public.tasks`, its constraints, the `(user_id, status)` index, and enables RLS in one transaction. It does not add ownership policies or browser-role CRUD grants.
2. Run [verify_schema.sql](verify_schema.sql) and compare columns, nullability, defaults, constraints and indexes with the schema. Run [verify_rls.sql](verify_rls.sql) as a read-only security preflight.
3. Before applying policies, expect zero policies, zero explicit column grants, and no effective task privileges for `anon` or `authenticated`. The policy script permits only the table owner's grants and reviewed, non-grantable `service_role` privileges (`REFERENCES`, `TRIGGER`, `TRUNCATE`, or `MAINTAIN`). Supabase default privileges can vary between projects. If the preflight finds unexpected privileges, stop and review them with the database administrator; do not bypass the safeguards or add broad grants to make the script run.
4. Run the complete [rls_policies.sql](rls_policies.sql) transaction. It repeats the security preflight under a table lock, grants schema usage if needed, grants SELECT/INSERT/UPDATE/DELETE to `authenticated`, and creates the four ownership policies.
5. Rerun both read-only verification scripts. In the RLS results, expect four policies with `expected_policy` true. Check SELECT and DELETE `qual`, INSERT `with_check`, and both expressions for UPDATE. Each should compare `auth.uid()` with `user_id`; PostgreSQL may add casts or parentheses in displayed expressions.
6. Confirm `authenticated` has schema usage and the four CRUD privileges without grant options. `anon` must have no task privileges, and neither browser role may have TRUNCATE, REFERENCES or TRIGGER. Expect no explicit column grants or grants to `PUBLIC`. Compare allowed `service_role` privileges against the preflight.
7. Enable **anonymous sign-ins** in Supabase Authentication settings. Copy the HTTPS project-root URL and publishable or legacy anonymous key into `.env.local`, using the names in [.env.example](../.env.example). Start the application from the repository root.

If `public.tasks` already exists, inspect it instead of rerunning creation. If policies already exist, inspect them rather than adding duplicates. Both mutation scripts roll back on error. Changes to an existing database should be planned as a separate migration.

## Data model and ownership

Tasks have generated UUID IDs, a required nonblank title of at most 200 characters, an owner in `auth.users`, a creation timestamp, one of four statuses, and a required priority defaulting to `normal`. Description and due date are nullable. Status defaults to `todo`. Deleting an Auth user cascades to that user's tasks. See [schema.sql](schema.sql) for the exact constraints.

SQL privileges allow operations; RLS controls the rows those operations can access. Anonymous sign-in gives each guest a unique user ID and the `authenticated` role. A signed-out request uses `anon`. SELECT and DELETE apply an ownership filter, INSERT checks the new owner, and UPDATE checks both the existing and resulting row. This prevents both taking another guest's task and transferring an owned task to another guest.

The public client key remains subject to grants and RLS. Keep service-role keys, Supabase secret keys and database passwords out of frontend configuration because privileged credentials can bypass that authorization boundary. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Live guest isolation verification

Run the [standalone verifier](verify-guest-rls.mjs) from the project root with anonymous sign-ins enabled and the existing public configuration in `.env.local`. Use Node.js 22.15 or later on a compatible release. Independently obtain the project hostname from the intended Supabase project's dashboard and replace the placeholder below. Do not include the protocol or a path.

```sh
node --env-file=.env.local supabase/verify-guest-rls.mjs --live <expected-project-host>
```

The verifier requires explicit live opt-in and refuses a hostname mismatch before making requests. Prefer a dedicated test project. It creates two anonymous guest accounts, a signed-out client, and uniquely named task fixtures. It checks persisted readbacks and attempts to remove its own task fixtures afterward. Cleanup failures report the affected fixture IDs; guest Auth accounts remain after the run.

The earlier live verification recorded these results; this table is not a claim that every future database configuration passes:

| Live Data API check | Observed result |
| --- | --- |
| Guest sessions | Both users were anonymous, had distinct IDs, and used the `authenticated` role. |
| INSERT | Both guests inserted their own tasks. Both attempts to insert with the other guest's ID failed with `42501`. |
| SELECT | Both owners could read their own task. Cross-owner reads returned zero rows. |
| UPDATE | Both owners' updates persisted. Cross-owner updates returned zero rows. Both ownership transfers failed with `42501`, and readback confirmed the original owners and statuses. |
| DELETE | Cross-owner deletes returned zero rows and both tasks remained visible to their owners. Both own deletes returned the deleted row, and readback found no remaining rows. |
| Signed-out access | SELECT, INSERT, UPDATE and DELETE each failed with `42501`. Owner readback confirmed the tasks were unchanged. |
| Cleanup | Both inserted tasks were removed. Neither guest could find any of the five attempted fixture IDs after cleanup. |

Zero rows is an expected denial when RLS hides a target from SELECT, UPDATE or DELETE. Check returned rows and read back the target as its owner when validating a denied mutation.

## Application verification

The production browser smoke test verified anonymous startup, same-browser restoration, CRUD, pointer and keyboard moves, persistence after refresh, and separation between two guest contexts. Its temporary tasks were deleted. Hosted network-interruption recovery, physical-device testing and screen-reader walkthroughs were not performed.

The default browser regression suite simulates Auth and task-service responses. Optional live modes use the configured Supabase project and create real guest accounts. See the root [testing instructions](../README.md#testing) and the [architecture authentication walkthrough](../docs/ARCHITECTURE.md#guest-authentication-verification) for commands and manual checks.
