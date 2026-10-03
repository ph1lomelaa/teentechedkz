import { describe, expect, it } from 'vitest'
import {
  ASSIGNED, EMPTY, PARAM, TITLE_FIELD, filterChipLabel, formatSyncTime, parseFieldList, parseFilters, parseView,
  resolveVisibleFields, serializeFieldList, serializeFilters, syncHealth, type Filters,
} from './viewState'

/**
 * Ссылка на пайплайн — рабочий инструмент: ей делятся «смотри мои фильтры».
 * Поэтому проверяем, что состояние честно проходит через настоящий URL
 * (URLSearchParams кодирует и раскодирует), а не только через JSON.
 */
function throughUrl(filters: Filters): Filters {
  const params = new URLSearchParams()
  const raw = serializeFilters(filters)
  if (raw) params.set(PARAM.filters, raw)
  const url = new URL(`http://localhost/dashboard?${params.toString()}`)
  return parseFilters(url.searchParams.get(PARAM.filters))
}

describe('фильтры в URL', () => {
  it('переживают круг через адресную строку, включая кириллицу, запятые и «не заполнено»', () => {
    const filters: Filters = {
      Intake: { operator: 'is', values: ['2026'] },
      'Lead-Mentor': { operator: 'is', values: ['Bibinur', 'Daria, Jr.', EMPTY] },
      'Статус выплат': { operator: 'is_not', values: ['Работа окончена- Поступил'] },
      'd в работе': { operator: 'greater', values: ['365'] },
      'Номер тел': { operator: 'is_empty', values: [] },
    }
    expect(throughUrl(filters)).toEqual(filters)
  })

  it('без фильтров параметр исчезает из URL', () => {
    expect(serializeFilters({})).toBeNull()
    expect(parseFilters(null)).toEqual({})
  })

  it('битая или подделанная ссылка не роняет страницу', () => {
    expect(parseFilters('{oops')).toEqual({})
    expect(parseFilters('[1,2]')).toEqual({})
    expect(parseFilters(JSON.stringify({
      ok: { operator: 'is', values: ['a'] },
      badOperator: { operator: 'drop_table', values: [] },
      badValues: { operator: 'is', values: [1] },
    }))).toEqual({ ok: { operator: 'is', values: ['a'] } })
  })
})

describe('подпись чипа фильтра', () => {
  it('одно и два значения — списком, три и больше — числом', () => {
    expect(filterChipLabel('Intake', { operator: 'is', values: ['2026'] })).toBe('Intake: 2026')
    expect(filterChipLabel('Lead-Mentor', { operator: 'is', values: ['Bibinur', 'Daria'] })).toBe('Lead-Mentor: Bibinur, Daria')
    expect(filterChipLabel('Lead-Mentor', { operator: 'is', values: ['a', 'b', 'c'] })).toBe('Lead-Mentor: 3')
  })
  it('понятные подписи для служебных полей и условий', () => {
    expect(filterChipLabel('Main country', { operator: 'is_not', values: ['Китай'] })).toBe('Страна ≠ Китай')
    expect(filterChipLabel('d в работе', { operator: 'greater', values: ['30'] })).toBe('Дни в работе > 30')
    expect(filterChipLabel(ASSIGNED, { operator: 'is_empty', values: [] })).toBe('Ответственные: не заполнено')
  })
})

describe('вид и поля в URL', () => {
  it('вид читается из ?view, старые ссылки ?nv=board тоже работают', () => {
    expect(parseView(new URLSearchParams('view=board'))).toBe('board')
    expect(parseView(new URLSearchParams('view=table'))).toBe('table')
    expect(parseView(new URLSearchParams('nv=board'))).toBe('board')
    expect(parseView(new URLSearchParams('view=crm'))).toBe('table')
    expect(parseView(new URLSearchParams(''))).toBe('table')
  })

  it('порядок полей сохраняется, запятая в названии не ломает список', () => {
    const fields = ['Degree', 'Сумм, УП', ASSIGNED]
    const params = new URLSearchParams({ [PARAM.fields]: serializeFieldList(fields) })
    expect(parseFieldList(new URLSearchParams(params.toString()).get(PARAM.fields))).toEqual(fields)
  })

  it('видимые поля: URL важнее памяти, память важнее умолчаний, исчезнувшие поля и заголовок отбрасываются', () => {
    const available = ['Degree', 'Intake', ASSIGNED]
    expect(resolveVisibleFields(['Intake', 'Удалённое', TITLE_FIELD], ['Degree'], ['Degree'], available)).toEqual(['Intake'])
    expect(resolveVisibleFields(null, ['Degree', ASSIGNED], ['Intake'], available)).toEqual(['Degree', ASSIGNED])
    expect(resolveVisibleFields(null, null, ['Intake'], available)).toEqual(['Intake'])
    expect(resolveVisibleFields([], ['Degree'], ['Intake'], available)).toEqual([])
  })
})

describe('строка синхронизации', () => {
  const now = new Date(2026, 9, 3, 19, 0)
  it('время по-человечески', () => {
    expect(formatSyncTime(new Date(2026, 9, 3, 18, 30), now)).toBe('сегодня в 18:30')
    expect(formatSyncTime(new Date(2026, 9, 2, 9, 10), now)).toBe('вчера в 09:10')
    expect(formatSyncTime(new Date(2026, 8, 12, 14, 0), now)).toBe('12.09.2026 в 14:00')
  })
  it('цвет точки: успех, устаревшие данные, ошибка', () => {
    expect(syncHealth({ at: new Date(2026, 9, 3, 18).toISOString(), ok: true }, now)).toBe('ok')
    expect(syncHealth({ at: new Date(2026, 9, 1, 18).toISOString(), ok: true }, now)).toBe('stale')
    expect(syncHealth({ at: new Date(2026, 9, 3, 18).toISOString(), ok: false }, now)).toBe('error')
    expect(syncHealth({ at: null, ok: null }, now)).toBe('unknown')
  })
})
