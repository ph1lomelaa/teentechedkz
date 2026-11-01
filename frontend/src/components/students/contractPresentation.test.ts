import { describe, expect, it } from 'vitest'
import { identityMatch, recordNumber, contractStatus } from './contractPresentation'
import type { TrustMeCandidate } from '@/api/trustme'
const candidate = (name: string, signer: string, company = false): TrustMeCandidate => ({ name, number: '306', short_url: 'test306', status: 3, created_at: null, signers: [{ name: signer, is_company: company, signed: true }] })
describe('Contract search identity and presentation', () => {
  it('does not rank unrelated students by a shared first name', () => {
    expect(identityMatch(candidate('Admission договор Амина', 'Ахметова Амина Канатовна'), ['Аманбай Амина Өсімханқызы'])).toBe(false)
  })
  it('matches student names independent of Kazakh spelling and word order', () => {
    expect(identityMatch(candidate('Admission договор', 'Амина Аманбай Осимханкызы'), ['Аманбай Амина Өсімханқызы'])).toBe(true)
  })
  it('ranks parent matches and ignores company representative names', () => {
    expect(identityMatch(candidate('Договор', 'Аманбай Айгуль Сериковна'), ['Аманбай Амина', 'Аманбай Айгуль Сериковна'])).toBe(true)
    expect(identityMatch(candidate('Договор', 'Аманбай Айгуль Сериковна', true), ['Аманбай Айгуль Сериковна'])).toBe(false)
  })
  it('removes repeated upload prefixes without damaging the record number', () => {
    expect(recordNumber('UPL-'.repeat(35) + '№306')).toBe('№306')
    expect(recordNumber('306')).toBe('№306')
    expect(recordNumber('№306')).toBe('№306')
    expect(recordNumber('671-А')).toBe('№671-А')
    expect(recordNumber(null)).toBe('Без номера')
  })
  it('does not invent the meaning of an undocumented status', () => {
    expect(contractStatus(3).label).toBe('Подписан')
    expect(contractStatus(4).label).toBe('Отозван компанией')
    expect(contractStatus(5).label).toBe('Статус не определён')
  })
})
