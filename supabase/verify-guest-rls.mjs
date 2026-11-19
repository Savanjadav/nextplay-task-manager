import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const fields = 'id,user_id,title,status'
const permissionDenied = '42501'
const runId = randomUUID()
const attempted = new Map()
const guests = []

class VerificationError extends Error {}

function check(condition, message) {
  if (!condition) throw new VerificationError(message)
}

function safeCode(error) {
  const code = error?.code ?? error?.status ?? 'unknown'
  return /^[a-zA-Z0-9_-]{1,48}$/.test(String(code)) ? code : 'unknown'
}

function rows(result, label) {
  check(!result.error && Array.isArray(result.data), label + ' failed (' + safeCode(result.error) + ')')
  return result.data
}

function denied(result, label, allowEmpty = false) {
  const permissionError = result.error?.code === permissionDenied
  const empty = !result.error && Array.isArray(result.data) && result.data.length === 0
  check(permissionError || (allowEmpty && empty), label + ' was not safely denied (' + safeCode(result.error) + ')')
  return permissionError ? permissionDenied : 'zero rows'
}

function config() {
  const [flag, expectedHost, ...extra] = process.argv.slice(2)
  check(flag === '--live' && expectedHost && extra.length === 0,
    'Usage: node --env-file=.env.local supabase/verify-guest-rls.mjs --live <expected-project-host>')

  const url = URL.parse(process.env.VITE_SUPABASE_URL?.trim() ?? '')
  check(url?.protocol === 'https:' && url.host === expectedHost && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash,
  'The configured HTTPS Supabase URL must match the independently supplied project host.')

  const key = process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''
  let role
  if (key.split('.').length === 3) {
    try {
      role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role
    } catch {
      // The public-key check below handles malformed keys.
    }
  }
  check(/^sb_publishable_[\w-]+$/.test(key) || role === 'anon', 'A Supabase publishable or legacy anon key is required.')
  return { url: url.origin, key }
}

function client({ url, key }) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(15000) }) },
  })
}

async function signIn(settings, label) {
  const api = client(settings)
  const { data, error } = await api.auth.signInAnonymously()
  check(!error && data.session && data.user?.is_anonymous === true &&
    data.user.role === 'authenticated' && data.session.user.id === data.user.id,
  'Guest ' + label + ' anonymous sign-in failed (' + safeCode(error) + ')')
  const guest = { api, id: data.user.id, label }
  guests.push(guest)
  return guest
}

function taskQuery(api, id) {
  return api.from('tasks').select(fields).eq('id', id)
}

function insertFixture(api, ownerId, label) {
  const task = { id: randomUUID(), title: 'Task 4.2 RLS test ' + runId + ' ' + label, user_id: ownerId }
  attempted.set(task.id, task.title)
  return { task, result: api.from('tasks').insert(task).select(fields) }
}

async function expectTask(api, task, status, label) {
  const result = rows(await taskQuery(api, task.id), label)
  check(result.length === 1 && result[0].id === task.id && result[0].user_id === task.user_id &&
    result[0].title === task.title && result[0].status === status, label + ' had unexpected persisted values')
}

async function expectGone(api, task, label) {
  check(rows(await taskQuery(api, task.id), label).length === 0, label + ' still found the task')
}

async function verify(settings) {
  const a = await signIn(settings, 'A')
  const b = await signIn(settings, 'B')
  check(a.id !== b.id, 'Guest A and Guest B received the same identity')
  const pairs = [[a, b], [b, a]]
  console.log('PASS Auth: separate clients received distinct anonymous authenticated users')

  const fixtures = new Map()
  for (const [owner, other] of pairs) {
    const { task, result } = insertFixture(owner.api, owner.id, owner.label)
    const inserted = rows(await result, owner.label + ' own INSERT')
    check(inserted.length === 1 && inserted[0].id === task.id && inserted[0].user_id === owner.id,
      owner.label + ' own INSERT did not return the expected row')
    fixtures.set(owner, task)
    const forged = insertFixture(owner.api, other.id, owner.label + ' foreign owner')
    denied(await forged.result, owner.label + ' cross-owner INSERT')
    await expectGone(other.api, forged.task, owner.label + ' cross-owner INSERT readback')
  }
  console.log('PASS INSERT: both own inserts succeeded; both cross-owner inserts rejected (42501)')

  for (const [owner, other] of pairs) {
    await expectTask(owner.api, fixtures.get(owner), 'todo', owner.label + ' own SELECT')
    await expectGone(other.api, fixtures.get(owner), other.label + ' cross-owner SELECT')
  }
  console.log('PASS SELECT: both owners saw only their own fixture; cross-owner reads returned zero rows')

  for (const [owner, other] of pairs) {
    const task = fixtures.get(owner)
    const target = owner.label + ' UPDATE'
    const updated = rows(await owner.api.from('tasks').update({ status: 'in_progress' }).eq('id', task.id).select(fields), target)
    check(updated.length === 1 && updated[0].id === task.id && updated[0].status === 'in_progress', target + ' did not return the updated row')
    const foreign = await other.api.from('tasks').update({ status: 'done' }).eq('id', task.id).select('id')
    const outcome = denied(foreign, other.label + ' cross-owner UPDATE', true)
    const transfer = await owner.api.from('tasks').update({ user_id: other.id }).eq('id', task.id).select('id')
    denied(transfer, owner.label + ' ownership transfer')
    await expectTask(owner.api, task, 'in_progress', target + ' readback')
    await expectGone(other.api, task, owner.label + ' transfer readback')
    console.log('PASS UPDATE for guest ' + owner.label + ': own change persisted; cross-owner attempt returned ' + outcome + '; transfer rejected (42501)')
  }

  for (const [owner, other] of pairs) {
    const task = fixtures.get(owner)
    const result = rows(await other.api.from('tasks').delete().eq('id', task.id).select('id'), other.label + ' cross-owner DELETE')
    check(result.length === 0, other.label + ' cross-owner DELETE affected a row')
    await expectTask(owner.api, task, 'in_progress', owner.label + ' cross-owner DELETE readback')
  }
  console.log('PASS cross-owner DELETE: both returned zero rows and owners still saw their tasks')

  const anon = client(settings)
  const session = await anon.auth.getSession()
  check(!session.error && !session.data.session, 'The signed-out client unexpectedly has a session')
  const ids = [...fixtures.values()].map(({ id }) => id)
  const anonRead = denied(await anon.from('tasks').select('id').in('id', ids), 'Unauthenticated SELECT', true)
  const anonInsert = insertFixture(anon, a.id, 'signed-out insert')
  const insertOutcome = denied(await anonInsert.result, 'Unauthenticated INSERT')
  await expectGone(a.api, anonInsert.task, 'Unauthenticated INSERT readback')
  const updateOutcome = denied(await anon.from('tasks').update({ status: 'done' }).in('id', ids).select('id'), 'Unauthenticated UPDATE', true)
  const deleteOutcome = denied(await anon.from('tasks').delete().in('id', ids).select('id'), 'Unauthenticated DELETE', true)
  for (const [owner, task] of fixtures) await expectTask(owner.api, task, 'in_progress', 'Unauthenticated mutation readback')
  console.log('PASS signed-out access: SELECT ' + anonRead + ', INSERT ' + insertOutcome +
    ', UPDATE ' + updateOutcome + ', DELETE ' + deleteOutcome)

  for (const [owner, task] of fixtures) {
    const deleted = rows(await owner.api.from('tasks').delete().eq('id', task.id).select('id'), owner.label + ' own DELETE')
    check(deleted.length === 1 && deleted[0].id === task.id, owner.label + ' own DELETE did not return its row')
    await expectGone(owner.api, task, owner.label + ' own DELETE readback')
  }
  console.log('PASS own DELETE: both owners removed their fixture and confirmed it was gone')
}

async function cleanup() {
  const unconfirmed = new Set()
  for (const [id, title] of attempted) {
    for (const { api } of guests) {
      try {
        const deletion = await api.from('tasks').delete().eq('id', id).eq('title', title).select('id')
        const readback = await taskQuery(api, id)
        if (deletion.error || readback.error || readback.data?.length !== 0) unconfirmed.add(id)
      } catch {
        unconfirmed.add(id)
      }
    }
  }
  if (unconfirmed.size) {
    console.error('Cleanup could not be confirmed for task IDs ' + [...unconfirmed].join(', '))
    process.exitCode = 1
  } else if (attempted.size) {
    console.log('PASS cleanup: checked all ' + attempted.size + ' attempted fixture IDs with both guests')
  }
}

try {
  await verify(config())
} catch (error) {
  console.error(error instanceof VerificationError ? error.message : 'Unexpected verification error. Raw details suppressed.')
  process.exitCode = 1
} finally {
  await cleanup()
}
