import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { test } from 'node:test'
import { createServer } from 'vite'

const live = process.env.NEXTPLAY_LIVE_BOARD === '1'
const liveEdit = process.env.NEXTPLAY_LIVE_EDIT === '1'
const liveDelete = process.env.NEXTPLAY_LIVE_DELETE === '1'
const liveFilters = process.env.NEXTPLAY_LIVE_FILTERS === '1'
const liveDrag = process.env.NEXTPLAY_LIVE_DRAG === '1'
const liveCreate = liveEdit || liveDelete || process.env.NEXTPLAY_LIVE_CREATE === '1'
const chrome = process.env.CHROME_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome')
const entry = '/__board-test-entry.js'
const mockService = '\0board-test-service'

const fixture = {
  name: 'board-test-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === entry) return '\0' + entry
    if (source === './taskService' && /\/src\/features\/tasks\/(useTasks\.ts|TaskDialog\.tsx)$/.test(importer ?? '')) {
      return mockService
    }
  },
  load(id) {
    if (id === mockService) {
      return `
        export class TaskServiceError extends Error {}
        window.boardTest.TaskServiceError = TaskServiceError
        export function deleteTask(id, guestId) {
          return new Promise((resolve, reject) => window.boardTest.deletes.push({ id, guestId, resolve, reject }))
        }
        export function updateTask(id, updates, guestId) {
          return new Promise((resolve, reject) => window.boardTest.updates.push({ id, updates, guestId, resolve, reject }))
        }
        export function createTask(input, guestId) {
          return new Promise((resolve, reject) => window.boardTest.creates.push({ input, guestId, resolve, reject }))
        }
        export function getTasks(guestId) {
          return new Promise((resolve, reject) => window.boardTest.requests.push({ guestId, resolve, reject }))
        }
      `
    }
    if (id === '\0' + entry) {
      return `
        import { createElement, StrictMode, useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import App from '/src/App.tsx'
        import { AuthContext } from '/src/features/auth/useAuth.ts'
        import '/src/index.css'

        window.boardTest = { requests: [], creates: [], updates: [], deletes: [] }
        function Fixture() {
          const [user, setUser] = useState('initializing')
          window.boardTest.setUser = setUser
          const auth = user === 'initializing' || user === 'error'
            ? { status: user, retry() {} }
            : { status: 'authenticated', session: { user: { id: user } }, retry() {} }
          return createElement(AuthContext, { value: auth }, createElement(App))
        }
        createRoot(document.querySelector('#root')).render(
          createElement(StrictMode, null, createElement(Fixture)),
        )
      `
    }
  },
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html.replace('/src/main.tsx', entry)
    },
  },
}

async function until(callback, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const result = await callback()
    if (result) return result
    await pause(75)
  }
  throw new Error('Timed out waiting for ' + label)
}

async function withBrowser(run) {
  const profile = await mkdtemp(join(tmpdir(), 'nextplay-board-'))
  let server
  let browser
  let socket
  try {
    server = await createServer({
      plugins: live || liveCreate || liveFilters || liveDrag ? [] : [fixture],
      cacheDir: join(profile, 'vite-cache'),
      server: { host: '127.0.0.1', port: 0, ws: false },
    })
    await server.listen()
    browser = spawn(chrome, [
      '--headless', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank',
    ], { stdio: 'ignore' })
    let launchError
    browser.on('error', (error) => { launchError = error })
    const debug = await until(() => {
      if (launchError) throw new Error('Chrome could not start. Set CHROME_BIN to its executable.')
      return readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')
    }, 'Chrome debug port')
    const [port, path] = debug.trim().split('\n')
    socket = new WebSocket('ws://127.0.0.1:' + port + path)
    await new Promise((resolve, reject) => {
      socket.onopen = resolve
      socket.onerror = reject
    })

    let id = 0
    const pending = new Map()
    const taskRequests = []
    const taskResponses = []
    const signupResponses = []
    const requestMethods = new Map()
    socket.onmessage = ({ data }) => {
      const event = JSON.parse(data)
      if (event.id) {
        const call = pending.get(event.id)
        pending.delete(event.id)
        if (event.error) call.reject(new Error('Chrome command failed'))
        else call.resolve(event.result)
      }
      if (event.method === 'Network.requestWillBeSent') {
        const { request, requestId } = event.params
        const pathname = new URL(request.url).pathname
        if (pathname === '/rest/v1/tasks' || pathname === '/auth/v1/signup') {
          requestMethods.set(requestId, request.method)
        }
        if (pathname === '/rest/v1/tasks' && request.method !== 'OPTIONS') {
          taskRequests.push(request.method)
        }
      }
      if (event.method === 'Network.responseReceived') {
        const response = event.params.response
        const pathname = new URL(response.url).pathname
        const method = requestMethods.get(event.params.requestId)
        if (pathname === '/rest/v1/tasks' && method === 'GET') taskResponses.push(response.status)
        if (pathname === '/auth/v1/signup' && method === 'POST') signupResponses.push(response.status)
      }
    }
    function call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const requestId = ++id
        pending.set(requestId, { resolve, reject })
        socket.send(JSON.stringify({ id: requestId, method, params, sessionId }))
      })
    }

    async function openPage(browserContextId) {
      const { targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
      async function evaluate(expression) {
        const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
        if (result.exceptionDetails) throw new Error('Browser assertion could not execute')
        return result.result.value
      }
      await call('Network.enable', {}, sessionId)
      await call('Page.navigate', { url: 'http://127.0.0.1:' + server.httpServer.address().port }, sessionId)
      return { evaluate, command: (method, params) => call(method, params, sessionId) }
    }
    const page = await openPage()
    await run({
      ...page, taskRequests, taskResponses, signupResponses,
      async openIsolatedPage() {
        const { browserContextId } = await call('Target.createBrowserContext')
        return openPage(browserContextId)
      },
    })
  } finally {
    socket?.close()
    if (browser?.pid && browser.exitCode === null) {
      const exited = once(browser, 'exit')
      browser.kill()
      await exited
    }
    await server?.close()
    await rm(profile, { recursive: true, force: true, maxRetries: 5 })
  }
}

const statuses = ['todo', 'in_progress', 'in_review', 'done']

function task(user, status, title) {
  return {
    id: title, user_id: user, status, title, description: null,
    priority: 'normal', due_date: null, created_at: '2026-11-14T12:00:00Z',
  }
}

const columnNames = 'Array.from(document.querySelectorAll("[id^=column-]"), node => node.textContent)'
const columnCounts = 'Array.from(document.querySelectorAll("[id^=column-]"), node => parseInt(node.nextElementSibling.textContent))'
const cardTitles = 'Array.from(document.querySelectorAll("article h3"), node => node.textContent)'
const hasBoard = 'Boolean(document.querySelector(\'[aria-label="Kanban board"]\'))'

test('guest board loads, groups, retries, and ignores stale results under Strict Mode', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate }) => {
    const hasText = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const requests = () => evaluate('boardTest.requests.length')
    const setUser = (user) => evaluate('boardTest.setUser(' + JSON.stringify(user) + ')')
    const resolve = (index, tasks) => evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(tasks) + ')')

    await until(() => hasText('Preparing your workspace'), 'auth loading')
    assert.equal(await requests(), 0)
    await setUser('error')
    await until(() => hasText('Unable to connect to your workspace'), 'auth error')
    assert.equal(await requests(), 0)

    await setUser('guest-a')
    await until(() => hasText('Loading your tasks'), 'task loading')
    await until(() => requests(), 'first task request')
    assert.equal(await hasText('No tasks yet'), false)
    assert.equal(await evaluate(hasBoard), false)
    assert.equal(await hasText('My Board'), true)
    const guestATasks = statuses.map((status) => task('guest-a', status, 'A ' + status))
    await resolve(0, [...guestATasks, task('guest-b', 'done', 'Foreign task')])
    await until(() => hasText('A done'), 'fetched cards')
    assert.equal(await requests(), 1)
    assert.deepEqual(await evaluate(columnCounts), [1, 1, 1, 1])
    for (const [index, status] of statuses.entries()) {
      const selector = '#column-' + status
      assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('section').querySelector('article h3').textContent`), guestATasks[index].title)
    }
    assert.equal(await hasText('Foreign task'), false)

    await setUser('guest-empty')
    await until(() => hasText('Loading your tasks'), 'loading after identity change')
    assert.deepEqual(await evaluate(cardTitles), [])
    await until(async () => await requests() === 2, 'empty guest request')
    await resolve(1, [])
    await until(() => hasText('Once you create tasks'), 'empty board')
    assert.deepEqual(await evaluate(columnNames), ['To Do', 'In Progress', 'In Review', 'Done'])
    assert.deepEqual(await evaluate(columnCounts), [0, 0, 0, 0])
    assert.deepEqual(await evaluate(cardTitles), [])

    await setUser('guest-error')
    await until(async () => await requests() === 3, 'failing request')
    await evaluate('boardTest.requests[2].reject(new Error("private response detail"))')
    await until(() => hasText('Unable to load your tasks'), 'task error')
    assert.equal(await hasText('private response detail'), false)
    assert.equal(await hasText('No tasks yet'), false)
    assert.equal(await evaluate(hasBoard), false)
    await evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === "Retry").click()')
    await until(async () => await requests() === 4, 'one retry')
    await resolve(3, [task('guest-error', 'todo', 'Recovered task')])
    await until(() => hasText('Recovered task'), 'retry success')

    await setUser('guest-slow')
    await until(async () => await requests() === 5, 'slow request')
    await setUser('guest-new')
    await until(async () => await requests() === 6, 'new guest request')
    await resolve(5, [task('guest-new', 'done', 'New guest task')])
    await until(() => hasText('New guest task'), 'new guest board')
    await resolve(4, [task('guest-slow', 'todo', 'Stale task')])
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.deepEqual(await evaluate(cardTitles), ['New guest task'])
    await setUser('error')
    await until(() => hasText('Unable to connect to your workspace'), 'session loss')
    assert.deepEqual(await evaluate(cardTitles), [])
    assert.equal(await requests(), 6)
  })
})

test('live anonymous guest sees an empty board after an authorized tasks GET', {
  skip: !live, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command, taskRequests, taskResponses, signupResponses, openIsolatedPage }) => {
    await until(() => evaluate(hasBoard), 'live board')
    assert.deepEqual(signupResponses, [200])
    assert.deepEqual(taskRequests, ['GET'])
    assert.deepEqual(taskResponses, [200])
    assert.deepEqual(await evaluate(columnNames), ['To Do', 'In Progress', 'In Review', 'Done'])
    assert.deepEqual(await evaluate(columnCounts), [0, 0, 0, 0])
    assert.deepEqual(await evaluate(cardTitles), [])
    assert.equal(await evaluate('document.body.innerText.includes("Once you create tasks")'), true)
    const guestId = `import('/src/lib/supabase.ts').then(async ({ supabase }) => (await supabase.auth.getSession()).data.session?.user.id)`
    const initialGuest = await evaluate(guestId)
    assert.ok(initialGuest)
    const beforeReload = await evaluate('performance.timeOrigin')
    await command('Page.reload', {})
    await until(async () => await evaluate('performance.timeOrigin') !== beforeReload &&
      await evaluate(newTaskEnabled), 'live restored board')
    assert.equal(await evaluate(guestId), initialGuest)
    assert.deepEqual(signupResponses, [200])
    const isolated = await openIsolatedPage()
    await until(() => isolated.evaluate(newTaskEnabled), 'isolated live guest')
    assert.ok(await isolated.evaluate(guestId))
    assert.notEqual(await isolated.evaluate(guestId), initialGuest)
    assert.deepEqual(await isolated.evaluate(cardTitles), [])
    assert.deepEqual(taskRequests, ['GET', 'GET', 'GET'])
  })
})

const creationOpen = 'Boolean(document.querySelector("dialog[open] form"))'
const newTaskEnabled = 'Array.from(document.querySelectorAll("button")).some(button => button.textContent.trim() === "New Task" && !button.disabled)'

function clickButton(evaluate, label) {
  return evaluate('Array.from(document.querySelectorAll("button")).find(button => button.textContent.trim() === ' + JSON.stringify(label) + ').click()')
}

function fillForm(evaluate, fields) {
  return evaluate(`
    for (const [name, value] of Object.entries(${JSON.stringify(fields)})) {
      document.querySelector('dialog[open] form').elements.namedItem(name).value = value
    }
  `)
}

async function pressKey(command, key, virtualKey) {
  await command('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, windowsVirtualKeyCode: virtualKey })
  if (key === 'Enter') {
    await command('Input.dispatchKeyEvent', { type: 'char', key, text: '\r', windowsVirtualKeyCode: virtualKey })
  }
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: virtualKey })
}

test('creation dialog validates, prevents duplicate submits, restores focus, and isolates guest changes', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command }) => {
    const textVisible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const creates = () => evaluate('boardTest.creates.length')
    const open = () => evaluate(creationOpen)
    const finishFetch = async (guest, index) => {
      await evaluate('boardTest.setUser(' + JSON.stringify(guest) + ')')
      await until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'guest load')
      await evaluate('boardTest.requests[' + index + '].resolve([])')
      await until(() => evaluate(newTaskEnabled), 'New Task enabled')
    }

    await until(() => textVisible('Preparing your workspace'), 'auth loading')
    assert.equal(await evaluate(newTaskEnabled), false)
    await finishFetch('guest-a', 0)
    await clickButton(evaluate, 'New Task')
    assert.equal(await open(), true)
    assert.equal(await evaluate('document.activeElement.name'), 'title')
    await pressKey(command, 'Tab', 9)
    assert.equal(await evaluate('document.activeElement.name'), 'description')

    for (const width of [320, 375, 768, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 550, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate(`(() => {
        const dialog = document.querySelector('dialog[open]')
        const action = dialog.querySelector('button[type=submit]').getBoundingClientRect()
        const rect = dialog.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight &&
          dialog.scrollWidth <= dialog.clientWidth && action.bottom <= rect.bottom
      })()`), true, 'dialog fits at ' + width + 'px')
    }

    await pressKey(command, 'Escape', 27)
    await until(() => evaluate('!document.querySelector("#create-task-heading")'), 'Escape closes dialog')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'New Task')
    await clickButton(evaluate, 'New Task')
    await clickButton(evaluate, 'Cancel')
    await until(() => evaluate('!document.querySelector("#create-task-heading")'), 'Cancel closes dialog')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'New Task')

    await clickButton(evaluate, 'New Task')
    for (const [title, message] of [['', 'Task title is required.'], ['   ', 'Task title is required.'],
      ['a'.repeat(201), 'Task title must be 200 characters or fewer.']]) {
      await fillForm(evaluate, { title })
      await clickButton(evaluate, 'Create Task')
      await until(() => textVisible(message), 'title validation')
      assert.equal(await evaluate('document.activeElement.getAttribute("aria-describedby")'), 'task-title-error')
    }
    assert.equal(await creates(), 0)

    const input = { title: 'Review task', description: 'Details', status: 'in_review', priority: 'high', due_date: '2026-10-15' }
    await fillForm(evaluate, { ...input, title: '  Review task  ' })
    await evaluate(`(() => {
      const form = document.querySelector('dialog[open] form')
      const submit = form.querySelector('button[type=submit]')
      submit.click()
      submit.click()
      form.requestSubmit()
    })()`)
    await until(() => creates(), 'first create')
    assert.equal(await creates(), 1)
    assert.deepEqual(await evaluate('boardTest.creates[0].input'), input)
    assert.equal(await evaluate('boardTest.creates[0].guestId'), 'guest-a')
    assert.equal(await textVisible('Creating…'), true)
    await pressKey(command, 'Escape', 27)
    assert.equal(await open(), true)
    await evaluate('boardTest.creates[0].reject(new Error("private database detail"))')
    await until(() => textVisible('Unable to create your task'), 'friendly save error')
    assert.equal(await evaluate('document.querySelector("#task-title").value'), '  Review task  ')
    assert.equal(await evaluate('document.querySelector("#task-due-date").value'), input.due_date)
    assert.equal(await textVisible('private database detail'), false)
    assert.deepEqual(await evaluate(cardTitles), [])

    await clickButton(evaluate, 'Create Task')
    await until(async () => await creates() === 2, 'explicit retry')
    const record = { ...task('guest-a', input.status, input.title), ...input }
    await evaluate('boardTest.creates[1].resolve(' + JSON.stringify(record) + ')')
    await until(async () => !await open(), 'successful close')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'New Task')
    assert.deepEqual(await evaluate(columnCounts), [0, 0, 1, 0])
    assert.deepEqual(await evaluate(cardTitles), [record.title])
    assert.equal(await evaluate('boardTest.requests.length'), 1)

    await clickButton(evaluate, 'New Task')
    await fillForm(evaluate, { title: 'Old guest pending' })
    await clickButton(evaluate, 'Create Task')
    await until(async () => await creates() === 3, 'pending old guest create')
    assert.deepEqual(await evaluate('boardTest.creates[2].input'), {
      title: 'Old guest pending', description: null, status: 'todo', priority: 'normal', due_date: null,
    })
    await finishFetch('guest-b', 1)
    assert.equal(await open(), false)
    await clickButton(evaluate, 'New Task')
    await fillForm(evaluate, { title: 'New guest draft' })
    await evaluate('boardTest.creates[2].resolve(' + JSON.stringify(task('guest-a', 'todo', 'Stale create')) + ')')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await open(), true)
    assert.equal(await evaluate('document.querySelector("#task-title").value'), 'New guest draft')
    assert.deepEqual(await evaluate(cardTitles), [])

    await evaluate('boardTest.setUser("error")')
    await until(() => textVisible('Unable to connect to your workspace'), 'session loss')
    assert.equal(await open(), false)
    assert.equal(await evaluate(newTaskEnabled), false)
    assert.equal(await creates(), 3)
  })
})

test(liveDelete ? 'live deletion cancels safely, persists, and leaves no fixture' :
  liveEdit ? 'live edit updates the card, persists, stays isolated, and is cleaned up' :
  'live creation survives refresh, is isolated from a separate guest, and is cleaned up', {
  skip: !liveCreate, timeout: 60000,
}, async () => {
  await withBrowser(async ({ evaluate, command, openIsolatedPage, taskRequests }) => {
    const title = (liveDelete ? 'Task 5.5 Delete Verification ' : liveEdit ? 'Task 5.4 Edit Verification ' : 'Task 5.3 Persistence Verification ') + randomUUID()
    const editedTitle = title + ' updated'
    const quotedTitle = JSON.stringify(title)
    const fixtureMatch = '(task.title === ' + quotedTitle + ' || task.title === ' + JSON.stringify(editedTitle) + ')'
    const expectedTitle = liveEdit ? editedTitle : title
    const description = 'Temporary verification of optional fields.'
    const dueDate = '2026-11-20'
    let ids = []
    let attempted = false
    let verificationError
    let cleanupError

    try {
      await until(() => evaluate(newTaskEnabled), 'live guest board')
      const ownerId = await evaluate(`import('/src/lib/supabase.ts').then(async ({ supabase }) => (await supabase.auth.getUser()).data.user?.id)`)
      assert.ok(ownerId)
      const initialCounts = await evaluate(columnCounts)
      await clickButton(evaluate, 'New Task')
      await fillForm(evaluate, { title, description, status: 'in_review', priority: 'high', due_date: dueDate })
      attempted = true
      await clickButton(evaluate, 'Create Task')
      await until(async () => (await evaluate(cardTitles)).includes(title), 'persisted card')
      assert.equal(await evaluate(creationOpen), false)
      assert.equal((await evaluate(columnCounts))[2], initialCounts[2] + 1)
      assert.equal(await evaluate(`(() => {
        const card = [...document.querySelectorAll('article')].find(item => item.querySelector('h3').textContent === ${quotedTitle})
        return card.closest('section').getAttribute('aria-labelledby') === 'column-in_review' &&
          card.textContent.includes(${JSON.stringify(description)}) && card.textContent.includes('High') &&
          card.querySelector('time').dateTime === ${JSON.stringify(dueDate)}
      })()`), true)

      if (liveEdit) {
        const before = await evaluate(`import('/src/features/tasks/taskService.ts').then(async ({ getTasks }) =>
          (await getTasks()).filter(task => ${fixtureMatch}).map(({ id }) => id))`)
        ids = before
        assert.equal(ids.length, 1)
        await evaluate(`document.getElementById('task-edit-' + ${JSON.stringify(ids[0])}).click()`)
        await fillForm(evaluate, {
          title: editedTitle, description: 'Edited details.', status: 'done', priority: 'low', due_date: '2026-11-25',
        })
        await clickButton(evaluate, 'Save Changes')
        await until(async () => (await evaluate(cardTitles)).includes(editedTitle), 'confirmed edit')
        assert.equal(await evaluate(creationOpen), false)
        assert.deepEqual(await evaluate(columnCounts), [initialCounts[0], initialCounts[1], initialCounts[2], initialCounts[3] + 1])
        assert.equal(await evaluate('document.activeElement.id'), 'task-edit-' + ids[0])
      }

      if (liveDelete) {
        const lookup = `import('/src/features/tasks/taskService.ts').then(async ({ getTasks }) =>
          (await getTasks()).filter(task => ${fixtureMatch}).map(({ id }) => id))`
        ids = await evaluate(lookup)
        assert.equal(ids.length, 1)
        const openCard = 'document.getElementById(' + JSON.stringify('task-edit-' + ids[0]) + ').click()'
        const beforeDelete = taskRequests.filter((method) => method === 'DELETE').length

        const other = await openIsolatedPage()
        await until(() => other.evaluate(newTaskEnabled), 'separate live guest')
        assert.deepEqual(await other.evaluate(lookup), [])

        await evaluate(openCard)
        await clickButton(evaluate, 'Delete Task')
        await clickButton(evaluate, 'Cancel')
        assert.equal(taskRequests.filter((method) => method === 'DELETE').length, beforeDelete)
        assert.deepEqual(await evaluate(lookup), ids)
        assert.equal((await evaluate(cardTitles)).includes(title), true)
        await clickButton(evaluate, 'Delete Task')
        await clickButton(evaluate, 'Delete Task')
        await until(async () => !(await evaluate(cardTitles)).includes(title), 'confirmed removal')
        assert.equal(taskRequests.filter((method) => method === 'DELETE').length, beforeDelete + 1)
        assert.deepEqual(await evaluate(columnCounts), initialCounts)
        assert.equal(await evaluate('document.activeElement.id'), 'column-in_review')

        const beforeReload = await evaluate('performance.timeOrigin')
        await command('Page.reload', {})
        await until(async () => await evaluate('performance.timeOrigin') !== beforeReload &&
          await evaluate(newTaskEnabled), 'refreshed live board')
        assert.deepEqual(await evaluate(lookup), [])
        assert.equal((await evaluate(cardTitles)).includes(title), false)
        const restoredOwnerId = await evaluate(`import('/src/lib/supabase.ts').then(async ({ supabase }) => (await supabase.auth.getUser()).data.user?.id)`)
        assert.equal(restoredOwnerId, ownerId)
      } else {
        const beforeReload = await evaluate('performance.timeOrigin')
        await command('Page.reload', {})
        await until(async () => await evaluate('performance.timeOrigin') !== beforeReload &&
          (await evaluate(cardTitles))?.includes(expectedTitle), 'card after refresh')
        const persisted = await evaluate(`import('/src/features/tasks/taskService.ts').then(async ({ getTasks }) =>
          (await getTasks()).filter(task => ${fixtureMatch}).map(({ id, user_id, title, description, status, priority, due_date }) => ({ id, user_id, title, description, status, priority, due_date })))`)
        assert.equal(persisted.length, 1)
        assert.equal(persisted[0].user_id, ownerId)
        if (liveEdit) {
          assert.deepEqual(persisted[0], {
            id: ids[0], user_id: ownerId, title: editedTitle, description: 'Edited details.',
            status: 'done', priority: 'low', due_date: '2026-11-25',
          })
          assert.equal(await evaluate('document.getElementById("task-edit-" + ' + JSON.stringify(ids[0]) + ')?.closest("section")?.getAttribute("aria-labelledby")'), 'column-done')
        }
        ids = persisted.map(({ id }) => id)

        const other = await openIsolatedPage()
        await until(() => other.evaluate(newTaskEnabled), 'separate live guest')
        const otherOwnerId = await other.evaluate(`import('/src/lib/supabase.ts').then(async ({ supabase }) => (await supabase.auth.getUser()).data.user?.id)`)
        assert.ok(otherOwnerId)
        assert.equal(otherOwnerId === ownerId, false)
        assert.equal((await other.evaluate(cardTitles)).includes(expectedTitle), false)
      }
    } catch (error) {
      verificationError = error
    } finally {
      if (attempted) {
        try {
          const cleanup = await evaluate(`import('/src/features/tasks/taskService.ts').then(async ({ getTasks, deleteTask }) => {
            const records = (await getTasks()).filter(task => ${fixtureMatch})
            const results = []
            for (const task of records) {
              try {
                results.push({ id: task.id, ...await deleteTask(task.id) })
              } catch {
                results.push({ id: task.id, deleted: false })
              }
            }
            const remaining = (await getTasks()).filter(task => ${fixtureMatch}).map(task => task.id)
            return { results, remaining }
          })`)
          ids = [...new Set([...ids, ...cleanup.results.map(({ id }) => id), ...cleanup.remaining])]
          assert.equal(cleanup.results.every(({ deleted }) => deleted), true)
          assert.equal(cleanup.remaining.length, 0)
        } catch {
          cleanupError = new Error('Cleanup unconfirmed for fixture title ' + title + '. Known task IDs ' + (ids.join(', ') || 'unknown'))
        }
      }
    }
    if (verificationError && cleanupError) throw new AggregateError([verificationError, cleanupError], 'Live verification and cleanup failed')
    if (cleanupError) throw cleanupError
    if (verificationError) throw verificationError
  })
})

test('editing prefills fields, saves changes once, moves the card, and handles missing tasks and guest changes', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command }) => {
    const original = { ...task('guest-a', 'todo', 'Original card'), id: 'original-card',
      description: 'Original details', priority: 'high', due_date: '2026-11-23' }
    const nullable = { ...task('guest-a', 'todo', 'Nullable card'), id: 'nullable-card' }
    const visible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const open = () => evaluate('Boolean(document.querySelector("#edit-task-heading"))')
    const count = () => evaluate('boardTest.updates.length')
    async function enterGuest(id, index, rows) {
      await evaluate('boardTest.setUser(' + JSON.stringify(id) + ')')
      await until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'guest request')
      await evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(rows) + ')')
      await until(() => evaluate(newTaskEnabled), 'guest board')
    }
    const card = (id) => 'document.getElementById(' + JSON.stringify('task-edit-' + id) + ')'
    const close = () => until(async () => !await open(), 'edit dialog closes')

    await until(() => visible('Preparing your workspace'), 'auth startup')
    await enterGuest('guest-a', 0, [original, nullable])
    await evaluate(card(original.id) + '.click()')
    assert.equal(await open(), true)
    assert.equal(await evaluate('document.activeElement.name'), 'title')
    assert.deepEqual(await evaluate('Object.fromEntries(new FormData(document.querySelector("dialog[open] form")))'), {
      title: original.title, description: original.description, status: 'todo', priority: 'high', due_date: original.due_date,
    })
    await pressKey(command, 'Tab', 9)
    assert.equal(await evaluate('document.activeElement.name'), 'description')
    for (const width of [320, 375, 768, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 550, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate(`(() => {
        const dialog = document.querySelector('dialog[open]')
        const bounds = dialog.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && dialog.scrollWidth <= dialog.clientWidth &&
          dialog.querySelector('button[type=submit]').getBoundingClientRect().bottom <= bounds.bottom
      })()`), true, 'edit dialog fits at ' + width + 'px')
    }
    await pressKey(command, 'Escape', 27)
    await close()
    assert.equal(await evaluate('document.activeElement.id'), 'task-edit-' + original.id)

    await evaluate(card(nullable.id) + '.focus()')
    await pressKey(command, ' ', 32)
    await until(open, 'keyboard opens edit dialog')
    await clickButton(evaluate, 'Cancel')
    await close()
    assert.equal(await evaluate('document.activeElement.id'), 'task-edit-' + nullable.id)
    await evaluate(card(nullable.id) + '.click()')
    await fillForm(evaluate, { title: '  Nullable card  ' })
    assert.deepEqual(await evaluate('Array.from(new FormData(document.querySelector("dialog[open] form")).values())'), ['  Nullable card  ', '', 'todo', 'normal', ''])
    await clickButton(evaluate, 'Save Changes')
    await close()
    assert.equal(await count(), 0)

    await evaluate(card(original.id) + '.click()')
    for (const [title, message] of [['', 'Task title is required'], ['   ', 'Task title is required'], ['x'.repeat(201), 'Task title must be 200']]) {
      await fillForm(evaluate, { title })
      await clickButton(evaluate, 'Save Changes')
      await until(() => visible(message), 'title error')
    }
    await fillForm(evaluate, { title: 'Edited card', due_date: '10000-01-01' })
    await clickButton(evaluate, 'Save Changes')
    await until(() => visible('Enter a valid due date'), 'date validation')
    await fillForm(evaluate, { due_date: '', status: 'bad' })
    await clickButton(evaluate, 'Save Changes')
    await until(() => visible('Choose a valid status and priority'), 'status validation')
    await fillForm(evaluate, { status: 'done', priority: 'bad' })
    await clickButton(evaluate, 'Save Changes')
    await until(() => visible('Choose a valid status and priority'), 'priority validation')
    assert.equal(await count(), 0)
    await fillForm(evaluate, { priority: 'normal', description: '' })
    await evaluate(`(() => {
      const form = document.querySelector('dialog[open] form')
      form.requestSubmit()
      form.requestSubmit()
    })()`)
    await until(() => count(), 'one edit submission')
    assert.equal(await count(), 1)
    assert.deepEqual(await evaluate('(({ id, guestId, updates }) => ({ id, guestId, updates }))(boardTest.updates[0])'), {
      id: original.id, guestId: 'guest-a',
      updates: { title: 'Edited card', description: null, status: 'done', priority: 'normal', due_date: null },
    })
    await pressKey(command, 'Escape', 27)
    assert.equal(await open(), true)
    await evaluate('boardTest.updates[0].reject(new Error("private detail"))')
    await until(() => visible('Unable to save your changes'), 'friendly update failure')
    assert.equal(await evaluate('document.querySelector("#task-title").value'), 'Edited card')
    assert.deepEqual(await evaluate(columnCounts), [2, 0, 0, 0])
    await clickButton(evaluate, 'Save Changes')
    await until(async () => await count() === 2, 'explicit retry')
    await evaluate('boardTest.updates[1].resolve(' + JSON.stringify({ ...original, title: 'Edited card', description: null, status: 'done', priority: 'normal', due_date: null }) + ')')
    await close()
    assert.deepEqual(await evaluate(columnCounts), [1, 0, 0, 1])
    assert.equal(await evaluate('document.activeElement.id'), 'task-edit-' + original.id)

    await evaluate(card(original.id) + '.click()')
    await fillForm(evaluate, { title: 'Missing edit' })
    await clickButton(evaluate, 'Save Changes')
    await until(async () => await count() === 3, 'missing task submit')
    await evaluate(`import('/src/features/tasks/TaskDialog.tsx').then(() => {
      const error = new boardTest.TaskServiceError()
      error.code = 'not_found'
      boardTest.updates[2].reject(error)
    })`)
    await until(() => visible('This task is no longer available'), 'missing task notice')
    await clickButton(evaluate, 'Refresh Board')
    await close()
    await until(() => evaluate('Boolean(boardTest.requests[1])'), 'refresh request')
    await evaluate('boardTest.requests[1].resolve(' + JSON.stringify([nullable]) + ')')
    await until(() => evaluate(newTaskEnabled), 'refreshed board')
    assert.deepEqual(await evaluate(cardTitles), [nullable.title])

    await evaluate(card(nullable.id) + '.click()')
    await fillForm(evaluate, { title: 'Old edit still pending' })
    await clickButton(evaluate, 'Save Changes')
    await until(async () => await count() === 4, 'pending old edit')
    const other = { ...task('guest-b', 'todo', 'Guest B task'), id: 'guest-b-card' }
    await enterGuest('guest-b', 2, [other])
    assert.equal(await open(), false)
    await evaluate(card(other.id) + '.click()')
    await evaluate('boardTest.updates[3].resolve(' + JSON.stringify(nullable) + ')')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await open(), true)
    assert.equal(await evaluate('document.querySelector("#task-title").value'), other.title)
    await evaluate('boardTest.setUser("error")')
    await until(() => visible('Unable to connect to your workspace'), 'session loss')
    assert.equal(await open(), false)
    assert.deepEqual(await evaluate(cardTitles), [])
  })
})

test('deletion confirms accessibly, preserves drafts, resists stale results, and reconciles uncertain outcomes', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command }) => {
    const original = task('guest-a', 'todo', 'Selected task')
    const other = task('guest-a', 'todo', 'Keep this card')
    const visible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const confirmVisible = () => evaluate('Boolean(document.querySelector("dialog[role=alertdialog][open]"))')
    const count = () => evaluate('boardTest.deletes.length')
    const openCard = (row) => evaluate('document.getElementById(' + JSON.stringify('task-edit-' + row.id) + ').click()')
    const openConfirm = () => clickButton(evaluate, 'Delete Task')
    async function resolveLoad(index, rows) {
      await until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'board request')
      await evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(rows) + ')')
      await until(() => evaluate(newTaskEnabled), 'loaded board')
    }
    async function resolveDelete(index, deleted) {
      await evaluate('boardTest.deletes[' + index + '].resolve(' + JSON.stringify({ deleted }) + ')')
    }

    await until(() => visible('Preparing your workspace'), 'auth startup')
    await evaluate('boardTest.setUser("guest-a")')
    await resolveLoad(0, [original, other])
    await clickButton(evaluate, 'New Task')
    assert.equal(await visible('Delete Task'), false)
    await clickButton(evaluate, 'Cancel')

    await openCard(original)
    await fillForm(evaluate, { title: 'Unsaved edit' })
    await openConfirm()
    assert.equal(await confirmVisible(), true)
    assert.equal(await visible(original.title), true)
    assert.equal(await visible('This action cannot be undone'), true)
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Cancel')
    assert.equal(await count(), 0)
    for (const width of [320, 375, 768, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 420, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate(`(() => {
        const dialog = document.querySelector('dialog[open]')
        const bounds = dialog.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight &&
          dialog.scrollWidth <= dialog.clientWidth && document.activeElement.getBoundingClientRect().bottom <= bounds.bottom
      })()`), true, 'confirmation fits at ' + width + 'px')
    }
    await pressKey(command, 'Enter', 13)
    await until(async () => !await confirmVisible(), 'Enter takes safe default')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Delete Task')
    assert.equal(await evaluate('document.querySelector("#task-title").value'), 'Unsaved edit')
    await openConfirm()
    await pressKey(command, 'Escape', 27)
    await until(async () => !await confirmVisible(), 'Escape cancels confirmation')
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Delete Task')
    assert.equal(await evaluate('document.querySelector("#task-title").value'), 'Unsaved edit')
    assert.equal(await count(), 0)

    await openConfirm()
    await evaluate(`(() => {
      const button = [...document.querySelectorAll('dialog[open] button')].find(button => button.textContent.trim() === 'Delete Task')
      button.click()
      button.click()
    })()`)
    await until(() => count(), 'first delete request')
    assert.equal(await count(), 1)
    assert.deepEqual(await evaluate('(({ id, guestId }) => ({ id, guestId }))(boardTest.deletes[0])'), { id: original.id, guestId: 'guest-a' })
    assert.equal(await visible('Deleting…'), true)
    assert.deepEqual(await evaluate(columnCounts), [2, 0, 0, 0])
    await pressKey(command, 'Escape', 27)
    assert.equal(await confirmVisible(), true)
    await evaluate('boardTest.deletes[0].reject(new Error("private detail"))')
    await until(() => visible('Unable to delete this task'), 'retryable failure')
    assert.deepEqual(await evaluate(columnCounts), [2, 0, 0, 0])
    await openConfirm()
    await until(async () => await count() === 2, 'delete retry')
    await resolveDelete(1, true)
    await until(async () => !await confirmVisible(), 'deletion closes dialog')
    assert.deepEqual(await evaluate(cardTitles), [other.title])
    assert.deepEqual(await evaluate(columnCounts), [1, 0, 0, 0])
    assert.equal(await evaluate('document.activeElement.id'), 'column-todo')
    assert.equal(await evaluate('boardTest.updates.length'), 0)

    await openCard(other)
    await openConfirm()
    await openConfirm()
    await until(async () => await count() === 3, 'zero-row request')
    await resolveDelete(2, false)
    await until(() => visible('This task could not be found'), 'missing task notice')
    assert.deepEqual(await evaluate(cardTitles), [other.title])
    await clickButton(evaluate, 'Refresh Board')
    await resolveLoad(1, [original, other])
    assert.deepEqual(await evaluate(cardTitles), [other.title], 'stale rows cannot restore the confirmed deletion')

    await openCard(other)
    await openConfirm()
    await openConfirm()
    await until(async () => await count() === 4, 'network request')
    await evaluate(`(() => {
      const error = new boardTest.TaskServiceError()
      error.code = 'network_error'
      boardTest.deletes[3].reject(error)
    })()`)
    await until(() => visible('couldn’t confirm whether the task was deleted'), 'uncertain outcome')
    assert.deepEqual(await evaluate(cardTitles), [other.title])
    assert.equal(await visible('Refresh Board'), true)
    await clickButton(evaluate, 'Cancel')
    await openConfirm()
    await openConfirm()
    await until(async () => await count() === 5, 'pending old guest delete')

    const guestB = { ...task('guest-b', 'done', 'New guest task'), id: other.id }
    await evaluate('boardTest.setUser("guest-b")')
    await resolveLoad(2, [guestB])
    await openCard(guestB)
    await resolveDelete(4, true)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.deepEqual(await evaluate(cardTitles), [guestB.title])
    assert.equal(await evaluate('document.querySelector("#task-title").value'), guestB.title)
    await evaluate('boardTest.setUser("error")')
    await until(() => visible('Unable to connect to your workspace'), 'session loss')
    assert.equal(await confirmVisible(), false)
    assert.deepEqual(await evaluate(cardTitles), [])
    assert.equal(await count(), 5)
  })
})

const filterGroup = 'document.querySelector(\'[role="group"][aria-label="Search and filter tasks"]\')'

function changeTaskFilters(evaluate, values) {
  return evaluate(`(() => {
    const elements = ${filterGroup}.querySelectorAll('input, select')
    const names = ['search', 'priority', 'status']
    for (const [key, value] of Object.entries(${JSON.stringify(values)})) {
      const control = elements[names.indexOf(key)]
      const prototype = key === 'search' ? HTMLInputElement.prototype : HTMLSelectElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(control, value)
      control.dispatchEvent(new Event(key === 'search' ? 'input' : 'change', { bubbles: true }))
    }
  })()`)
}

test('search and filters combine, track confirmed CRUD, preserve focus, and reset for a new guest', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command }) => {
    const rows = [
      { ...task('guest-a', 'todo', 'API Documentation'), priority: 'high' },
      { ...task('guest-a', 'in_progress', 'UI Testing'), description: 'Exercise Documentation endpoints' },
      { ...task('guest-a', 'in_review', 'Code Review'), priority: 'high' },
      { ...task('guest-a', 'done', 'Documentation Review'), priority: 'low' },
    ]
    const textVisible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    async function loadGuest(user, index, tasks) {
      await evaluate('boardTest.setUser(' + JSON.stringify(user) + ')')
      await until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'guest request')
      await evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(tasks) + ')')
      await until(() => evaluate(newTaskEnabled), 'guest board')
    }
    const clear = () => clickButton(evaluate, 'Clear Filters')
    const edit = (row) => evaluate('document.getElementById(' + JSON.stringify('task-edit-' + row.id) + ').click()')
    const cards = () => evaluate(cardTitles)

    await until(() => textVisible('Preparing your workspace'), 'auth startup')
    await loadGuest('guest-a', 0, rows)
    assert.deepEqual(await evaluate(`[...(${filterGroup}).querySelectorAll('label')].map(label => label.firstChild.textContent.trim())`), ['Search tasks', 'Priority', 'Status'])
    await evaluate(filterGroup + '.querySelector("input").focus()')
    await pressKey(command, 'Tab', 9)
    assert.equal(await evaluate('document.activeElement.value'), '')
    assert.equal(await evaluate('document.activeElement.options[0].text'), 'All Priorities')
    await evaluate(filterGroup + '.querySelector("input").focus()')
    await changeTaskFilters(evaluate, { search: '  dOcUmEnT  ' })
    assert.deepEqual(await cards(), [rows[0].title, rows[1].title, rows[3].title])
    assert.equal(await evaluate('document.activeElement.type'), 'search')
    assert.deepEqual(await evaluate(columnCounts), [1, 1, 0, 1])
    await changeTaskFilters(evaluate, { priority: 'high' })
    assert.deepEqual(await cards(), [rows[0].title])
    await changeTaskFilters(evaluate, { status: 'done' })
    assert.deepEqual(await cards(), [])
    assert.equal(await textVisible('No tasks match your search or filters'), true)
    assert.deepEqual(await evaluate(columnCounts), [0, 0, 0, 0])
    assert.equal(await evaluate(columnNames + '.length'), 4)
    await changeTaskFilters(evaluate, { priority: '' })
    assert.deepEqual(await cards(), [rows[3].title])
    await changeTaskFilters(evaluate, { search: '' })
    await changeTaskFilters(evaluate, { priority: 'normal' })
    assert.deepEqual(await cards(), [])
    await clear()
    assert.equal(await evaluate('document.activeElement.type'), 'search')
    assert.deepEqual(await cards(), rows.map(({ title }) => title))

    for (const priority of ['', 'low', 'normal', 'high']) {
      await changeTaskFilters(evaluate, { priority })
      assert.deepEqual(await cards(), rows.filter((row) => !priority || row.priority === priority).map(({ title }) => title))
    }
    await clear()
    for (const status of ['', 'todo', 'in_progress', 'in_review', 'done']) {
      await changeTaskFilters(evaluate, { status })
      assert.deepEqual(await cards(), rows.filter((row) => !status || row.status === status).map(({ title }) => title))
    }
    await clear()
    await changeTaskFilters(evaluate, { search: '   ' })
    assert.deepEqual(await cards(), rows.map(({ title }) => title))
    for (const width of [320, 375, 768, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 650, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate(`(() => {
        const group = ${filterGroup}
        const bounds = group.getBoundingClientRect()
        return bounds.left >= 0 && bounds.right <= innerWidth && group.scrollWidth <= group.clientWidth &&
          [...group.querySelectorAll('input, select, button')].every(control => control.getBoundingClientRect().right <= bounds.right)
      })()`), true, 'controls fit at ' + width + 'px')
    }
    assert.equal(await evaluate('boardTest.requests.length'), 1)

    await changeTaskFilters(evaluate, { priority: 'high' })
    await clickButton(evaluate, 'New Task')
    const created = task('guest-a', 'todo', 'New normal priority task')
    await fillForm(evaluate, { title: created.title })
    await clickButton(evaluate, 'Create Task')
    await until(() => evaluate('Boolean(boardTest.creates[0])'), 'create with filter')
    await evaluate('boardTest.creates[0].resolve(' + JSON.stringify(created) + ')')
    await until(() => textVisible('Task saved. Clear filters to see it.'), 'saved but hidden notice')
    assert.deepEqual(await cards(), [rows[0].title, rows[2].title])
    await clear()
    assert.equal((await cards()).includes(created.title), true)

    await changeTaskFilters(evaluate, { priority: 'high' })
    await edit(rows[0])
    await fillForm(evaluate, { priority: 'low' })
    await clickButton(evaluate, 'Save Changes')
    await until(() => evaluate('Boolean(boardTest.updates[0])'), 'priority edit')
    await evaluate('boardTest.updates[0].resolve(' + JSON.stringify({ ...rows[0], priority: 'low' }) + ')')
    await until(() => textVisible('Task saved. Clear filters to see it.'), 'edited card hidden')
    assert.deepEqual(await cards(), [rows[2].title])
    await clear()
    await changeTaskFilters(evaluate, { status: 'in_progress' })
    await edit(rows[1])
    await fillForm(evaluate, { status: 'done' })
    await clickButton(evaluate, 'Save Changes')
    await until(() => evaluate('Boolean(boardTest.updates[1])'), 'status edit')
    await evaluate('boardTest.updates[1].resolve(' + JSON.stringify({ ...rows[1], status: 'done' }) + ')')
    await until(() => textVisible('No tasks match your search or filters'), 'moved card hidden')
    await clear()
    await changeTaskFilters(evaluate, { status: 'done' })
    assert.deepEqual(await cards(), [rows[3].title, rows[1].title])
    await edit(rows[3])
    await clickButton(evaluate, 'Delete Task')
    await clickButton(evaluate, 'Delete Task')
    await until(() => evaluate('Boolean(boardTest.deletes[0])'), 'filtered delete')
    await evaluate('boardTest.deletes[0].resolve({ deleted: true })')
    await until(async () => (await cards()).length === 1, 'confirmed delete')
    await clear()
    assert.equal((await cards()).includes(rows[3].title), false)
    assert.equal(await evaluate('boardTest.requests.length'), 1)

    await changeTaskFilters(evaluate, { search: 'documentation' })
    await changeTaskFilters(evaluate, { priority: 'low' })
    await changeTaskFilters(evaluate, { status: 'todo' })
    await loadGuest('guest-b', 1, [])
    assert.deepEqual(await evaluate(`[...(${filterGroup}).querySelectorAll('input, select')].map(control => control.value)`), ['', '', ''])
    assert.deepEqual(await cards(), [])
    await changeTaskFilters(evaluate, { search: 'no match' })
    assert.equal(await textVisible('Once you create tasks'), true)
    assert.equal(await textVisible('No tasks match your search or filters'), false)
  })
})

test('live filters use loaded tasks without writes and clean up three owned fixtures', {
  skip: !liveFilters, timeout: 60000,
}, async () => {
  await withBrowser(async ({ evaluate, command, taskRequests }) => {
    const prefix = 'Task 5.6 ' + randomUUID() + ' '
    const fixtures = [
      { title: prefix + 'API Documentation', status: 'todo', priority: 'high' },
      { title: prefix + 'UI Testing', status: 'in_progress', priority: 'normal' },
      { title: prefix + 'Documentation Review', status: 'done', priority: 'low' },
    ]
    const titles = JSON.stringify(fixtures.map(({ title }) => title))
    const read = `import('/src/features/tasks/taskService.ts').then(async ({ getTasks }) =>
      (await getTasks()).filter(task => ${titles}.includes(task.title)))`
    let ids = []
    let attempted = false
    let verificationError
    let cleanupError
    try {
      await until(() => evaluate(newTaskEnabled), 'live guest board')
      for (const fixture of fixtures) {
        await clickButton(evaluate, 'New Task')
        await fillForm(evaluate, fixture)
        attempted = true
        await clickButton(evaluate, 'Create Task')
        await until(async () => (await evaluate(cardTitles)).includes(fixture.title), 'confirmed fixture')
      }
      const original = await evaluate(read)
      ids = original.map(({ id }) => id)
      assert.equal(ids.length, 3)
      const beforeFilters = taskRequests.length

      await changeTaskFilters(evaluate, { search: 'documentation' })
      assert.deepEqual(await evaluate(cardTitles), [fixtures[0].title, fixtures[2].title])
      await changeTaskFilters(evaluate, { priority: 'high' })
      assert.deepEqual(await evaluate(cardTitles), [fixtures[0].title])
      await changeTaskFilters(evaluate, { status: 'done' })
      assert.deepEqual(await evaluate(cardTitles), [])
      assert.equal(await evaluate('document.body.innerText.includes("No tasks match your search or filters")'), true)
      await clickButton(evaluate, 'Clear Filters')
      assert.deepEqual(await evaluate(cardTitles), fixtures.map(({ title }) => title))
      assert.deepEqual(await evaluate(columnCounts), [1, 1, 0, 1])
      assert.equal(taskRequests.length, beforeFilters)

      const beforeReload = await evaluate('performance.timeOrigin')
      await command('Page.reload', {})
      await until(async () => await evaluate('performance.timeOrigin') !== beforeReload &&
        await evaluate(newTaskEnabled), 'refreshed board')
      assert.deepEqual(await evaluate(cardTitles), fixtures.map(({ title }) => title))
      assert.deepEqual(await evaluate(read), original)
    } catch (error) {
      verificationError = error
    } finally {
      if (attempted) {
        try {
          const remainingBeforeCleanup = await evaluate(read)
          ids = [...new Set([...ids, ...remainingBeforeCleanup.map(({ id }) => id)])]
          for (const { id } of remainingBeforeCleanup) {
            await evaluate(`import('/src/features/tasks/taskService.ts').then(({ deleteTask }) => deleteTask(${JSON.stringify(id)}))`)
              .catch(() => undefined)
          }
          const remaining = await evaluate(read)
          if (remaining.length) cleanupError = new Error('Temporary tasks remain: ' + remaining.map(({ id }) => id).join(', '))
        } catch {
          cleanupError = new Error('Cleanup unconfirmed for fixture prefix ' + prefix + '. Known IDs: ' + (ids.join(', ') || 'unknown'))
        }
      }
    }
    if (verificationError && cleanupError) throw new AggregateError([verificationError, cleanupError], 'Live verification and cleanup failed')
    if (cleanupError) throw cleanupError
    if (verificationError) throw verificationError
  })
})

async function dragCard({ evaluate, command }, id, destination, mode = 'pointer') {
  const points = await evaluate(`(() => {
    const handle = document.getElementById(${JSON.stringify('task-drag-' + id)}).getBoundingClientRect()
    const target = document.querySelector('[data-drop-column="' + ${JSON.stringify(destination)} + '"]').getBoundingClientRect()
    const board = document.querySelector('[aria-label="Kanban board"]').getBoundingClientRect()
    return {
      start: { x: Math.round(handle.x + handle.width / 2), y: Math.round(handle.y + handle.height / 2) },
      end: { x: Math.round((Math.max(target.left, board.left) + Math.min(target.right, board.right)) / 2), y: Math.round(target.top + 95) },
      outside: { x: Math.round(board.left + 12), y: Math.round(board.top - 12) },
    }
  })()`)
  const { start, end } = points
  const target = mode === 'outside' ? points.outside : end
  const path = Array.from({ length: 8 }, (_, index) => ({
    x: Math.round(start.x + (target.x - start.x) * (index + 1) / 8),
    y: Math.round(start.y + (target.y - start.y) * (index + 1) / 8),
  }))
  if (mode === 'touch') {
    await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] })
    await pause(320)
    for (const point of path) {
      await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] })
      await pause(18)
    }
    await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await pause(120)
    return
  }
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start })
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...start })
  for (const point of path) {
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, ...point })
    await pause(18)
  }
  if (mode === 'cancel') await pressKey(command, 'Escape', 27)
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...target })
  await pause(120)
}

function cardColumn(evaluate, id) {
  return evaluate('document.getElementById(' + JSON.stringify('task-edit-' + id) + ')?.closest("[data-drop-column]")?.dataset.dropColumn')
}

function moveThroughControl(evaluate, id, status) {
  return evaluate(`(() => {
    const control = document.getElementById(${JSON.stringify('task-move-' + id)})
    control.focus()
    control.value = ${JSON.stringify(status)}
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
}

test('drag and accessible moves save confirmed statuses, handle failures, and respect guest and filter state', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 60000,
}, async () => {
  await withBrowser(async (browser) => {
    const { evaluate, command } = browser
    const original = { ...task('guest-a', 'todo', 'Drag documentation'), id: 'drag-test', priority: 'high', description: 'Description', due_date: '2026-11-20' }
    const visible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const requests = () => evaluate('boardTest.updates.length')
    const where = () => cardColumn(evaluate, original.id)
    const viewport = (width, mobile = false) => command('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1, mobile })
    async function loadGuest(user, index, tasks) {
      await evaluate('boardTest.setUser(' + JSON.stringify(user) + ')')
      await until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'guest request')
      await evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(tasks) + ')')
      await until(() => evaluate(newTaskEnabled), 'guest board')
    }
    async function expectMove(index, from, to) {
      await until(async () => await requests() === index + 1, 'move to ' + to)
      assert.equal(await where(), from)
      assert.deepEqual(await evaluate('(({ id, updates, guestId }) => ({ id, updates, guestId }))(boardTest.updates[' + index + '])'), {
        id: original.id, updates: { status: to }, guestId: 'guest-a',
      })
      assert.equal(await evaluate(creationOpen), false)
    }
    async function resolveMove(index, to) {
      await evaluate('boardTest.updates[' + index + '].resolve(' + JSON.stringify({ ...original, status: to }) + ')')
      await until(async () => await where() === to, 'card rendered in ' + to)
    }

    await viewport(1440)
    await until(() => visible('Preparing your workspace'), 'auth startup')
    await loadGuest('guest-a', 0, [original])
    await dragCard(browser, original.id, 'todo')
    await dragCard(browser, original.id, 'in_progress', 'outside')
    await dragCard(browser, original.id, 'in_progress', 'cancel')
    assert.equal(await requests(), 0)
    assert.equal(await where(), 'todo')

    for (const [index, [from, to]] of [['todo', 'in_progress'], ['in_progress', 'in_review'], ['in_review', 'done'], ['done', 'todo']].entries()) {
      await dragCard(browser, original.id, to)
      await expectMove(index, from, to)
      assert.equal(await evaluate('document.getElementById("task-drag-drag-test").disabled'), true)
      assert.equal(await evaluate('document.getElementById("task-edit-drag-test").disabled'), true)
      if (index === 0) {
        await evaluate('document.getElementById("task-move-drag-test").dispatchEvent(new Event("change", { bubbles: true }))')
        assert.equal(await requests(), 1)
      }
      await resolveMove(index, to)
      assert.equal((await evaluate(columnCounts)).reduce((a, b) => a + b), 1)
    }

    await changeTaskFilters(evaluate, { search: 'documentation' })
    await changeTaskFilters(evaluate, { priority: 'high' })
    await dragCard(browser, original.id, 'in_progress')
    await expectMove(4, 'todo', 'in_progress')
    await evaluate('boardTest.updates[4].reject(new Error("private detail"))')
    await until(() => visible('Unable to move this task'), 'move error')
    assert.equal(await where(), 'todo')
    await changeTaskFilters(evaluate, { status: 'todo' })
    await dragCard(browser, original.id, 'done')
    await expectMove(5, 'todo', 'done')
    await evaluate('boardTest.updates[5].resolve(' + JSON.stringify({ ...original, status: 'done' }) + ')')
    await until(() => visible('Clear filters to see it.'), 'filtered move confirmation')
    assert.equal(await where(), undefined)
    await clickButton(evaluate, 'Clear Filters')
    assert.equal(await where(), 'done')
    assert.equal(await evaluate('document.querySelector("article time").dateTime'), original.due_date)
    assert.equal(await visible(original.description), true)

    await evaluate('document.getElementById("task-edit-drag-test").focus()')
    await pressKey(command, ' ', 32)
    await until(() => evaluate(creationOpen), 'keyboard still opens edit')
    await clickButton(evaluate, 'Cancel')
    await evaluate('document.getElementById("task-drag-drag-test").focus()')
    await pressKey(command, ' ', 32)
    assert.equal(await evaluate('document.activeElement.id'), 'task-move-' + original.id)
    await moveThroughControl(evaluate, original.id, 'todo')
    await expectMove(6, 'done', 'todo')
    await resolveMove(6, 'todo')
    assert.equal(await evaluate('document.activeElement.id'), 'task-move-' + original.id)

    for (const width of [320, 375, 768, 1024, 1440]) {
      await viewport(width)
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'page fits at ' + width)
      assert.equal(await evaluate('document.getElementById("task-move-drag-test").offsetWidth > 0'), true)
    }

    await viewport(375, true)
    await command('Emulation.setTouchEmulationEnabled', { enabled: true })
    await evaluate('document.querySelector("[aria-label=\\"Kanban board\\"]").scrollLeft = 100')
    await dragCard(browser, original.id, 'in_progress', 'touch')
    await expectMove(7, 'todo', 'in_progress')
    await resolveMove(7, 'in_progress')
    await command('Emulation.setTouchEmulationEnabled', { enabled: false })
    await viewport(1440)

    await moveThroughControl(evaluate, original.id, 'done')
    await expectMove(8, 'in_progress', 'done')
    await evaluate(`(() => {
      const error = new boardTest.TaskServiceError()
      error.code = 'network_error'
      boardTest.updates[8].reject(error)
    })()`)
    await until(() => visible('couldn’t confirm whether one or more moves were saved'), 'uncertain save')
    assert.equal(await where(), 'in_progress')
    await moveThroughControl(evaluate, original.id, 'in_review')
    await expectMove(9, 'in_progress', 'in_review')
    await moveThroughControl(evaluate, original.id, 'done')
    assert.equal(await requests(), 10)
    const newGuestTask = { ...original, user_id: 'guest-b', status: 'todo' }
    const secondTask = { ...task('guest-b', 'todo', 'Another card'), id: 'another-card' }
    await loadGuest('guest-b', 1, [newGuestTask, secondTask])
    await evaluate('boardTest.updates[9].resolve(' + JSON.stringify({ ...original, status: 'in_review' }) + ')')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await where(), 'todo')
    assert.equal(await visible('Moving task'), false)

    await moveThroughControl(evaluate, newGuestTask.id, 'done')
    await until(async () => await requests() === 11, 'first concurrent move')
    await moveThroughControl(evaluate, secondTask.id, 'done')
    await until(async () => await requests() === 12, 'distinct card remains interactive')
    await evaluate(`(() => {
      const error = new boardTest.TaskServiceError()
      error.code = 'network_error'
      boardTest.updates[11].reject(error)
    })()`)
    await until(() => visible('couldn’t confirm whether one or more moves were saved'), 'refresh offered')
    await clickButton(evaluate, 'Refresh Board')
    await until(() => evaluate('Boolean(boardTest.requests[2])'), 'fetch starts before confirmation')
    await evaluate('boardTest.updates[10].resolve(' + JSON.stringify({ ...newGuestTask, status: 'done' }) + ')')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await evaluate('boardTest.requests[2].resolve(' + JSON.stringify([newGuestTask, secondTask]) + ')')
    await until(() => evaluate(newTaskEnabled), 'refreshed board')
    assert.equal(await where(), 'done', 'the older fetch cannot undo the confirmed move')
    assert.equal(await cardColumn(evaluate, secondTask.id), 'todo')
  })
})

test('live pointer moves persist through refresh, respect filters and guest isolation, and clean up', {
  skip: !liveDrag, timeout: 60000,
}, async () => {
  await withBrowser(async (browser) => {
    const { evaluate, command, taskRequests, openIsolatedPage } = browser
    const title = 'Task 6.1 Drag Verification ' + randomUUID()
    const read = `import('/src/features/tasks/taskService.ts').then(async ({ getTasks }) =>
      (await getTasks()).filter(task => task.title === ${JSON.stringify(title)}))`
    let id
    let attempted = false
    let verificationError
    let cleanupError

    try {
      await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false })
      await until(() => evaluate(newTaskEnabled), 'live guest board')
      await clickButton(evaluate, 'New Task')
      await fillForm(evaluate, { title, priority: 'high', description: 'Temporary drag fixture', due_date: '2026-11-24' })
      attempted = true
      await clickButton(evaluate, 'Create Task')
      await until(async () => (await evaluate(cardTitles)).includes(title), 'confirmed fixture')
      const [original] = await evaluate(read)
      id = original.id
      assert.equal(await cardColumn(evaluate, id), 'todo')
      await changeTaskFilters(evaluate, { priority: 'high' })
      const before = taskRequests.filter((method) => method === 'PATCH').length
      for (const [index, status] of ['in_progress', 'in_review', 'todo'].entries()) {
        await dragCard(browser, id, status)
        await until(async () => await cardColumn(evaluate, id) === status, 'confirmed live move to ' + status)
        assert.equal(taskRequests.filter((method) => method === 'PATCH').length, before + index + 1)
        const counts = ['todo', 'in_progress', 'in_review', 'done'].map((column) => Number(column === status))
        assert.deepEqual(await evaluate(columnCounts), counts)
      }
      assert.deepEqual(await evaluate(read), [original])
      // Leave the task in a different column so a refresh proves that the last move persisted.
      await dragCard(browser, id, 'done')
      await until(async () => await cardColumn(evaluate, id) === 'done', 'confirmed final move')
      assert.equal(taskRequests.filter((method) => method === 'PATCH').length, before + 4)
      const beforeReload = await evaluate('performance.timeOrigin')
      await command('Page.reload', {})
      await until(async () => await evaluate('performance.timeOrigin') !== beforeReload && await evaluate(newTaskEnabled), 'restored board')
      assert.equal(await cardColumn(evaluate, id), 'done')
      assert.deepEqual(await evaluate(read), [{ ...original, status: 'done' }])
      const other = await openIsolatedPage()
      await until(() => other.evaluate(newTaskEnabled), 'separate guest')
      assert.deepEqual(await other.evaluate(read), [])
    } catch (error) {
      verificationError = error
    } finally {
      if (attempted) {
        try {
          const records = await evaluate(read)
          for (const row of records) {
            id = row.id
            await evaluate(`import('/src/features/tasks/taskService.ts').then(({ deleteTask }) => deleteTask(${JSON.stringify(id)}))`)
          }
          assert.deepEqual(await evaluate(read), [])
        } catch {
          cleanupError = new Error('Cleanup unconfirmed for ' + title + '. Task ID: ' + (id ?? 'unknown'))
        }
      }
    }
    if (verificationError && cleanupError) throw new AggregateError([verificationError, cleanupError], 'Live move and cleanup failed')
    if (cleanupError) throw cleanupError
    if (verificationError) throw verificationError
  })
})

test('move recovery persists through unrelated changes and only a successful in-scope refresh clears it', {
  skip: live || liveCreate || liveFilters || liveDrag, timeout: 45000,
}, async () => {
  await withBrowser(async ({ evaluate, command }) => {
    const a = { ...task('guest-a', 'todo', 'Recovery A'), id: 'recovery-a', priority: 'high' }
    const b = { ...task('guest-a', 'todo', 'Recovery B'), id: 'recovery-b' }
    const c = { ...task('guest-a', 'todo', 'Recovery C'), id: 'recovery-c' }
    const next = { ...a, user_id: 'guest-b', status: 'in_review' }
    const message = 'couldn’t confirm whether one or more moves were saved'
    const visible = (text) => evaluate('document.body.innerText.includes(' + JSON.stringify(text) + ')')
    const button = (label) => `[...document.querySelectorAll('button')].find(node => node.textContent.trim() === ${JSON.stringify(label)})`
    const waitForRequest = (index) => until(() => evaluate('Boolean(boardTest.requests[' + index + '])'), 'fetch ' + index)
    const waitForUpdate = (index) => until(() => evaluate('Boolean(boardTest.updates[' + index + '])'), 'move ' + index)
    const resolveRequest = (index, rows) => evaluate('boardTest.requests[' + index + '].resolve(' + JSON.stringify(rows) + ')')
    const resolveUpdate = (index, row) => evaluate('boardTest.updates[' + index + '].resolve(' + JSON.stringify(row) + ')')
    const loseResponse = (index) => evaluate(`(() => {
      const error = new boardTest.TaskServiceError()
      error.code = 'network_error'
      boardTest.updates[${index}].reject(error)
    })()`)
    const setGuest = (id) => evaluate('boardTest.setUser(' + JSON.stringify(id) + ')')
    const boardSelector = '[aria-label="Kanban board"]'

    await until(() => visible('Preparing your workspace'), 'auth startup')
    await setGuest('guest-a')
    await waitForRequest(0)
    await resolveRequest(0, [a, b, c])
    await until(() => evaluate(newTaskEnabled), 'ready board')
    await moveThroughControl(evaluate, a.id, 'done')
    await waitForUpdate(0)
    await loseResponse(0)
    await until(() => visible(message), 'first recovery notice')
    assert.equal(await cardColumn(evaluate, a.id), 'todo')
    assert.equal(await evaluate('Array.from(document.querySelectorAll("[role=alert]")).some(node => node.textContent.includes("confirm whether"))'), true)

    for (const filters of [{ search: 'recovery' }, { priority: 'high' }, { status: 'todo' }]) {
      await changeTaskFilters(evaluate, filters)
      assert.equal(await visible(message), true)
    }
    await clickButton(evaluate, 'Clear Filters')
    assert.equal(await visible(message), true)

    await moveThroughControl(evaluate, b.id, 'done')
    await waitForUpdate(1)
    const movedB = { ...b, status: 'done' }
    await resolveUpdate(1, movedB)
    await until(async () => await cardColumn(evaluate, b.id) === 'done', 'unrelated saved move')
    assert.equal(await visible(message), true)

    await evaluate(button('New Task') + '.focus()')
    await pressKey(command, 'Enter', 13)
    const created = { ...task('guest-a', 'todo', 'Created during recovery'), id: 'created-recovery' }
    await command('Input.insertText', { text: created.title })
    await evaluate(button('Create Task') + '.focus()')
    await pressKey(command, 'Enter', 13)
    await until(() => evaluate('Boolean(boardTest.creates[0])'), 'create during recovery')
    assert.deepEqual(await evaluate('boardTest.creates[0].input'), { title: created.title, description: null, status: 'todo', priority: 'normal', due_date: null })
    await evaluate('boardTest.creates[0].resolve(' + JSON.stringify(created) + ')')
    await until(() => visible(created.title), 'confirmed create')
    assert.equal(await visible(message), true)
    await evaluate('document.getElementById("task-edit-created-recovery").focus()')
    await pressKey(command, 'Enter', 13)
    await fillForm(evaluate, { title: 'Edited during recovery' })
    await evaluate(button('Save Changes') + '.focus()')
    await pressKey(command, 'Enter', 13)
    await waitForUpdate(2)
    await resolveUpdate(2, { ...created, title: 'Edited during recovery' })
    await until(() => visible('Edited during recovery'), 'confirmed edit')
    assert.equal(await visible(message), true)
    await evaluate('document.getElementById("task-edit-created-recovery").focus()')
    await pressKey(command, 'Enter', 13)
    await evaluate(button('Delete Task') + '.focus()')
    await pressKey(command, 'Enter', 13)
    await pressKey(command, 'Tab', 9)
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Delete Task')
    await pressKey(command, 'Enter', 13)
    await until(() => evaluate('Boolean(boardTest.deletes[0])'), 'delete during recovery')
    await evaluate('boardTest.deletes[0].resolve({ deleted: true })')
    await until(async () => !await visible('Edited during recovery'), 'confirmed delete')
    assert.equal(await visible(message), true)

    for (const width of [320, 375, 768, 1024, 1440]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: false })
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'page fits at ' + width)
      assert.equal(await evaluate(`(() => {
        const button = ${button('Refresh Board')}
        return button.getBoundingClientRect().right <= innerWidth && button.offsetHeight >= 44
      })()`), true, 'recovery action fits at ' + width)
      if (width === 320) {
        await evaluate(`document.querySelector('[aria-label="Open navigation"]').click()`)
        await until(() => evaluate('document.querySelector("#workspace-drawer").open'), 'mobile drawer')
        assert.equal(await evaluate('document.querySelector("#workspace-drawer").textContent.includes("Overview")'), false)
        await evaluate('document.querySelector("#workspace-drawer button").click()')
        await until(() => evaluate('document.activeElement.ariaLabel === "Open navigation"'), 'drawer focus restores')
      }
    }

    await moveThroughControl(evaluate, c.id, 'done')
    await waitForUpdate(3)
    await evaluate(button('Refresh Board') + '.focus()')
    await pressKey(command, 'Enter', 13)
    await waitForRequest(1)
    assert.equal(await evaluate('boardTest.requests[1].guestId'), 'guest-a')
    assert.equal(await visible(message), true)
    await pressKey(command, 'Enter', 13)
    assert.equal(await evaluate('boardTest.requests.length'), 2)
    await loseResponse(3)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await resolveRequest(1, [{ ...a, status: 'done' }, movedB, c])
    await until(() => visible('Refresh Board'), 'newer uncertainty remains across older refresh')
    assert.equal(await cardColumn(evaluate, a.id), 'done')

    await clickButton(evaluate, 'Refresh Board')
    await waitForRequest(2)
    await evaluate('boardTest.requests[2].reject(new Error("private detail"))')
    await until(() => visible('Unable to load your tasks'), 'friendly refresh failure')
    assert.equal(await visible(message), true)
    assert.equal(await visible('private detail'), false)

    await evaluate(button('Refresh Board') + '.focus()')
    await pressKey(command, 'Enter', 13)
    await waitForRequest(3)
    const movedC = { ...c, status: 'done' }
    await resolveRequest(3, [{ ...a, status: 'done' }, movedB, movedC])
    await until(async () => !await visible(message), 'successful reconciliation')
    assert.deepEqual(await evaluate(columnCounts), [0, 0, 0, 3])
    assert.equal(await evaluate('document.activeElement.matches(' + JSON.stringify(boardSelector) + ')'), true)

    await moveThroughControl(evaluate, b.id, 'in_review')
    await waitForUpdate(4)
    await loseResponse(4)
    await until(() => visible(message), 'notice to dismiss')
    await evaluate(button('Refresh Board') + '.focus()')
    await pressKey(command, 'Tab', 9)
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), 'Dismiss')
    assert.equal(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'solid')
    await pressKey(command, 'Enter', 13)
    await until(async () => !await visible(message), 'dismisses with keyboard')
    assert.equal(await evaluate('document.activeElement.matches(' + JSON.stringify(boardSelector) + ')'), true)
    assert.equal(await evaluate('boardTest.updates.length'), 5)
    assert.equal(await evaluate('boardTest.requests.length'), 4)
    assert.equal(await cardColumn(evaluate, b.id), 'done')

    await moveThroughControl(evaluate, b.id, 'todo')
    await waitForUpdate(5)
    await loseResponse(5)
    await until(() => visible(message), 'old guest notice')
    await clickButton(evaluate, 'Refresh Board')
    await waitForRequest(4)
    await setGuest('guest-b')
    await waitForRequest(5)
    await resolveRequest(5, [next])
    await until(() => evaluate(newTaskEnabled), 'next guest board')
    assert.equal(await visible(message), false)
    await moveThroughControl(evaluate, next.id, 'todo')
    await waitForUpdate(6)
    await loseResponse(6)
    await until(() => visible(message), 'new guest notice')
    await resolveRequest(4, [{ ...b, status: 'todo' }])
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await visible(message), true)
    assert.equal(await cardColumn(evaluate, next.id), 'in_review')
    assert.equal(await cardColumn(evaluate, b.id), undefined)
  })
})
