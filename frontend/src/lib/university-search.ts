import { University } from '@/api/universities'

/** Shared search predicate for the catalog and the shortlist picker.
 *
 * Extracted so the two never drift on what "поиск" means — a university found
 * in the catalog must also be findable when adding it to a student. */
export function matchesUniversityQuery(u: University, needle: string): boolean {
  const q = needle.trim().toLowerCase()
  if (!q) return true
  const haystack = [
    u.name,
    u.city,
    u.country_name || '',
    u.description || '',
    u.tuition_range || '',
    (u.faculties || []).join(' '),
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(q)
}
