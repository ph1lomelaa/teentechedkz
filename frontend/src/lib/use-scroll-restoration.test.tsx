import { render, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Ради чего тест: в CRM прокручивается не окно, а <main> с overflow-y-auto, и
 * ни браузер, ни React Router его не восстанавливают. Открыл карточку —
 * получил её на той высоте, где был список; вернулся — список на высоте
 * карточки. Правило узкое (POP восстанавливает, PUSH сбрасывает), а цена
 * ошибки высокая: перепутав направления, сделаешь хуже, чем было.
 *
 * Модуль импортируется заново на каждый тест: позиции живут в модульной Map, а
 * первой записи истории роутер всегда выдаёт ключ 'default' — без сброса тесты
 * читали бы позиции друг друга. В браузере такого нет: новая история бывает
 * только при новой загрузке страницы, когда модуль и так создаётся заново.
 */
async function renderApp() {
  vi.resetModules()
  const { useScrollRestoration } = await import('./use-scroll-restoration')

  const Screen: React.FC<{ to: string; label: string }> = ({ to, label }) => {
    const ref = useRef<HTMLDivElement>(null)
    useScrollRestoration(ref)
    const navigate = useNavigate()
    return (
      <div ref={ref} data-testid={`container-${label}`}>
        <button onClick={() => navigate(to)}>вперёд</button>
        <button onClick={() => navigate(-1)}>назад</button>
      </div>
    )
  }

  return render(
    <MemoryRouter initialEntries={['/list']}>
      <Routes>
        <Route path="/list" element={<Screen to="/card" label="list" />} />
        <Route path="/card" element={<Screen to="/list" label="card" />} />
      </Routes>
    </MemoryRouter>,
  )
}

function scrollTo(container: HTMLElement, value: number) {
  act(() => {
    container.scrollTop = value
    container.dispatchEvent(new Event('scroll'))
  })
}

describe('восстановление прокрутки контейнера', () => {
  beforeEach(() => {
    // Восстановление растянуто на кадры — экраны грузятся лениво. В тесте
    // содержимое на месте сразу, поэтому первого кадра достаточно.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  it('новый экран открывается сверху, а не на высоте предыдущего', async () => {
    const { getByTestId, getAllByText } = await renderApp()
    scrollTo(getByTestId('container-list'), 900)

    act(() => getAllByText('вперёд')[0].click())

    expect(getByTestId('container-card').scrollTop).toBe(0)
  })

  it('возврат назад приводит на то же место списка', async () => {
    const { getByTestId, getAllByText } = await renderApp()
    scrollTo(getByTestId('container-list'), 900)
    act(() => getAllByText('вперёд')[0].click())

    act(() => getAllByText('назад')[0].click())

    expect(getByTestId('container-list').scrollTop).toBe(900)
  })

  it('повторный переход по ссылке — это новый экран, а не возврат', async () => {
    // Тот же адрес, но человек пришёл заново (нажал пункт меню, а не «назад»).
    // Позиция под старым ключом истории сохранена, и брать её здесь нельзя:
    // ожидание от свежего перехода — начало списка.
    const { getByTestId, getAllByText } = await renderApp()
    scrollTo(getByTestId('container-list'), 900)
    act(() => getAllByText('вперёд')[0].click())

    act(() => getAllByText('вперёд')[0].click())

    expect(getByTestId('container-list').scrollTop).toBe(0)
  })

  it('экран, который не прокручивали, восстанавливается сверху', async () => {
    const { getByTestId, getAllByText } = await renderApp()
    act(() => getAllByText('вперёд')[0].click())
    scrollTo(getByTestId('container-card'), 400)

    act(() => getAllByText('назад')[0].click())

    expect(getByTestId('container-list').scrollTop).toBe(0)
  })
})
