import { describe, expect, it } from 'vitest'
import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'
import { isAutoApprovable } from './SettingsAccessRequestsPage'

const candidate = (reason: 'phone' | 'name', is_free: boolean): StudentCandidate => ({
  id: crypto.randomUUID(),
  full_name: 'Ученик',
  phone: '+7 700 000 00 00',
  intake_year: 2027,
  reason,
  reason_label: reason,
  is_free,
})

const request = (candidates: StudentCandidate[]): AccessRequestItem => ({
  id: crypto.randomUUID(),
  user: { id: crypto.randomUUID(), email: 'student@example.com', name: 'Ученик', is_active: false },
  requested_role: 'student',
  full_name: 'Ученик',
  phone: '+7 700 000 00 00',
  city: null,
  direction: null,
  candidates,
  suggested_student: null,
  confidence: null,
  method: null,
  method_label: null,
  status: 'new',
  created_at: '2026-09-28T00:00:00Z',
})

describe('автоматическое одобрение заявок', () => {
  it('разрешает одно точное совпадение телефона со свободной карточкой', () => {
    expect(isAutoApprovable(request([candidate('phone', true)]))).toBe(true)
  })

  it('не обещает автоодобрение, если кабинет карточки уже занят', () => {
    expect(isAutoApprovable(request([candidate('phone', false)]))).toBe(false)
  })

  it('не принимает совпадение только по имени или неоднозначный телефон', () => {
    expect(isAutoApprovable(request([candidate('name', true)]))).toBe(false)
    expect(isAutoApprovable(request([candidate('phone', true), candidate('phone', true)]))).toBe(false)
  })
})
