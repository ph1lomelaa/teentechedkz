import { describe, expect, it } from 'vitest'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
import { getRequestGroup, isSameAccount, looksLikeSameAccount, matchesSearch } from './groups'

const candidate = (
  reason: 'phone' | 'name',
  is_free: boolean,
  owner?: { user_id?: string; email: string },
): StudentCandidate => ({
  id: crypto.randomUUID(),
  full_name: 'Ученик',
  phone: '+7 700 000 00 00',
  intake_year: 2026,
  reason,
  reason_label: reason,
  is_free,
  portal_owner: owner ? { ...owner, last_login_at: null, is_active: true } : null,
})

const request = (
  candidates: StudentCandidate[],
  over: Partial<AccessRequestItem> = {},
): AccessRequestItem => ({
  id: crypto.randomUUID(),
  user: { id: 'u-1', email: 'a@x.kz', name: 'А', is_active: false },
  requested_role: 'student',
  full_name: 'Ученик Тестовый',
  phone: '+7 700 000 00 00',
  city: null,
  direction: null,
  candidates,
  suggested_student: null,
  confidence: null,
  method: null,
  method_label: null,
  status: 'new',
  created_at: '2026-10-01T00:00:00Z',
  ...over,
})

describe('группа заявки', () => {
  it('одна свободная карточка по телефону — прикрепить', () => {
    expect(getRequestGroup(request([candidate('phone', true)]))).toBe('attach')
  })
  it('телефон совпал, кабинет у другого — кабинет занят', () => {
    expect(getRequestGroup(request([candidate('phone', false, { email: 'b@x.kz' })]))).toBe('busy')
  })
  it('владелец карточки — сам заявитель (по user_id) — уже привязан', () => {
    expect(getRequestGroup(request([candidate('phone', false, { user_id: 'u-1', email: 'a@x.kz' })]))).toBe('linked')
  })
  it('без user_id владельца (старый бэкенд) совпадение email группу не меняет, но даёт подсказку', () => {
    const item = request([candidate('phone', false, { email: 'A@x.kz' })])
    expect(getRequestGroup(item)).toBe('busy')
    expect(isSameAccount(item, item.candidates[0])).toBe(false)
    expect(looksLikeSameAccount(item)).toBe(true)
  })
  it('когда user_id владельца пришёл, подсказка по email не нужна и чужой user_id — это «кабинет занят»', () => {
    const own = request([candidate('phone', false, { user_id: 'u-1', email: 'a@x.kz' })])
    expect(looksLikeSameAccount(own)).toBe(false)
    const other = request([candidate('phone', false, { user_id: 'u-2', email: 'a@x.kz' })])
    expect(getRequestGroup(other)).toBe('busy')
  })
  it('только ФИО или несколько кандидатов — проверить', () => {
    expect(getRequestGroup(request([candidate('name', false)]))).toBe('check')
    expect(getRequestGroup(request([candidate('phone', true), candidate('phone', true)]))).toBe('check')
  })
  it('нет кандидатов — создать; ментор — ментор', () => {
    expect(getRequestGroup(request([]))).toBe('create')
    expect(getRequestGroup(request([], { phone: '' }))).toBe('create')
    expect(getRequestGroup(request([], { requested_role: 'mentor' }))).toBe('mentor')
  })
})

describe('поиск', () => {
  it('находит по имени, email и цифрам телефона в любом формате', () => {
    const item = request([])
    expect(matchesSearch(item, 'тестов')).toBe(true)
    expect(matchesSearch(item, 'A@X.KZ')).toBe(true)
    expect(matchesSearch(item, '700 000')).toBe(true)
    expect(matchesSearch(item, 'нет такого')).toBe(false)
  })
})
