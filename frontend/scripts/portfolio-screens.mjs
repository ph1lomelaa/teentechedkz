// Скриншоты экранов Portfolio UP на стенде docker-compose.portfolio.yml.
// 1440 и 390 px, светлая и тёмная тема, ученик и ментор.
//
//   BASE_URL=http://localhost:3017 node scripts/portfolio-screens.mjs [--only student|mentor]
//
// Снимки и summary.json в /tmp/portfolio-screens/<дата-время>/. Код выхода 1, если
// на странице была ошибка JS или горизонтальная прокрутка.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3017'
const PASSWORD = process.env.PREVIEW_PASSWORD ?? 'PortfolioPreview2026!'
const THEME_KEY = 'teenteched-theme-v2'
const WIDTHS = [1440, 390]
const THEMES = ['light', 'dark']

// `follow` открывает первую ссылку, подходящую под селектор, на странице `path`.
const ROLES = {
  student: {
    email: 'portfolio.preview.student@example.test',
    screens: [
      { name: 'portfolio', path: '/portal/activities' },
      { name: 'catalog', path: '/portal/activities?view=catalog' },
      { name: 'participation', path: '/portal/activities', follow: 'a[href*="/portal/activities/participations/"]' },
      { name: 'activity', path: '/portal/activities?view=catalog', follow: 'a[href^="/portal/activities/"]:not([href*="participations"])' },
      { name: 'home', path: '/portal' },
      { name: 'tasks', path: '/portal/tasks' },
    ],
  },
  mentor: {
    email: 'portfolio.preview.mentor@example.test',
    screens: [
      { name: 'students', path: '/workspace/activities' },
      { name: 'catalog', path: '/workspace/activities?view=catalog' },
      { name: 'review', path: '/workspace/review' },
      { name: 'tasks', path: '/workspace/tasks' },
      { name: 'participation', path: '/workspace/review', follow: 'a[href*="/workspace/activities/participations/"]' },
      { name: 'student-card', path: '/workspace/students', follow: 'a[href^="/workspace/students/"]', hash: '#portfolio' },
    ],
  },
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = join('/tmp/portfolio-screens', stamp)
mkdirSync(outDir, { recursive: true })

async function login(context, email) {
  const page = await context.newPage()
  await page.goto(`${BASE_URL}/login`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15000 })
  await page.close()
}

async function open(page, screen) {
  await page.goto(`${BASE_URL}${screen.path}`)
  await page.waitForLoadState('networkidle')
  if (!screen.follow) return true
  const link = page.locator(screen.follow).first()
  if (!(await link.count())) return false
  const href = await link.getAttribute('href')
  await page.goto(`${BASE_URL}${href}${screen.hash ?? ''}`)
  await page.waitForLoadState('networkidle')
  return true
}

// Полный Chromium в новом headless-режиме: отдельный headless-shell скачивать не нужно.
const browser = await chromium.launch({ headless: true, channel: 'chromium' })
const summary = []
let failed = false
for (const [role, config] of Object.entries(ROLES)) {
  if (only && only !== role) continue
  for (const theme of THEMES) {
    const context = await browser.newContext()
    await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value) } catch { /* private mode */ } }, [THEME_KEY, theme])
    await login(context, config.email)
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(String(error)))
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: width > 600 ? 900 : 844 })
      for (const screen of config.screens) {
        errors.length = 0
        const found = await open(page, screen)
        await page.waitForTimeout(400)
        const file = `${role}-${screen.name}-${width}-${theme}.png`
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
        // fullPage склеивает снимок без изменения окна: sticky-меню высотой 100dvh
        // остаётся в один экран и под ним пусто. Растягиваем само окно.
        const height = width > 600 ? 900 : 844
        if (found) {
          await page.setViewportSize({ width, height: Math.max(height, await page.evaluate(() => document.documentElement.scrollHeight)) })
          await page.waitForTimeout(200)
          await page.screenshot({ path: join(outDir, file) })
          await page.setViewportSize({ width, height })
        }
        const row = { role, screen: screen.name, width, theme, url: page.url(), found, overflow, errors: [...errors], file: found ? file : null }
        if (overflow || errors.length) failed = true
        summary.push(row)
        console.log(`${found ? (overflow || errors.length ? 'WARN' : 'ok  ') : 'skip'} ${file}${overflow ? ' · горизонтальная прокрутка' : ''}${errors.length ? ` · ошибок JS: ${errors.length}` : ''}`)
      }
    }
    await context.close()
  }
}
await browser.close()
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\n${outDir}`)
process.exit(failed ? 1 : 0)
