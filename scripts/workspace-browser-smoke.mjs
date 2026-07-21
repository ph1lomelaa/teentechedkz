import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envText = fs.readFileSync(path.join(root, '.env'), 'utf8')
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]
    }),
)

const email = env.FIRST_ADMIN_EMAIL || 'admin@teenteched.kz'
const password = env.FIRST_ADMIN_PASSWORD
if (!password) throw new Error('FIRST_ADMIN_PASSWORD is missing in .env')

const port = Number(process.argv[2] || 9228)
const target = await fetch(`http://127.0.0.1:${port}/json/new?http://127.0.0.1:3000/`, { method: 'PUT' }).then((res) => res.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let commandId = 0
const pending = new Map()
const eventWaiters = new Map()
const browserErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) reject(new Error(message.error.message))
    else resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    browserErrors.push(message.params.exceptionDetails?.text || 'Runtime exception')
  }
  if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
    browserErrors.push(message.params.entry.text)
  }
  const waiters = eventWaiters.get(message.method)
  if (waiters?.length) waiters.shift()(message.params)
})

function send(method, params = {}) {
  const id = ++commandId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

function waitForEvent(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMs)
    const resolveOnce = (params) => {
      clearTimeout(timeout)
      resolve(params)
    }
    const waiters = eventWaiters.get(method) || []
    waiters.push(resolveOnce)
    eventWaiters.set(method, waiters)
  })
}

async function navigate(url) {
  const loaded = waitForEvent('Page.loadEventFired')
  await send('Page.navigate', { url })
  await loaded
  await new Promise((resolve) => setTimeout(resolve, 900))
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Evaluation failed')
  return result.result?.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await navigate('http://127.0.0.1:3000/')

const loginStatus = await evaluate(`(async () => {
  const response = await fetch('http://127.0.0.1:8001/api/v1/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(${JSON.stringify({ email, password })})
  });
  return response.status;
})()`)
if (loginStatus !== 200) throw new Error(`Local admin login failed with ${loginStatus}`)
browserErrors.length = 0

const viewports = [
  { name: 'desktop', width: 1440, height: 1000, scale: 1 },
  { name: 'mobile', width: 390, height: 844, scale: 1 },
]
const routes = ['/workspace', '/workspace/students', '/workspace/roadmap', '/workspace/tasks', '/workspace/meetings', '/workspace/documents', '/workspace/chat', '/workspace/universities', '/workspace/countries']
const results = []

for (const viewport of viewports) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.scale,
    mobile: viewport.name === 'mobile',
  })
  for (const route of routes) {
    await navigate(`http://127.0.0.1:3000${route}`)
    if (route === '/workspace/chat') {
      await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('Подключить Telegram-группу'));
        button?.click();
        return Boolean(button);
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 900))
      const chatScreenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(`/tmp/tte-workspace-chat-${viewport.name}.png`, Buffer.from(chatScreenshot.data, 'base64'))
    }
    const audit = await evaluate(`(() => ({
      path: location.pathname,
      heading: document.querySelector('h1')?.textContent?.trim() || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      crmLinks: [...document.querySelectorAll('a')].filter((a) => /CRM|Общие данные/i.test(a.textContent || '') || /\\/dashboard/.test(a.getAttribute('href') || '')).length,
      unnamedButtons: [...document.querySelectorAll('button')].filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent?.trim())).length,
      unnamedInputs: [...document.querySelectorAll('input,select,textarea')].filter((el) => !(el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.id && document.querySelector('label[for="' + el.id + '"]') || el.getAttribute('placeholder'))).length,
    }))()`)
    results.push({ viewport: viewport.name, route, ...audit })
  }
  await navigate('http://127.0.0.1:3000/workspace')
  const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  fs.writeFileSync(`/tmp/tte-workspace-${viewport.name}.png`, Buffer.from(screenshot.data, 'base64'))
}

const failures = results.filter((item) => item.path !== item.route || !item.heading || item.overflow || item.crmLinks || item.unnamedButtons || item.unnamedInputs)
await evaluate(`fetch('http://127.0.0.1:8001/api/v1/auth/logout', {
  method: 'POST',
  credentials: 'include',
  headers: {'Content-Type': 'application/json'}
}).then((response) => response.status)`)
console.log(JSON.stringify({ checked: results.length, failures, browserErrors: [...new Set(browserErrors)], screenshots: ['/tmp/tte-workspace-desktop.png', '/tmp/tte-workspace-mobile.png', '/tmp/tte-workspace-chat-desktop.png', '/tmp/tte-workspace-chat-mobile.png'] }, null, 2))
socket.close()
if (failures.length || browserErrors.length) process.exitCode = 1
