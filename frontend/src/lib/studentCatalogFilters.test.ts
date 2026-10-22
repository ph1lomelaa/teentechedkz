import { describe, expect, it } from 'vitest'
import type { StudentListItem } from '@/types'
import { catalogCounts, matchesStudentCatalog, type CatalogFilters } from './studentCatalogFilters'
const filters: CatalogFilters = { years: [], statuses: [], statusOperator: 'is', degrees: [], countries: [], people: [], names: [], roles: [], services: [], search: '' }
const row = (id: string, extra: Partial<StudentListItem> = {}) => ({ id, full_name: id, phone: '', intake_year: 2026, degree_level: 'undergraduate', pipeline_status: 'active_work', responsibles: [], ...extra }) as StudentListItem
const person = (id: string, role: string) => ({ id, role, name: id, is_active: true, assignment_status: 'assigned' })
describe('Student catalog filter counts', () => {
  it('uses OR within a field and AND between fields', () => {
    const f = { ...filters, years: ['2026', '2027'], statuses: ['active_work', 'visa_received'] }
    expect(matchesStudentCatalog(row('a'), f)).toBe(true)
    expect(matchesStudentCatalog(row('b', { intake_year: 2027 }), f)).toBe(true)
    expect(matchesStudentCatalog(row('c', { pipeline_status: 'changed_mind' }), f)).toBe(false)
  })
  it('counts alternate years without removing other selected dimensions', () => {
    const rows = [row('a'), row('b', { intake_year: 2027 }), row('c', { intake_year: 2027, pipeline_status: 'changed_mind' })]
    expect(catalogCounts(rows, { ...filters, years: ['2026'], statuses: ['active_work'] }, 'years', ['2026', '2027'])).toEqual({ '2026': 1, '2027': 1 })
  })
  it('requires the selected person to have the selected role', () => {
    const student = row('a', { responsibles: [person('mentor', 'lead'), person('manager', 'mzk')] as StudentListItem['responsibles'] })
    expect(matchesStudentCatalog(student, { ...filters, people: ['mentor'], roles: ['mzk'] })).toBe(false)
    expect(matchesStudentCatalog(student, { ...filters, people: ['manager'], roles: ['mzk'] })).toBe(true)
  })
  it('includes confirmed source names in account search without inventing a role', () => {
    const student = row('a', { notion_responsible_ids: ['mentor'], notion_people_keys: ['alias'] })
    expect(matchesStudentCatalog(student, { ...filters, people: ['mentor'] })).toBe(true)
    expect(matchesStudentCatalog(student, { ...filters, people: ['mentor'], roles: ['lead'] })).toBe(false)
    expect(catalogCounts([student], filters, 'people', ['notion:alias', 'mentor'])).toEqual({ 'notion:alias': 1, mentor: 1 })
  })
  it('shows students without status and searches all selected countries', () => {
    const student = row('a', { pipeline_status: undefined, countries: [{ country: 'США', is_primary: true }, { country: 'Корея', is_primary: false }] as StudentListItem['countries'] })
    expect(matchesStudentCatalog(student, { ...filters, statuses: ['no_status'], countries: ['Корея'] })).toBe(true)
    expect(matchesStudentCatalog(student, { ...filters, countries: ['Корея'], primaryOnly: true })).toBe(false)
  })
})
