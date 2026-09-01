import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Общий перехват ошибок.
 *
 * Ради чего тест: это нижняя граница обратной связи для 91 файла с useQuery и
 * 195 мутаций. Две тонкости, каждая из которых незаметно всё портит: без
 * склейки обрыв связи выдаёт стопку одинаковых тостов (запросов на экране
 * десяток), а без пропуска своих обработчиков экран, уже объясняющий ошибку
 * по-своему, сообщает о ней дважды.
 */
const toast = vi.fn()
vi.mock('@/hooks/use-toast', () => ({ toast: (args: unknown) => toast(args) }))

const failing = (message: string) => () => Promise.reject(new Error(message))

/**
 * Модуль импортируется заново на каждый тест: окно склейки живёт в модульном
 * состоянии, и без сброса тесты подглядывали бы друг к другу. Проверка «свой
 * onError отменяет общий тост» без этого проходила бы ложно — тост не
 * появился бы просто потому, что то же сообщение уже показывали в соседнем
 * тесте секунду назад.
 */
async function freshClient() {
  vi.resetModules()
  const { createQueryClient } = await import('./queryClient')
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { retry: false } })
  return client
}

describe('общий перехват ошибок', () => {
  beforeEach(() => toast.mockClear())

  it('упавший запрос сообщает о себе', async () => {
    const client = await freshClient()

    await client.fetchQuery({ queryKey: ['a'], queryFn: failing('Сервер недоступен') }).catch(() => {})

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0]).toMatchObject({
      title: 'Не удалось загрузить данные',
      description: 'Сервер недоступен',
      variant: 'destructive',
    })
  })

  it('одна и та же ошибка на десяти запросах — один тост', async () => {
    const client = await freshClient()

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.fetchQuery({ queryKey: [`q${i}`], queryFn: failing('Обрыв связи') }).catch(() => {}),
      ),
    )

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('разные ошибки не склеиваются', async () => {
    const client = await freshClient()

    await client.fetchQuery({ queryKey: ['x'], queryFn: failing('Первая') }).catch(() => {})
    await client.fetchQuery({ queryKey: ['y'], queryFn: failing('Вторая') }).catch(() => {})

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(2))
  })

  it('провалившаяся мутация сообщает о себе', async () => {
    const client = await freshClient()

    await client
      .getMutationCache()
      .build(client, { mutationFn: failing('Нет прав') })
      .execute(undefined)
      .catch(() => {})

    await waitFor(() => expect(toast).toHaveBeenCalledTimes(1))
    expect(toast.mock.calls[0][0]).toMatchObject({ title: 'Действие не выполнено' })
  })

  it('мутация со своим onError не получает второго сообщения', async () => {
    const client = await freshClient()
    const own = vi.fn()

    await client
      .getMutationCache()
      .build(client, { mutationFn: failing('Своя беда'), onError: own })
      .execute(undefined)
      .catch(() => {})

    await waitFor(() => expect(own).toHaveBeenCalled())
    expect(toast).not.toHaveBeenCalled()
  })
})
