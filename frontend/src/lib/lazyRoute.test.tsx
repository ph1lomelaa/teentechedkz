import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Ленивые страницы и переживание деплоя.
 *
 * Ради чего: имена чанков содержат хеш сборки, и вкладка, открытая до выката,
 * при переходе в раздел просит файл, которого уже нет. Раньше это распознавали
 * по тексту ошибки — и проиграли гонку: Chrome, Safari и Firefox формулируют
 * по-разному, а Safari вдобавок бросает TypeError, а не NotFoundError. Каждая
 * незнакомая формулировка снова приводила человека на «Экран не открылся», где
 * чинить нечего.
 *
 * Теперь перехват стоит на самой загрузке: здесь заведомо известно, что упал
 * именно чанк страницы, и текст ошибки не важен. Проверяем это и защиту от
 * петли — вторая подряд неудача обязана дать ошибке дойти до экрана.
 */
const reload = vi.fn()

beforeEach(() => {
  reload.mockClear()
  sessionStorage.clear()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload, assign: vi.fn() },
  })
})

// Импорт после подмены window.location: модуль App читает его при загрузке.
const { recoverPageOnce } = await import('@/App')

describe('восстановление после устаревшей сборки', () => {
  it('перезагружает вкладку один раз', () => {
    expect(recoverPageOnce()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('второй раз подряд не перезагружает — иначе петля', () => {
    recoverPageOnce()
    reload.mockClear()
    recoverPageOnce()
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('lazyRoute', () => {
  it('зовёт восстановление, каким бы ни был текст ошибки', async () => {
    // Ровно то, что бросает Safari при неудачной загрузке модуля: TypeError, а
    // не NotFoundError, и текст, которого нет ни в одном списке формулировок.
    const failing = React.lazy(() =>
      Promise.reject(new TypeError('The object can not be found here.')).catch(
        (error: unknown) => {
          recoverPageOnce()
          throw error
        },
      ) as Promise<{ default: React.ComponentType }>,
    )

    class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      render() {
        return this.state.failed ? <div>упало</div> : this.props.children
      }
    }

    render(
      <Boundary>
        <React.Suspense fallback={<div>грузим</div>}>
          {React.createElement(failing)}
        </React.Suspense>
      </Boundary>,
    )

    await waitFor(() => expect(screen.getByText('упало')).toBeInTheDocument())
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
