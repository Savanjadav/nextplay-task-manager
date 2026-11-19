# Tasks schema setup

1. Open the Supabase dashboard, select the intended project and open **SQL Editor**.
2. Open a **New query** and paste [schema.sql](schema.sql). Review the complete script and run it as one query. Table creation, RLS and indexing run in a single transaction.
3. If the editor reports that `public.tasks` already exists, stop and inspect it using [verify_schema.sql](verify_schema.sql). The creation script rolls back on error. Review any differences before planning a separate migration.
4. In a new query, paste and run [verify_schema.sql](verify_schema.sql). Confirm that the table exists and RLS is enabled. Compare the columns, nullability, defaults, constraints and indexes with the creation script. The policy and browser-role grant queries should return zero rows at this stage.

A title must contain at least one non-whitespace character and may contain up to 200 characters. PostgreSQL supplies the ID, initial status, priority and creation time. Leaving priority out of an insert gives it the default `normal`. Tasks reference the owning Supabase Auth user and are removed if that user is deleted. The composite index supports owner-only and owner-plus-status lookups.

RLS is enabled in the same transaction that creates the table. Without policies, ordinary browser roles cannot access task rows. The project has automatic table exposure disabled, so this setup adds no Data API grants. Use a publishable key in the browser to keep requests subject to grants and RLS. Keep secret and service-role keys out of frontend code because they bypass RLS. [Supabase data access](https://supabase.com/docs/guides/database/secure-data)

## Task ownership policies

The original preflight rejected every explicit table grant to a role other than the table owner. The inspection found `REFERENCES`, `TRIGGER` and `TRUNCATE` for `anon`, `authenticated` and `service_role`. The browser-role grants also failed the effective privilege checks. PostgreSQL applies `TRUNCATE` to the whole table outside row-level policies, so browser roles must have no such privilege.

The updated check accepts the three reviewed `service_role` table privileges without grant options. It leaves those grants in place and checks browser-role privileges separately, including permissions acquired through role membership or `PUBLIC`. Unexpected table grants, column grants, and effective browser privileges still stop execution.

1. In the intended project's SQL Editor, run [verify_rls.sql](verify_rls.sql) as a read-only preflight. Confirm the table exists and RLS is enabled. Expect zero policies and zero column grants. The only allowed explicit non-owner table grants are the reviewed `service_role` entries. Verify that every task privilege for both browser roles is false. If earlier revocations have yet to be confirmed, use these results to confirm them. Stop and inspect any unexpected result.
2. In a new query, review and run the entire [rls_policies.sql](rls_policies.sql) script. The transaction repeats the security checks before applying the policies and grants.
3. Run the verification script again. Expect four policies, each with `expected_policy` true. Inspect `qual` for the SELECT and DELETE ownership filters, `with_check` for the INSERT ownership check, and both fields for UPDATE. Each applicable expression should compare the result of `auth.uid()` with `user_id`. PostgreSQL may add parentheses, casts or an alias when displaying the expressions.
4. Confirm that the only new grants are SELECT, INSERT, UPDATE and DELETE to `authenticated`, all without grant options. Compare the `service_role` rows with the preflight output. Expect `authenticated` to have schema usage and all four CRUD permissions, `anon` to have zero task privileges, and neither browser role to have TRUNCATE, REFERENCES or TRIGGER. Expect zero explicit column grants and zero grants to `PUBLIC`.

SQL privileges permit an operation and RLS decides which rows it may affect. `auth.uid()` identifies the signed-in user. Supabase anonymous sign-in gives the guest a unique user ID and the `authenticated` role. A request without a session uses `anon`. A frontend publishable key remains subject to both the database grants and RLS. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

Task 3.3 uses table-level UPDATE as requested. The owner check on the current row prevents taking someone else's task. The check on the resulting row prevents transferring an owned task to another user. This version also grants owner-only DELETE. Both privileges apply at the API layer once the SQL is run.

### Task 4.2 live guest isolation verification

Run the [standalone verifier](verify-guest-rls.mjs) from the project root with anonymous sign-ins enabled. Use Node.js 22 or later and the existing public values in `.env.local`. Replace the placeholder with the hostname from the intended Supabase project's dashboard Connect dialog. The verifier requires explicit live opt-in and refuses a host mismatch before making requests.

```sh
node --env-file=.env.local supabase/verify-guest-rls.mjs --live <expected-project-host>
```

The verifier uses two separate anonymous Auth clients and a third client with no session. It creates uniquely named task fixtures, checks returned rows and persisted values, and checks cleanup under both guest sessions. If cleanup cannot be confirmed, the verifier reports the affected fixture IDs. Guest Auth accounts remain in Supabase after the run.

| Live Data API check | Observed result |
| --- | --- |
| Guest sessions | Both users were anonymous, had distinct IDs, and used the `authenticated` role. |
| INSERT | Both guests inserted their own tasks. Both attempts to insert with the other guest's ID failed with `42501`. |
| SELECT | Both owners could read their own task. Cross-owner reads returned zero rows. |
| UPDATE | Both owners' updates persisted. Cross-owner updates returned zero rows. Both ownership transfers failed with `42501`, and readback confirmed the original owners and statuses. |
| DELETE | Cross-owner deletes returned zero rows and both tasks remained visible to their owners. Both own deletes returned the deleted row, and readback found no remaining rows. |
| Signed-out access | SELECT, INSERT, UPDATE and DELETE each failed with `42501`. Owner readback confirmed the tasks were unchanged. |
| Cleanup | Both inserted tasks were removed. Neither guest could find any of the five attempted fixture IDs after cleanup. |

Zero rows is an expected denial when RLS hides a target from SELECT, UPDATE or DELETE. Check returned rows and read back the target as its owner when validating a denied mutation. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

**Live browser results.** Headless Chrome used the configured Supabase project in separate browser contexts. First load made one signup request under React Strict Mode. Refresh kept the same guest ID and made no additional signup request. A separate context obtained a different guest ID. The header, mobile sidebar, Kanban board and development mock cards rendered. Blocking signup at the browser showed the error with Retry. Unblocking it and clicking Retry showed loading, then restored access to the board through a successful live signup. See the [browser steps](../docs/ARCHITECTURE.md#guest-authentication-verification) to repeat these checks.

**Other checks.** The script refused to run without opt-in or with a mismatched hostname. Build and lint passed. Task 4.2 used live Auth and Data API responses throughout, with a browser-side request block to induce the failure. No required manual checks remain.
