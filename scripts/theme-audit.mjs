#!/usr/bin/env node
/**
 * Проверка тем: тёмная везде тёмная, светлая везде светлая, текст читается.
 *
 * Для каждой страницы в обеих темах ищет две вещи:
 *  - крупную нейтральную поверхность «не того тона» (светлую в тёмной теме и наоборот;
 *    сайдбары не считаются — они намеренно тёмные и в светлой теме);
 *  - текст с контрастом ниже нормы WCAG AA (4.5, у крупного текста 3).
 *
 * Запуск (нужен локальный стенд на тестовой базе и Chrome с отладочным портом):
 *   scripts/dev-seed.sh
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
 *     --remote-debugging-port=9333 --user-data-dir=/tmp/tte-theme-audit &
 *   node scripts/theme-audit.mjs 9333
 *
 * Код выхода 1, если что-то найдено — годится для CI.
 *
 * Переменные окружения:
 *   THEME_AUDIT_URL       адрес фронта (по умолчанию http://127.0.0.1:5173)
 *   THEME_AUDIT_EMAIL     вход для кабинета ментора и CRM (по умолчанию админ из сида)
 *   THEME_AUDIT_PASSWORD  пароль к нему
 *   THEME_AUDIT_SURFACES  mentor,crm,student (student — только вместе с токеном ниже)
 *   THEME_AUDIT_STUDENT_TOKEN  токен тестового ученика: у сидовых учеников нет пароля
 *
 * Безопасность: скрипт работает только с localhost и отказывается идти дальше, если
 * на странице нет баннера «ТЕСТОВАЯ БАЗА» (его рисует стенд на tte_seed).
 */

const base = (process.env.THEME_AUDIT_URL || 'http://127.0.0.1:5173').replace(/\/$/, '')
const email = process.env.THEME_AUDIT_EMAIL || 'admin@seed.teenteched.test'
const password = process.env.THEME_AUDIT_PASSWORD || 'SeedAdmin#2026'
const studentToken = process.env.THEME_AUDIT_STUDENT_TOKEN || ''
const apiBase = process.env.THEME_AUDIT_API || 'http://127.0.0.1:8099/api/v1'
const port = Number(process.argv[2] || 9333)
const surfaces = (process.env.THEME_AUDIT_SURFACES || (studentToken ? 'student,mentor,crm' : 'mentor,crm')).split(',')

const host = new URL(base).hostname
if (!['127.0.0.1', 'localhost'].includes(host)) {
  console.error(`Отказ: ${host} не локальный адрес. Скрипт работает только на стенде с тестовой базой.`)
  process.exit(2)
}

const ROUTES = {
  student: ['', '/roadmap', '/tasks', '/meetings', '/notes', '/complaints', '/questionnaires', '/important-notes', '/documents', '/notifications', '/chat', '/universities', '/shortlist', '/applications', '/countries', '/profile'].map((p) => '/portal' + p),
  mentor: ['', '/students', '/roadmap', '/tasks', '/review', '/mentor-tasks', '/my-tasks', '/checkins', '/questionnaires', '/meetings', '/documents', '/notes', '/chat', '/universities', '/countries', '/agreements', '/complaints', '/refund-cases', '/security-incidents', '/mzk-quality', '/mentor-rewards', '/my-rewards', '/my-day', '/notifications', '/profile', '/status'].map((p) => '/workspace' + p),
  crm: ['/dashboard', '/students', '/students/distribution', '/students/new', '/notes', '/my-students', '/countries', '/finances', '/statistics', '/settings/users', '/settings/responsibilities', '/settings/access-requests', '/settings/permissions', '/telegram-inbox', '/status-inbox', '/roadmap-templates', '/knowledge-base', '/universities', '/complaints', '/refund-cases', '/agreements', '/mentor-tasks', '/checkins', '/my-tasks', '/mzk-quality', '/mentor-rewards'],
}

/** Выполняется внутри страницы. Не использует ничего снаружи — сериализуется целиком. */
function auditInPage() {
  const parse = (c) => (c.match(/[\d.]+/g) || [0, 0, 0, 1]).slice(0, 4).map(Number)
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const theme = document.documentElement.dataset.theme || document.documentElement.dataset.crmTheme || 'unknown'
  const pageBg = parse(getComputedStyle(document.body).backgroundColor)
  const effectiveBg = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.backgroundImage !== 'none') return null // градиент/картинка: фон не определить
      const c = parse(cs.backgroundColor)
      if ((c[3] ?? 1) >= 0.95) return c
    }
    return (pageBg[3] ?? 1) > 0.5 ? pageBg : [255, 255, 255]
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return false
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.5) return false
    }
    return true
  }
  const surfaces = []
  const text = new Map()
  for (const el of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'IMG'].includes(el.tagName) || el instanceof SVGElement || !visible(el)) continue
    const cs = getComputedStyle(el)
    const bg = parse(cs.backgroundColor)
    const r = el.getBoundingClientRect()
    const area = r.width * r.height
    const neutral = Math.max(...bg.slice(0, 3)) - Math.min(...bg.slice(0, 3)) < 40
    if (!el.closest('aside') && (bg[3] ?? 1) >= 0.9 && area > 6000 && neutral && cs.backgroundImage === 'none') {
      const l = lum(bg)
      if ((theme === 'light' && l < 0.3) || (theme === 'dark' && l > 0.45)) {
        surfaces.push({ cls: String(el.className).slice(0, 70), bg: cs.backgroundColor, area: Math.round(area) })
      }
    }
    const own = Array.from(el.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim().length > 0)
    if (!own) continue
    const bgE = effectiveBg(el)
    if (!bgE) continue
    const fg = parse(cs.color)
    const a = fg[3] ?? 1
    const blended = fg.slice(0, 3).map((v, i) => Math.round(v * a + bgE[i] * (1 - a)))
    const size = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight, 10) >= 700
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5
    const got = ratio(blended, bgE)
    if (got < need) {
      const key = own.textContent.trim().slice(0, 28) + '|' + cs.color
      if (!text.has(key)) text.set(key, { text: own.textContent.trim().slice(0, 28), color: cs.color, bg: `rgb(${bgE.join(',')})`, ratio: +got.toFixed(2), cls: String(el.className).slice(0, 60) })
    }
  }
  return { theme, surfaces: surfaces.slice(0, 5), surfaceCount: surfaces.length, text: [...text.values()].sort((x, y) => x.ratio - y.ratio).slice(0, 30), textCount: text.size }
}

// ---------- минимальный клиент CDP (как в workspace-browser-smoke.mjs, без Playwright) ----------
const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json()).catch(() => null)
if (!target) {
  console.error(`Не удалось подключиться к Chrome на порту ${port}. Запустите его с --remote-debugging-port=${port} (см. шапку файла).`)
  process.exit(2)
}
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })

let nextId = 0
const pending = new Map()
const listeners = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id)
    pending.delete(message.id)
    return message.error ? reject(new Error(message.error.message)) : resolve(message.result)
  }
  for (const fn of listeners.get(message.method) ?? []) fn(message.params)
})
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn])
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text)
  return result.value
}
async function goto(path) {
  const loaded = new Promise((resolve) => on('Page.loadEventFired', () => resolve()))
  await send('Page.navigate', { url: base + path })
  await Promise.race([loaded, sleep(8000)])
  await sleep(1500)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })

let studentPhase = false
// Ученик входит только через Google: подставляем ответ обновления сессии, а не пароль.
if (surfaces.includes('student')) {
  if (!studentToken) { console.error('Для student нужен THEME_AUDIT_STUDENT_TOKEN.'); process.exit(2) }
  const me = await fetch(`${apiBase}/auth/me`, { headers: { Authorization: `Bearer ${studentToken}` } }).then((r) => r.json())
  const body = Buffer.from(JSON.stringify({ access_token: studentToken, token_type: 'bearer', expires_in: 3600, user: me })).toString('base64')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/auth/refresh', requestStage: 'Request' }] })
  const cors = [
    { name: 'Access-Control-Allow-Origin', value: base },
    { name: 'Access-Control-Allow-Credentials', value: 'true' },
    { name: 'Access-Control-Allow-Headers', value: '*' },
    { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
  ]
  on('Fetch.requestPaused', (p) => {
    const hit = p.request.url.includes('/auth/refresh') && studentPhase
    if (!hit) return send('Fetch.continueRequest', { requestId: p.requestId })
    // Фронт (:5173) и API (:8099) на разных origin: сначала браузер шлёт OPTIONS, на него тоже нужен ответ.
    if (p.request.method === 'OPTIONS') return send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 204, responseHeaders: cors })
    send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...cors], body })
  })
}

async function login() {
  await goto('/login')
  const banner = await evaluate(`document.body.innerText.includes('ТЕСТОВАЯ БАЗА')`)
  if (!banner) { console.error('Отказ: на странице нет баннера «ТЕСТОВАЯ БАЗА». Скрипт нужен только для стенда на tte_seed.'); process.exit(2) }
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[type=email]'), ${JSON.stringify(email)})
    set(document.querySelector('input[type=password]'), ${JSON.stringify(password)})
    document.querySelector('form').requestSubmit()
  })()`)
  await sleep(3000)
}

async function ensureTheme(want) {
  for (let i = 0; i < 2; i++) {
    const current = await evaluate(`document.documentElement.dataset.theme || document.documentElement.dataset.crmTheme`)
    if (current === want) return
    const label = want === 'light' ? 'Включить светлую тему' : 'Включить тёмную тему'
    await evaluate(`document.querySelector('button[aria-label="${label}"]')?.click()`)
    await sleep(500)
  }
}

let loggedIn = false
const findings = []
const summary = []
for (const surface of surfaces) {
  studentPhase = surface === 'student'
  if (!studentPhase && !loggedIn) { await login(); loggedIn = true }
  for (const want of ['dark', 'light']) {
    let pages = 0, notApplied = 0, badSurfaces = 0, lowContrast = 0
    for (const route of ROUTES[surface]) {
      await goto(route)
      await ensureTheme(want)
      const result = await evaluate(`(${auditInPage.toString()})()`)
      pages += 1
      if (result.theme !== want) { notApplied += 1; findings.push(`${surface} ${want} ${route}: тема не применилась (${result.theme})`) }
      badSurfaces += result.surfaceCount
      lowContrast += result.textCount
      for (const s of result.surfaces) findings.push(`${surface} ${want} ${route}: поверхность не того тона ${s.bg} (${s.area}px²) .${s.cls}`)
      for (const t of result.text) findings.push(`${surface} ${want} ${route}: контраст ${t.ratio} «${t.text}» ${t.color} на ${t.bg} .${t.cls}`)
    }
    summary.push({ surface, theme: want, pages, notApplied, badSurfaces, lowContrast })
  }
}

console.log('\nповерхность  тема    страниц  не применилась  чужие поверхности  низкий контраст')
for (const s of summary) console.log(`${s.surface.padEnd(12)}${s.theme.padEnd(8)}${String(s.pages).padStart(7)}${String(s.notApplied).padStart(16)}${String(s.badSurfaces).padStart(19)}${String(s.lowContrast).padStart(17)}`)
if (findings.length) {
  console.log(`\nНайдено проблем: ${findings.length}`)
  for (const line of findings.slice(0, 60)) console.log(' - ' + line)
  if (findings.length > 60) console.log(` … и ещё ${findings.length - 60}`)
}
socket.close()
process.exit(findings.length ? 1 : 0)
