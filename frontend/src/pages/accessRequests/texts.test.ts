import { describe, expect, it } from 'vitest'
import type { AccessRequestItem } from '@/api/accessRequests'
import {
  closeLinkedText,
  describeActionError,
  isRecentLogin,
  replaceConfirmText,
  summarizeBulk,
  summarizeBulkError,
  type BulkRow,
  type ReplaceTarget,
} from './texts'

const NOW = new Date('2026-10-10T12:00:00Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString()
const item = { user: { id: 'u', email: 'new@x.kz', name: 'N', is_active: false } } as AccessRequestItem
const target = (ownerLastLogin: string | null | undefined): ReplaceTarget => ({
  item,
  studentId: 's1',
  studentName: 'Тулегенова Алия',
  ownerEmail: 'old@x.kz',
  ownerLastLogin,
})

describe('текст замены кабинета', () => {
  it('ни разу не входил: обычная кнопка, без предупреждения', () => {
    const t = replaceConfirmText(target(null), NOW)
    expect(t.recent).toBe(false)
    expect(t.confirmLabel).toBe('Заменить')
    expect(t.description).toContain('old@x.kz, ни разу не входил')
    expect(t.description).toContain('Старый аккаунт будет отключён')
    expect(t.description).toContain('Тулегенова Алия')
  })
  it('вход меньше 30 дней назад: предупреждение и «Всё равно заменить»', () => {
    const t = replaceConfirmText(target(daysAgo(3)), NOW)
    expect(t.recent).toBe(true)
    expect(t.confirmLabel).toBe('Всё равно заменить')
    expect(t.description).toContain('последний вход')
  })
  it('вход давно — без предупреждения; граница 30 дней', () => {
    expect(replaceConfirmText(target(daysAgo(90)), NOW).recent).toBe(false)
    expect(isRecentLogin(daysAgo(29), NOW)).toBe(true)
    expect(isRecentLogin(daysAgo(31), NOW)).toBe(false)
  })
  it('вход неизвестен (карточка найдена поиском): без фразы про вход и без тревоги', () => {
    const t = replaceConfirmText(target(undefined), NOW)
    expect(t.recent).toBe(false)
    expect(t.description).not.toContain('входил')
  })
})

describe('закрытие заявки', () => {
  it('говорит, что аккаунты не изменятся', () => {
    expect(closeLinkedText('Жаксылыков Данияр')).toContain('Аккаунты не изменятся')
    expect(closeLinkedText('Жаксылыков Данияр')).toContain('Жаксылыков Данияр')
  })
})

const rows: BulkRow[] = [1, 2, 3].map((n) => ({ id: `r${n}`, name: `Имя ${n}`, phone: '+7', cardName: `Карточка ${n}` }))

describe('сводка массового прикрепления', () => {
  it('всё успешно', () => {
    const s = summarizeBulk(rows, {
      approved: rows.map((r) => ({ id: r.id, name: r.name, student_id: 's' })),
      skipped: [],
    })
    expect(s.kind).toBe('success')
    expect(s.headline).toBe('Успешно: 3. Не удалось: 0')
  })
  it('частично: причина из ответа, имя берётся из запроса, если сервер его не прислал', () => {
    const s = summarizeBulk(rows, {
      approved: [rows[0], rows[2]].map((r) => ({ id: r.id, name: r.name, student_id: 's' })),
      skipped: [{ id: 'r2', reason: 'Заявка не найдена или уже обработана' }],
    })
    expect(s.kind).toBe('partial')
    expect(s.headline).toBe('Успешно: 2. Не удалось: 1')
    expect(s.failed).toEqual([{ id: 'r2', name: 'Имя 2', reason: 'Заявка не найдена или уже обработана' }])
  })
  it('заявка, которой нет ни в одном списке ответа, не теряется молча', () => {
    const s = summarizeBulk(rows, { approved: [], skipped: [{ id: 'r1', name: 'Имя 1', reason: 'x' }] })
    expect(s.failed.map((f) => f.id).sort()).toEqual(['r1', 'r2', 'r3'])
  })
  it('всё не удалось', () => {
    const s = summarizeBulk(rows, {
      approved: [],
      skipped: rows.map((r) => ({ id: r.id, name: r.name, reason: 'У найденной карточки уже есть кабинет' })),
    })
    expect(s.kind).toBe('failed')
    expect(s.headline).toContain('Не удалось прикрепить ни одной заявки (3)')
  })
  it('ошибка запроса: все заявки неудачные, причина одна', () => {
    const s = summarizeBulkError(rows, 'Нет связи с сервером.')
    expect(s.kind).toBe('failed')
    expect(s.failed).toHaveLength(3)
    expect(new Set(s.failed.map((f) => f.reason))).toEqual(new Set(['Нет связи с сервером.']))
  })
})

describe('текст ошибки действия', () => {
  it('показывает detail сервера', () => {
    expect(describeActionError({ response: { status: 409, data: { detail: 'Заявка уже обработана' } } })).toBe(
      'Заявка уже обработана',
    )
  })
  it('403 объясняет про права', () => {
    expect(describeActionError({ response: { status: 403, data: { detail: 'Недостаточно прав' } } })).toContain(
      'только администратор',
    )
  })
})
