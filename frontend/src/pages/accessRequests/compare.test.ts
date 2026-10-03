import { describe, expect, it } from 'vitest'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
import { buildComparison, normalizePhone, reasonExplanation, sameName } from './compare'

const card = (over: Partial<StudentCandidate> = {}): StudentCandidate => ({
  id: 'c1',
  full_name: 'Сарсенова Мадина Ермековна',
  phone: '+7 (701) 000-00-02',
  intake_year: 2026,
  reason: 'phone',
  reason_label: 'телефон',
  is_free: true,
  portal_owner: null,
  ...over,
})
const item = (over: Partial<AccessRequestItem> = {}): AccessRequestItem => ({
  id: 'r1',
  user: { id: 'u1', email: 'm@x.kz', name: 'М', is_active: false },
  requested_role: 'student',
  full_name: 'Сарсенова Мадина',
  phone: '8 701 000 00 02',
  city: 'Алматы',
  direction: null,
  candidates: [],
  suggested_student: null,
  confidence: null,
  method: null,
  method_label: null,
  status: 'new',
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})
const byKey = (rows: ReturnType<typeof buildComparison>) => Object.fromEntries(rows.map((r) => [r.key, r.status]))

describe('нормализация телефона', () => {
  it('приводит +7, 8, пробелы и скобки к одному виду', () => {
    const forms = ['+7 (701) 000-00-02', '8 701 000 00 02', '87010000002', '7 701 000 00 02']
    expect(new Set(forms.map(normalizePhone))).toEqual(new Set(['77010000002']))
  })
  it('не склеивает разные номера', () => {
    expect(normalizePhone('+7 701 000 00 03')).not.toBe(normalizePhone('+7 701 000 00 02'))
  })
})

describe('сравнение полей', () => {
  it('другой формат телефона — совпадение, а не расхождение', () => {
    expect(byKey(buildComparison(item(), card())).phone).toBe('match')
  })
  it('имя без отчества совпадает с полным, другое — расходится', () => {
    expect(sameName('Сарсенова Мадина', 'Сарсенова Мадина Ермековна')).toBe(true)
    expect(sameName('Ёлкин Иван', 'Елкин Иван Петрович')).toBe(true)
    expect(byKey(buildComparison(item({ full_name: 'Иванов Пётр' }), card())).name).toBe('diff')
  })
  it('нет данных: год у заявки, email без кабинета, город — пока его нет у карточки', () => {
    const s = byKey(buildComparison(item(), card()))
    expect(s.year).toBe('missing')
    expect(s.city).toBe('missing')
    expect(s.email).toBe('missing')
  })
  it('город сравнивается, когда он есть с обеих сторон (без учёта регистра)', () => {
    expect(byKey(buildComparison(item(), card({ city: 'алматы' }))).city).toBe('match')
    expect(byKey(buildComparison(item(), card({ city: 'Астана' }))).city).toBe('diff')
    expect(byKey(buildComparison(item({ city: null }), card({ city: 'Астана' }))).city).toBe('missing')
  })
  it('пустой телефон — «нет данных», а не расхождение', () => {
    expect(byKey(buildComparison(item({ phone: '' }), card())).phone).toBe('missing')
  })
  it('email кабинета сравнивается без учёта регистра', () => {
    const owner = { email: 'M@X.kz', last_login_at: null, is_active: true }
    expect(byKey(buildComparison(item(), card({ portal_owner: owner, is_free: false }))).email).toBe('match')
    expect(
      byKey(buildComparison(item(), card({ portal_owner: { ...owner, email: 'other@x.kz' }, is_free: false }))).email,
    ).toBe('diff')
  })
})

describe('расшифровка причины', () => {
  it('простыми словами', () => {
    expect(reasonExplanation(card(), 1)).toBe('Телефон совпал')
    expect(reasonExplanation(card(), 2)).toBe('Два кандидата с одним телефоном')
    expect(reasonExplanation(card({ reason: 'name' }), 0)).toBe('ФИО похоже, телефон другой')
  })
})
