import { describe, expect, it } from 'vitest'
import { normalizeMeetingLink } from './meetingLink'

describe('normalizeMeetingLink', () => {
  it('пустое остаётся пустым', () => {
    expect(normalizeMeetingLink('')).toBe('')
    expect(normalizeMeetingLink('   ')).toBe('')
    expect(normalizeMeetingLink(null)).toBe('')
  })
  it('дополняет схему и сохраняет путь', () => {
    expect(normalizeMeetingLink('zoom.us/j/123?pwd=x')).toBe('https://zoom.us/j/123?pwd=x')
    expect(normalizeMeetingLink(' https://meet.google.com/abc-defg-hij ')).toBe('https://meet.google.com/abc-defg-hij')
  })
  it('отклоняет мусор', () => {
    for (const bad of ['ss', '/students', 'javascript:alert(1)', 'ftp://x.com/a', 'две слова.ru']) {
      expect(normalizeMeetingLink(bad)).toBeNull()
    }
  })
})
