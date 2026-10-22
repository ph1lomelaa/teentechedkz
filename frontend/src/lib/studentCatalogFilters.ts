import type { StudentListItem } from '@/types'
import { fuzzyStudentMatch } from './fuzzyName'

export interface CatalogFilters {
  years: string[]; statuses: string[]; statusOperator: 'is' | 'is_not'; degrees: string[]
  countries: string[]; people: string[]; names: string[]; roles: string[]; services: string[]
  search: string; primaryOnly?: boolean; nameAccounts?: Record<string, string>
}
export type CatalogDimension = 'years' | 'statuses' | 'degrees' | 'countries' | 'people' | 'roles' | 'services'
export function matchesStudentCatalog(student: StudentListItem, filters: CatalogFilters, omit?: CatalogDimension): boolean {
  const hit = (field: CatalogDimension, values: string[]) => field === omit || !filters[field].length || filters[field].some(value => values.includes(value))
  if (!hit('years', [String(student.intake_year)]) || !hit('degrees', [student.degree_level])) return false
  if (omit !== 'statuses' && filters.statuses.length) {
    const selected = filters.statuses.includes(student.pipeline_status ?? 'no_status')
    if (filters.statusOperator === 'is_not' ? selected : !selected) return false
  }
  const countries = student.countries?.filter(country => !filters.primaryOnly || country.is_primary).map(country => country.country) ?? (student.country ? [student.country] : [])
  if (!hit('countries', countries)) return false
  if (!hit('services', student.services_summary?.items.map(item => item.service_type) ?? [])) return false
  const roles = omit === 'roles' ? [] : filters.roles
  const assignments = (student.responsibles ?? []).filter(person => person.is_active && person.assignment_status !== 'required')
  const names = omit === 'people' ? [] : filters.names
  const ids = omit === 'people' ? [] : [...filters.people, ...(roles.length ? names.flatMap(name => filters.nameAccounts?.[name] ? [filters.nameAccounts[name]] : []) : [])]
  if (ids.length || names.length || roles.length) {
    const accountMatch = assignments.some(person => (!ids.length && !names.length || ids.includes(person.id)) && (!roles.length || roles.includes(person.role ?? '')))
    const linked = !roles.length && ids.some(id => student.notion_responsible_ids?.includes(id))
    const text = !roles.length && names.some(name => student.notion_people_keys?.includes(name))
    if (!accountMatch && !linked && !text) return false
  }
  return !filters.search.trim() || fuzzyStudentMatch(filters.search, student.full_name, student.phone)
}

/** Other dimensions stay applied; OR-values in this dimension do not exclude alternatives. */
export function catalogCounts(rows: StudentListItem[], filters: CatalogFilters, dimension: CatalogDimension, options: string[]): Record<string, number> {
  const base = rows.filter(student => matchesStudentCatalog(student, filters, dimension))
  return Object.fromEntries(options.map(value => [value, base.filter(student => matchesStudentCatalog(student, { ...filters, [dimension]: [value], ...(dimension === 'people' ? { people: value.startsWith('notion:') ? [] : [value], names: value.startsWith('notion:') ? [value.slice(7)] : [] } : {}), ...(dimension === 'statuses' ? { statusOperator: 'is' } : {}) })).length]))
}
