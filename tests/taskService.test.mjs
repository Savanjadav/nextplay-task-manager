import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, beforeEach, test } from 'node:test'
import { AuthRetryableFetchError, AuthSessionMissingError, createClient } from '@supabase/supabase-js'

const ownerId = '76500000-0000-4000-8000-000000000001'
const taskId = '76500000-0000-4000-8000-000000000002'
const otherOwnerId = '76500000-0000-4000-8000-000000000003'
const task = {
  id: taskId,
  user_id: ownerId,
  title: 'Review work',
  description: null,
  status: 'todo',
  priority: 'normal',
  due_date: null,
  created_at: '2026-11-14T12:00:00Z',
}

let requests
let responses
const clientSlot = Symbol.for('nextplay.taskService.testClient')
const client = createClient('https://task-service.invalid', 'sb_publishable_test', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    async fetch(input, options) {
      requests.push({
        url: new URL(input),
        method: options.method,
        headers: new Headers(options.headers),
        body: options.body ? JSON.parse(options.body) : undefined,
      })
      const response = responses.shift()
      if (!response) throw new Error('Unexpected request')
      return response()
    },
  },
})
globalThis[clientSlot] = client

// Swap only the singleton client. The actual SDK constructs and decodes each Data API request.
const serviceUrl = new URL('../src/features/tasks/taskService.ts', import.meta.url).href
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === serviceUrl && specifier === '../../lib/supabase') {
      return { url: 'data:text/javascript,export const supabase = globalThis[Symbol.for("nextplay.taskService.testClient")]', shortCircuit: true }
    }
    if (context.parentURL === serviceUrl && specifier === '../../types/task') {
      return nextResolve(specifier + '.ts', context)
    }
    return nextResolve(specifier, context)
  },
})
const { createTask, deleteTask, getTasks, updateTask, TaskServiceError } = await import(serviceUrl)

after(() => {
  hooks.deregister()
  delete globalThis[clientSlot]
})

beforeEach(() => {
  client.auth.getUser = async () => ({ data: { user: { id: ownerId } }, error: null })
  requests = []
  responses = []
})

function reply(body, status = 200, headers) {
  responses.push(() => Response.json(body, { status, headers }))
}

function errorCode(code) {
  return (error) => error instanceof TaskServiceError && error.code === code
}

function assertOwnerFilter(request, method) {
  assert.equal(request.method, method)
  assert.equal(request.url.pathname, '/rest/v1/tasks')
  assert.equal(request.url.searchParams.get('user_id'), 'eq.' + ownerId)
}

function assertTargetFilter(request, method, id = taskId) {
  assertOwnerFilter(request, method)
  assert.equal(request.url.searchParams.get('id'), 'eq.' + id)
}

test('fetches every owner-scoped page in deterministic order', async () => {
  const tied = { ...task, id: otherOwnerId }
  reply([task], 206, { 'content-range': '0-0/2' })
  reply([tied], 206, { 'content-range': '1-1/2' })
  assert.deepEqual(await getTasks(), [task, tied])
  assert.equal(requests.length, 2)
  for (const [offset, request] of requests.entries()) {
    assertOwnerFilter(request, 'GET')
    assert.equal(request.url.searchParams.get('order'), 'created_at.desc,id.asc')
    assert.equal(request.url.searchParams.get('offset'), String(offset))
    assert.match(request.headers.get('prefer'), /count=exact/)
  }
})

test('every operation requires authentication before querying tasks', async () => {
  client.auth.getUser = async () => ({ data: { user: null }, error: new AuthSessionMissingError() })
  for (const operation of [getTasks, () => createTask({ title: task.title }),
    () => updateTask(taskId, { title: task.title }), () => deleteTask(taskId)]) {
    await assert.rejects(operation, errorCode('auth_required'))
  }
  assert.equal(requests.length, 0)
})

test('auth network failures are reported separately from a missing session', async () => {
  client.auth.getUser = async () => ({ data: { user: null }, error: new AuthRetryableFetchError('internal detail', 0) })
  await assert.rejects(getTasks, errorCode('network_error'))
  assert.equal(requests.length, 0)
})

test('database and transport errors are classified without exposing raw details', async () => {
  reply({ code: '42501', message: 'internal database detail' }, 403)
  await assert.rejects(getTasks, (error) => errorCode('request_failed')(error) && !error.message.includes('internal'))
  responses.push(() => { throw new TypeError('internal network detail') })
  await assert.rejects(createTask({ title: task.title }), (error) => (
    errorCode('network_error')(error) && !error.message.includes('internal')
  ))
})

test('create trims the title, uses the authenticated owner, and leaves defaults to the database', async () => {
  reply(task, 201)
  assert.deepEqual(await createTask({ title: '  Review work  ', priority: undefined }), task)
  assert.equal(requests[0].method, 'POST')
  assert.deepEqual(requests[0].body, { title: task.title, user_id: ownerId })
})

test('create accepts valid status, priority, calendar date and 200 Unicode characters', async () => {
  const title = '😀'.repeat(200)
  const created = { ...task, title, description: 'Details', status: 'in_progress', priority: 'high', due_date: '2028-02-29' }
  reply(created, 201)
  assert.deepEqual(await createTask({
    title, description: ' Details ', status: 'in_progress', priority: 'high', due_date: '2028-02-29',
  }), created)
  assert.deepEqual(requests[0].body, {
    title, user_id: ownerId, description: 'Details', status: 'in_progress', priority: 'high', due_date: '2028-02-29',
  })
})

test('create rejects invalid fields and caller-supplied ownership before querying tasks', async () => {
  for (const input of [{}, { title: '  \n ' }, { title: 'x'.repeat(201) },
    { title: task.title, status: 'backlog' }, { title: task.title, status: null },
    { title: task.title, priority: 'urgent' }, { title: task.title, priority: '' },
    { title: task.title, due_date: '2026-02-29' }, { title: task.title, due_date: '2026-10-10T00:00:00Z' },
    { title: task.title, due_date: '0000-01-01' }, { title: task.title, user_id: otherOwnerId }]) {
    await assert.rejects(() => createTask(input), errorCode('invalid_input'))
  }
  assert.equal(requests.length, 0)
})

test('update normalizes cleared fields, targets the current owner and returns the updated record', async () => {
  const updated = { ...task, status: 'done' }
  reply([updated])
  assert.deepEqual(await updateTask(taskId, { status: 'done', description: ' ', due_date: null }), updated)
  assertTargetFilter(requests[0], 'PATCH')
  assert.deepEqual(requests[0].body, { status: 'done', description: null, due_date: null })
})

test('update rejects empty, invalid, and immutable fields as well as invalid IDs', async () => {
  for (const input of [{}, { title: undefined }, { title: '' }, { due_date: '2026-11-31' },
    { status: 'unknown' }, { priority: null }, { description: 123 },
    { id: taskId }, { user_id: otherOwnerId }, { created_at: task.created_at }, { arbitrary: true }]) {
    await assert.rejects(() => updateTask(taskId, input), errorCode('invalid_input'))
  }
  await assert.rejects(() => updateTask('invalid', { title: task.title }), errorCode('invalid_input'))
  assert.equal(requests.length, 0)
})

test('update treats an empty returned result as missing or inaccessible', async () => {
  reply([])
  await assert.rejects(() => updateTask(taskId, { title: task.title }), errorCode('not_found'))
  assertTargetFilter(requests[0], 'PATCH')
})

test('delete confirms an affected row and reports false for missing or cross-owner IDs', async () => {
  reply([{ id: taskId }])
  reply([])
  reply([])
  assert.deepEqual(await deleteTask(taskId), { deleted: true })
  assert.deepEqual(await deleteTask(taskId), { deleted: false })
  assert.deepEqual(await deleteTask(otherOwnerId), { deleted: false })
  assertTargetFilter(requests[0], 'DELETE')
  assertTargetFilter(requests[1], 'DELETE')
  assertTargetFilter(requests[2], 'DELETE', otherOwnerId)
  await assert.rejects(() => deleteTask('invalid'), errorCode('invalid_input'))
  assert.equal(requests.length, 3)
})

test('create rejects a changed guest before sending an INSERT', async () => {
  await assert.rejects(() => createTask({ title: task.title }, otherOwnerId), errorCode('auth_required'))
  assert.equal(requests.length, 0)
})

test('update rejects a changed guest before sending a PATCH', async () => {
  await assert.rejects(() => updateTask(taskId, { title: task.title }, otherOwnerId), errorCode('auth_required'))
  assert.equal(requests.length, 0)
})

test('delete rejects a changed guest before sending a DELETE', async () => {
  await assert.rejects(() => deleteTask(taskId, otherOwnerId), errorCode('auth_required'))
  assert.equal(requests.length, 0)
})

test('refresh rejects a changed guest before reading tasks', async () => {
  await assert.rejects(() => getTasks(otherOwnerId), errorCode('auth_required'))
  assert.equal(requests.length, 0)
})
