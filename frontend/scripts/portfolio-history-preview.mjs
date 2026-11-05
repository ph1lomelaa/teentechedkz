import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const base = 'http://127.0.0.1:3017'
const out = resolve('../output/portfolio-history')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const errors = []
async function session(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', e => errors.push(String(e)))
  await page.goto(base + '/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill('PortfolioPreview2026!')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'))
  return { context, page }
}
async function snap(page, name) {
  console.log('screenshot', name)
  await page.screenshot({ timeout: 15000, path: `${out}/${name}.png`, fullPage: true })
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error(`Overflow: ${name}`)
}
const student = await session('portfolio.preview.student@example.test')
const page = student.page
await page.goto(base + '/portal/activities')
await page.getByRole('button', { name: 'Добавить прошлую активность', exact: true }).waitFor()
await snap(page, '01-where-to-add')
const previous = page.getByRole('link', { name: /Городская олимпиада по биологии · пример/ }).first()
if (await previous.count()) {
  await previous.click()
  await page.getByRole('button', { name: 'Изменить прошлую активность', exact: true }).click()
} else await page.getByRole('button', { name: 'Добавить прошлую активность', exact: true }).click()
await page.getByLabel('Название активности').fill('Городская олимпиада по биологии · пример')
await page.getByLabel('Тип опыта', { exact: true }).selectOption('competitions')
await page.getByLabel('Период участия').fill('2024–2025 учебный год')
await page.getByLabel('Роль ученика — необязательно').fill('Участник')
await page.getByLabel('Результат участия').fill('Заняла второе место. Подготовила исследовательскую работу по экологии.')
await page.getByLabel('Организатор — необязательно', { exact: true }).fill('Городской образовательный центр')
await snap(page, '02-history-form')
const response = page.waitForResponse(r => r.url().includes('/activities/history') && ['POST', 'PUT'].includes(r.request().method()))
await page.getByRole('button', { name: 'Сохранить и отправить на проверку' }).click()
const saved = await response
if (![200, 201].includes(saved.status())) throw Error(await saved.text())
const item = await saved.json()
await page.goto(base + '/portal/activities/participations/' + item.id)
await page.getByText('На проверке у ментора', { exact: true }).waitFor()
await snap(page, '03-saved-without-link')
const mentor = await session('portfolio.preview.mentor@example.test')
await mentor.page.goto(base + '/workspace/activities/participations/' + item.id)
await mentor.page.getByRole('button', { name: 'Подтвердить итог', exact: true }).waitFor()
await snap(mentor.page, '04-mentor-review')
await mentor.page.getByRole('button', { name: 'Подтвердить итог', exact: true }).click()
await mentor.page.getByText('Подтверждено ментором', { exact: true }).waitFor()
await snap(mentor.page, '05-confirmed')
await page.goto(base + '/portal/activities')
await page.getByRole('link', { name: /Городская олимпиада по биологии · пример/ }).waitFor()
await snap(page, '06-achievements')
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(base + '/portal/activities/participations/' + item.id)
await page.getByText('Подтверждено ментором', { exact: true }).waitFor()
await snap(page, '07-mobile')
writeFileSync(`${out}/verification.json`, JSON.stringify({ participation_id: item.id, student_id: item.student_id, errors, mentor_url: base + '/workspace/students/' + item.student_id + '?p=' + item.id + '#portfolio' }, null, 2))
await mentor.context.storageState({ path: '/tmp/portfolio-history-mentor-state.json' })
await browser.close()
if (errors.length) throw Error(errors.join('\n'))
console.log(out)
