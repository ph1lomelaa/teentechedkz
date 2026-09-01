import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { financeKeys, invalidateFinances, invalidateStudent, studentKeys } from './queryKeys'

/**
 * Ради чего тест: React Query сверяет только точное совпадение начала ключа,
 * поэтому ['student', id] и ['student-timeline', id] — независимые деревья,
 * хотя оба про одного студента. Раньше это давало ровно один дефект на
 * каждый забытый сосед: 18 мутаций в StudentCardPage сбрасывали профиль и
 * ни одна — таймлайн; правка договора не задевала /finances вовсе.
 *
 * Проверяется поведение, а не список ключей: что invalidateStudent реально
 * бьёт по обоим корням одним вызовом, а не то, что где-то в файле есть
 * нужная строка.
 */
describe('studentKeys.detail и studentKeys.timeline — разные корни', () => {
  it('инвалидация одного не задевает другой напрямую', () => {
    // Демонстрация самого дефекта: так выглядела ручная инвалидация до
    // фабрики — она специально бьёт только по detail.
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')
    client.invalidateQueries({ queryKey: studentKeys.detail('s1') })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: studentKeys.timeline('s1') }))
  })
})

describe('invalidateStudent', () => {
  it('сбрасывает и профиль, и таймлайн одним вызовом', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')

    invalidateStudent(client, 's1')

    expect(spy).toHaveBeenCalledWith({ queryKey: studentKeys.detail('s1') })
    expect(spy).toHaveBeenCalledWith({ queryKey: studentKeys.timeline('s1') })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('не путает студентов между собой', () => {
    // Единственный практический способ сломать фабрику — опечататься в id
    // на одной из двух строк внутри неё.
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')

    invalidateStudent(client, 's1')

    expect(spy).not.toHaveBeenCalledWith({ queryKey: studentKeys.detail('s2') })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: studentKeys.timeline('s2') })
  })
})

describe('invalidateFinances', () => {
  it('сбрасывает сводку, разбивку и Notion-зеркало сводки', () => {
    const client = new QueryClient()
    const spy = vi.spyOn(client, 'invalidateQueries')

    invalidateFinances(client)

    expect(spy).toHaveBeenCalledWith({ queryKey: financeKeys.summary() })
    expect(spy).toHaveBeenCalledWith({ queryKey: financeKeys.breakdown() })
    expect(spy).toHaveBeenCalledWith({ queryKey: financeKeys.notionSummary() })
    expect(spy).toHaveBeenCalledTimes(3)
  })
})
