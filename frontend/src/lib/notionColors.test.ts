import { describe, expect, it } from 'vitest'
import { NOTION_COLORS, NOTION_PALETTE, buildNotionCss, notionTagClass, toNotionColor } from './notionColors'

/**
 * Контраст как правило, а не на глаз: в тёмной теме теги Notion были
 * зелёным текстом на зелёном фоне, и это никто не ловил, пока не открыл экран.
 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Фон карточки/строки и основной текст темы (index.css: --crm-panel / --crm-text).
const CARD = { light: '#FFFFFF', dark: '#141414' }
const TEXT = { light: '#17170F', dark: '#F5F5F3' }

describe('палитра тегов Notion', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const color of NOTION_COLORS) {
      const pair = NOTION_PALETTE[color][theme]
      it(`${theme} · ${color}: текст читается, тег виден на карточке, заголовок колонки читается`, () => {
        expect(contrast(pair.text, pair.bg)).toBeGreaterThanOrEqual(4.5)
        expect(contrast(pair.bg, CARD[theme])).toBeGreaterThanOrEqual(1.1)
        expect(contrast(TEXT[theme], pair.soft)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('незнакомый цвет из Notion падает в default, а не ломает тег', () => {
    expect(toNotionColor('teal')).toBe('default')
    expect(toNotionColor(undefined)).toBe('default')
    expect(notionTagClass('green')).toBe('notion-tag notion-tag--green')
  })

  it('CSS содержит обе темы для каждого цвета', () => {
    const css = buildNotionCss()
    for (const color of NOTION_COLORS) {
      expect(css).toContain(`.notion-tag--${color}{--nt-bg:${NOTION_PALETTE[color].dark.bg}`)
      expect(css).toContain(`[data-theme='light'] .notion-tag--${color}`)
    }
  })
})
