import type { AccessRequestItem, StudentCandidate } from '@/api/accessRequests'

/** Телефон по цифрам: +7, 8, пробелы и скобки не должны давать расхождение.
 * Правило то же, что у сервера (`normalize_phone`): 11 цифр с 8 → с 7. Только
 * для отображения сравнения — решение о совпадении принимает бэкенд. */
export function normalizePhone(raw?: string | null): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits
}

function nameWords(raw?: string | null): string[] {
  return (raw ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** ФИО считаем совпавшим, если все слова короткого имени есть в длинном:
 * в заявке часто без отчества, в карточке — полное. Транслит и опечатки
 * расхождением остаются — их решает человек. */
export function sameName(a?: string | null, b?: string | null): boolean {
  const wa = nameWords(a)
  const wb = nameWords(b)
  if (wa.length === 0 || wb.length === 0) return false
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  return short.every((w) => long.includes(w))
}

export type FieldStatus = 'match' | 'diff' | 'missing'

export interface CompareRow {
  key: 'name' | 'phone' | 'email' | 'year' | 'city'
  label: string
  request: string | null
  card: string | null
  status: FieldStatus
}

const clean = (v: string | number | null | undefined): string | null => {
  const s = v == null ? '' : String(v).trim()
  return s || null
}

function status(
  request: string | null,
  card: string | null,
  equal: (a: string, b: string) => boolean,
): FieldStatus {
  if (request == null || card == null) return 'missing'
  return equal(request, card) ? 'match' : 'diff'
}

const lower = (s: string) => s.trim().toLowerCase()

/** Заявка ↔ карточка по полям, которые есть в ответе API; если поля нет с одной
 * из сторон — «нет данных». У карточки нет собственного email: сравниваем с email
 * её кабинета, если он есть. У заявки нет года выпуска. */
export function buildComparison(item: AccessRequestItem, card: StudentCandidate): CompareRow[] {
  const r = {
    name: clean(item.full_name),
    phone: clean(item.phone),
    email: clean(item.user?.email),
    year: null as string | null,
    city: clean(item.city),
  }
  const c = {
    name: clean(card.full_name),
    phone: clean(card.phone),
    email: clean(card.portal_owner?.email),
    year: clean(card.intake_year),
    city: clean(card.city),
  }
  const phoneEq = (a: string, b: string) => {
    const na = normalizePhone(a)
    return na !== '' && na === normalizePhone(b)
  }
  const phoneStatus = (): FieldStatus => {
    // Телефон без цифр («нет») — это отсутствие данных, а не расхождение.
    if (normalizePhone(r.phone) === '' || normalizePhone(c.phone) === '') return 'missing'
    return status(r.phone, c.phone, phoneEq)
  }
  return [
    { key: 'name', label: 'ФИО', request: r.name, card: c.name, status: status(r.name, c.name, sameName) },
    { key: 'phone', label: 'Телефон', request: r.phone, card: c.phone, status: phoneStatus() },
    { key: 'email', label: 'Email кабинета', request: r.email, card: c.email, status: status(r.email, c.email, (a, b) => lower(a) === lower(b)) },
    { key: 'year', label: 'Год выпуска', request: r.year, card: c.year, status: status(r.year, c.year, (a, b) => a === b) },
    { key: 'city', label: 'Город', request: r.city, card: c.city, status: status(r.city, c.city, (a, b) => lower(a) === lower(b)) },
  ]
}

/** Расшифровка причины простыми словами — для раскрытой части строки. */
export function reasonExplanation(card: StudentCandidate, phoneCount: number): string {
  if (card.reason === 'phone') {
    return phoneCount > 1 ? 'Два кандидата с одним телефоном' : 'Телефон совпал'
  }
  return 'ФИО похоже, телефон другой'
}
