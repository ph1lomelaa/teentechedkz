import { describe, expect, it } from 'vitest'
import type { Participation } from '@/api/activities'
import type { BoardItem } from '@/api/activities'
import css from '@/index.css?raw'
import {
  boardContext, cleanDirection, dateSummary, directionCounts, directionTone, intakeCost, intakeLabel, intakeWhen,
  matchesCatalogFilter, nearestActivityIntake, pickNextAction, planGroup, progressSegments,
} from './activityUi'

const base = { id: 'p', decision: 'selected', status: 'in_progress', activity: { title: 'A' }, intake: { label: '2026' } }
const p = (over: Record<string, unknown>) => ({ ...base, ...over }) as unknown as Participation
const steps = (next: Record<string, unknown> | null, total = 3) => ({ total, done: 0, pending: 0, returned: 0, overdue: 0, next })

describe('подписи', () => {
  it('убирает служебный номер направления и набор импорта', () => {
    expect(cleanDirection('№8 — Медицина / Биология')).toBe('Медицина / Биология')
    expect(cleanDirection('IT')).toBe('IT')
    expect(intakeLabel({ label: 'Из исходной базы' })).toBeNull()
    expect(intakeLabel({ label: 'Осень 2026' })).toBe('Осень 2026')
  })
  it('не выдумывает сроки и стоимость', () => {
    expect(intakeWhen(null)).toBe('Сроки уточняются')
    expect(intakeWhen({ deadline: null, mode: 'rolling', dates_text: null })).toBe('Набор открыт постоянно')
    expect(intakeCost({ cost_state: 'unknown', cost_text: null })).toBe('Стоимость уточняется')
    expect(intakeCost({ cost_state: 'paid', cost_text: null })).toBe('Платно')
  })
})

describe('план', () => {
  it('раскладывает участия по группам', () => {
    expect(planGroup({ decision: 'suggested', status: 'not_started' })).toBe('decide')
    expect(planGroup({ decision: 'selected', status: 'completed' })).toBe('results')
    expect(planGroup({ decision: 'not_interested', status: 'not_started' })).toBe('closed')
    expect(planGroup({ decision: 'selected', status: 'cancelled' })).toBe('closed')
  })
  it('сначала правки, потом просрочка, потом ближайший шаг', () => {
    const items = [
      p({ id: 'a', steps: steps({ title: 'Питч', state: 'todo', due_date: '2026-10-05' }) }),
      p({ id: 'b', steps: steps({ title: 'Черновик', state: 'returned', due_date: '2026-10-20' }) }),
      p({ id: 'c', decision: 'suggested', status: 'not_started' }),
    ]
    const next = pickNextAction(items)
    expect(next.kind === 'step' && next.step.title).toBe('Черновик')
  })
  it('рекомендации не подменяют шаг; «ждём ментора» — когда всё отправлено', () => {
    expect(pickNextAction([p({ decision: 'suggested', status: 'not_started' })]).kind).toBe('empty')
    expect(pickNextAction([p({ steps: steps({ title: 'Модуль', state: 'pending', due_date: null }) })]).kind).toBe('waiting')
    expect(pickNextAction([p({ steps: steps(null, 0) })]).kind).toBe('plan')
    expect(pickNextAction([p({ status: 'completed' })]).kind).toBe('empty')
  })
})


describe('следующий шаг по всем участиям', () => {
  it('берёт ближайший по сроку среди разных активностей', () => {
    const next = pickNextAction([
      p({ id: 'a', activity: { title: 'Олимпиада' }, steps: steps({ title: 'Эссе', state: 'todo', due_date: '2026-10-20' }) }),
      p({ id: 'b', activity: { title: 'Хакатон' }, steps: steps({ title: 'Команда', state: 'todo', due_date: '2026-10-08' }) }),
      p({ id: 'c', activity: { title: 'Курс' }, steps: steps({ title: 'Модуль', state: 'pending', due_date: '2026-10-01' }) }),
    ])
    expect(next.kind === 'step' && next.item.activity.title).toBe('Хакатон')
  })
  it('всё на проверке — ждём ментора, а не «нет шагов»', () => {
    const next = pickNextAction([
      p({ id: 'a', steps: steps({ title: 'Эссе', state: 'pending', due_date: null }) }),
      p({ id: 'b', steps: steps({ title: 'Видео', state: 'pending', due_date: null }) }),
    ])
    expect(next.kind).toBe('waiting')
  })
})

describe('направления', () => {
  it('цвет по номеру из данных, новое направление — нейтральное', () => {
    expect(directionTone('№3 — IT / Программирование').badge).toContain('text-dir-3')
    expect(directionTone('Новое направление').badge).toContain('text-ds-muted')
    expect(directionTone('№42 — Что-то').badge).toContain('text-ds-muted')
  })
  it('чипы считаются из данных и идут по номеру группы', () => {
    expect(directionCounts([{ direction: '№8 — Медицина' }, { direction: '№1 — Бизнес' }, { direction: '№1 — Бизнес' }, { direction: null }]))
      .toEqual([{ value: '№1 — Бизнес', label: 'Бизнес', count: 2 }, { value: '№8 — Медицина', label: 'Медицина', count: 1 }])
  })
})

describe('сроки', () => {
  const intake = (over: Record<string, unknown>) => ({ id: 'i', activity_id: 'a', label: 'Из исходной базы', mode: 'unknown', deadline: null, dates_text: null, format: null, cost_state: 'unknown', cost_text: null, ...over })
  it('честные состояния без выдуманных дат', () => {
    expect(dateSummary({ next_intake: null, intake_count: 0 }).short).toBe('Дата неизвестна')
    expect(dateSummary({ next_intake: null, intake_count: 2 }).short).toBe('Набор закрыт')
    expect(dateSummary({ next_intake: intake({ mode: 'rolling' }) as never, intake_count: 1 }).short).toBe('Rolling')
    expect(dateSummary({ next_intake: intake({ mode: 'self_paced' }) as never, intake_count: 1 }).short).toBe('Круглый год')
    expect(dateSummary({ next_intake: intake({ mode: 'fixed', deadline: '2030-10-15' }) as never, intake_count: 1 }).short).toMatch(/^до 15 окт/)
  })
  it('фильтр «Проверить» — только черновики, которым не хватает данных', () => {
    const a = (publication: string, review_issues: string[]) => ({ publication, review_issues }) as never
    expect(matchesCatalogFilter(a('draft', ['Нет ссылки организатора']), 'review')).toBe(true)
    expect(matchesCatalogFilter(a('draft', []), 'review')).toBe(false)
    expect(matchesCatalogFilter(a('published', ['Нет описания']), 'review')).toBe(false)
    expect(matchesCatalogFilter(a('archived', []), 'all')).toBe(false)
  })
})

describe('доска', () => {
  const item = (over: Record<string, unknown>) => ({ ...base, created_at: '2026-10-02T10:00:00Z', due: null, steps: steps(null, 0), ...over }) as unknown as BoardItem
  const today = new Date(2026, 9, 3)
  it('строка контекста по колонке', () => {
    expect(boardContext(item({ column: 'suggested' }), today)).toBe('отправлено вчера')
    expect(boardContext(item({ column: 'planning' }), today)).toBe('шагов ещё нет')
    expect(boardContext(item({ column: 'in_work', due: '2026-10-15', steps: { ...steps({ state: 'todo' }), done: 2, total: 3 } }), today)).toMatch(/^2 из 3 · срок 15 окт/)
    expect(boardContext(item({ column: 'review', steps: { ...steps({ state: 'pending', submitted_at: '2026-10-02T09:00:00Z' }), pending: 1 } }), today)).toBe('работа отправлена · вчера')
  })
  it('сегменты прогресса только по обязательным шагам', () => {
    expect(progressSegments({ total: 3, done: 1, pending: 1, returned: 0, overdue: 0, next: null })).toEqual(['done', 'pending', 'todo'])
    expect(progressSegments(undefined)).toEqual([])
  })
})

describe('контраст токенов направлений', () => {
  // Текст бейджа на его же фоне (15% поверх панели) — не ниже 4.5:1 в обеих темах.
  const rgb = (block: string, name: string) => block.match(new RegExp(`--${name}-rgb:\\s*(\\d+) (\\d+) (\\d+)`))!.slice(1).map(Number)
  const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const mix = (fg: number[], bg: number[], alpha: number) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha))
  const start = css.indexOf('Portfolio UP: цвета направлений')
  const dark = css.slice(start, css.indexOf("html[data-theme='light']", start))
  const light = css.slice(css.indexOf("html[data-theme='light']", start))
  const panels = { dark: [20, 20, 20], light: [255, 255, 255] }
  for (const [theme, block] of [['dark', dark], ['light', light]] as const) {
    for (const name of ['dir-1', 'dir-2', 'dir-3', 'dir-4', 'dir-5', 'dir-6', 'dir-7', 'dir-8', 'ds-info']) {
      it(`${theme} ${name}`, () => {
        const fg = rgb(block, name)
        expect(ratio(fg, mix(fg, panels[theme], 0.15))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

it('полная карточка выбирает тот же ближайший набор, что каталог', () => {
  const unknown = { id: 'unknown', mode: 'unknown', deadline: null } as never
  const rolling = { id: 'rolling', mode: 'rolling', deadline: null } as never
  const fixed = { id: 'fixed', mode: 'fixed', deadline: '2030-10-15' } as never
  const closed = { id: 'closed', mode: 'rolling', deadline: '2020-10-15' } as never
  expect(nearestActivityIntake([unknown, rolling], '2030-10-01')?.id).toBe('rolling')
  expect(nearestActivityIntake([unknown, rolling, fixed], '2030-10-01')?.id).toBe('fixed')
  expect(nearestActivityIntake([closed], '2030-10-01')).toBeNull()
})
