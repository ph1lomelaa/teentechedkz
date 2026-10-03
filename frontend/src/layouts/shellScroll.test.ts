import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// position: sticky не работает, если у предка overflow-x: hidden/auto — тот
// становится контейнером прокрутки, который сам не скроллится, и сайдбар
// уезжает вместе со страницей. Защита от возврата этого бага.
const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')

const shells = {
  workspace: read('layouts/WorkspaceLayout.tsx'),
  portal: read('components/portal/StudentPortalLayout.tsx'),
}

describe('оболочки со sticky-сайдбаром', () => {
  it.each(Object.entries(shells))('%s: корень оболочки не создаёт контейнер прокрутки', (_, src) => {
    const root = src.match(/<div className="portal[^"]*"/)?.[0] ?? ''
    expect(root).toContain('overflow-x-clip')
    expect(root).not.toContain('overflow-x-hidden')
  })

  it.each(Object.entries(shells))('%s: сайдбар на высоту окна в dvh', (_, src) => {
    expect(src).toMatch(/sticky top-0[^"']*h-\[100dvh\]|lg:sticky lg:top-0 lg:h-\[100dvh\]/)
    expect(src).not.toMatch(/sticky top-0 hidden h-screen/)
  })

  it('CRM-оболочка: высота 100dvh и прокрутка внутри main', () => {
    const src = read('components/shared/Layout.tsx')
    expect(src).toContain('crm-shell flex h-[100dvh]')
    expect(src).toMatch(/<main[^>]*overflow-y-auto/)
  })

  it('html/body не используют голый overflow-x: hidden', () => {
    const css = read('index.css')
    const base = css.slice(css.indexOf('@layer base'), css.indexOf('@layer components'))
    for (const m of base.matchAll(/overflow-x:\s*hidden;(\s*)(overflow-x:\s*clip;)?/g)) {
      expect(m[2]).toBeTruthy()
    }
  })
})
