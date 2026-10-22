import { describe, expect, it } from 'vitest'
import type { University } from '@/api/universities'
import { matchesUniversityQuery } from './university-search'
const university = (values: Partial<University>) => ({ name: '', city: '', country_name: '', faculties: [], ...values } as University)
describe('university search', () => {
  it.each(['MIT', 'M.I.T.', 'm i t', 'technology massachusetts', 'Cambridge MIT'])('finds MIT for %s', query => {
    expect(matchesUniversityQuery(university({ name: 'Massachusetts Institute of Technology', city: 'Cambridge' }), query)).toBe(true)
  })
  it('ignores accents, punctuation and word order', () => {
    expect(matchesUniversityQuery(university({ name: 'Université Paris-Saclay', city: 'Paris' }), 'saclay universite')).toBe(true)
    expect(matchesUniversityQuery(university({ name: "St. John's University" }), 'st johns')).toBe(true)
  })
  it('searches countries and faculties and rejects absent terms', () => {
    const u = university({ name: 'University of California, Los Angeles', country_name: 'United States of America', faculties: ['Computer Science'] })
    expect(matchesUniversityQuery(u, 'UCLA usa science')).toBe(true)
    expect(matchesUniversityQuery(u, 'science computer')).toBe(true)
    expect(matchesUniversityQuery(u, 'UCLA Italy')).toBe(false)
  })
})
