import { describe, expect, it } from 'vitest'
import { hasCredentialFor, PortalCredential } from '@/api/credentials'
import { timeIn, timezoneLabel } from '@/lib/checkinTimezone'

const cred = (patch: Partial<PortalCredential>): PortalCredential => ({
  id: 'c1',
  student_id: 's1',
  university_id: null,
  application_id: null,
  portal_name: 'Portal',
  portal_url: '',
  login: 'login',
  notes: '',
  created_at: '',
  updated_at: '',
  ...patch,
})

describe('hasCredentialFor — та же логика, что admission_guard на бэкенде', () => {
  it('доступ привязан к самой заявке', () => {
    expect(hasCredentialFor([cred({ application_id: 'a1' })], { id: 'a1' })).toBe(true)
  })

  it('доступ к тому же вузу засчитывается', () => {
    expect(hasCredentialFor([cred({ university_id: 'u1' })], { id: 'a1', university_id: 'u1' })).toBe(true)
  })

  it('заявка без вуза не совпадает с доступом без вуза', () => {
    expect(hasCredentialFor([cred({})], { id: 'a1', university_id: null })).toBe(false)
  })

  it('чужая заявка и чужой вуз — доступа нет', () => {
    expect(
      hasCredentialFor([cred({ application_id: 'a2', university_id: 'u2' })], { id: 'a1', university_id: 'u1' })
    ).toBe(false)
  })
})

describe('checkinTimezone', () => {
  it('показывает город вместо IANA-кода', () => {
    expect(timezoneLabel('Europe/Berlin', [{ value: 'Europe/Berlin', label: 'Берлин' }])).toBe('Берлин')
  })

  it('незнакомый пояс показывает как есть', () => {
    expect(timezoneLabel('Europe/Oslo', [])).toBe('Europe/Oslo')
  })

  it('время считается в выбранном поясе', () => {
    const noonUtc = new Date('2026-08-06T12:00:00Z')
    expect(timeIn('Asia/Almaty', noonUtc)).toBe('17:00')
    expect(timeIn('Europe/Berlin', noonUtc)).toBe('14:00')
  })
})
