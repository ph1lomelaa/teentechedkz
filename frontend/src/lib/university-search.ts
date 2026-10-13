import { University } from '@/api/universities'

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/ё/g, 'е').replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

const connectorWords = new Set(['the', 'of', 'and', 'at', 'in'])
function acronym(value: string): string {
  return normalize(value).split(' ').filter(word => word && !connectorWords.has(word))
    .map(word => word[0]).join('')
}

/** One search rule for the catalog and student pickers: words in any order,
 * accents/punctuation ignored, and standard name abbreviations (MIT, UCLA). */
export function matchesUniversityQuery(u: University, needle: string): boolean {
  const q = normalize(needle)
  if (!q) return true
  const initials = [acronym(u.name), acronym(u.country_name || '')].filter(value => value.length > 1)
  const words = q.split(' ').filter(Boolean)
  if (words.length > 1 && words.every(word => word.length === 1)) {
    return initials.includes(words.join(''))
  }
  const haystack = normalize([
    u.name, u.city, u.country_name || '', u.description || '',
    u.tuition_range || '', (u.faculties || []).join(' '), ...initials,
  ].join(' '))
  return words.every(word => haystack.includes(word))
}
