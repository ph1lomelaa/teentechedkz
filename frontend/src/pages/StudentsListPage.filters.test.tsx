import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Фильтры общей базы обязаны переживать уход в карточку.
 *
 * Ради чего тест: это самый частый цикл работы в CRM — отобрать, открыть
 * карточку, вернуться. Фильтры жили в useState, и возврат отдавал пустой
 * список «Все студенты». Ошибка не видна ни типам, ни сборке: страница
 * открывается, фильтры на месте, просто пустые.
 *
 * Проверяется не разметка, а две вещи, ради которых правка делалась: значение
 * доживает до следующего монтирования и доезжает до запроса. Отдельно —
 * «Сбросить всё», которое раньше оставляло строку поиска работать.
 */
const listCalls = vi.fn()

vi.mock('@/api/students', () => ({
  studentsApi: {
    list: (params: Record<string, unknown>) => {
      listCalls(params)
      return Promise.resolve({ items: [], total: 0 })
    },
    getAll: () => Promise.resolve([]),
    facets: () => Promise.resolve({ statuses: [], years: [], degrees: [], countries: [] }),
  },
}))
vi.mock('@/api/index', () => ({
  usersApi: { list: () => Promise.resolve([]) },
  mentorAssignmentsApi: {},
}))
vi.mock('@/api/sync', () => ({
  syncApi: {
    status: () => Promise.resolve({ new_submissions: 0 }),
    overview: () => Promise.resolve({}),
  },
}))
vi.mock('@/api/notion', () => ({
  notionApi: { snapshots: () => Promise.resolve([]), status: () => Promise.resolve({}) },
}))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can: () => false, hasRole: () => false, user: { id: 'u1', role: 'mzk_manager' } }),
}))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const { StudentsListPage } = await import('./StudentsListPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/students']}>
        <StudentsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const KEY = 'teenteched_portal:students:list:'

describe('фильтры общей базы переживают возврат', () => {
  beforeEach(() => {
    localStorage.clear()
    listCalls.mockClear()
  })

  it('строка поиска остаётся после ухода со страницы', async () => {
    const first = renderPage()
    fireEvent.change(await screen.findByPlaceholderText('Поиск студентов...'), {
      target: { value: 'Абылай' },
    })
    // Уход в карточку студента: страница списка размонтируется целиком.
    first.unmount()

    renderPage()

    expect(await screen.findByPlaceholderText('Поиск студентов...')).toHaveValue('Абылай')
  })

  it('сохранённые фильтры доезжают до запроса, а не только до полей', async () => {
    // Значение уже лежит в хранилище — так выглядит возврат из карточки.
    localStorage.setItem(`${KEY}degree`, JSON.stringify('bachelor'))
    localStorage.setItem(`${KEY}intakeYear`, JSON.stringify('2026'))

    renderPage()

    await waitFor(() => expect(listCalls).toHaveBeenCalled())
    expect(listCalls.mock.calls.at(-1)?.[0]).toMatchObject({
      degree_level: 'bachelor',
      intake_year: 2026,
    })
  })

  it('«Сбросить всё» очищает и строку поиска', async () => {
    // Кнопка появляется только при активном фильтре, поэтому один задаём.
    localStorage.setItem(`${KEY}degree`, JSON.stringify('bachelor'))
    renderPage()
    fireEvent.change(await screen.findByPlaceholderText('Поиск студентов...'), {
      target: { value: 'Абылай' },
    })

    fireEvent.click(await screen.findByText('Сбросить всё'))

    expect(screen.getByPlaceholderText('Поиск студентов...')).toHaveValue('')
  })

  it('«Сбросить всё» снимает признак основной страны', async () => {
    // Он не виден отдельным фильтром и раньше переживал сброс: следующая
    // выбранная страна молча искалась только как основная.
    localStorage.setItem(`${KEY}degree`, JSON.stringify('bachelor'))
    localStorage.setItem(`${KEY}countryPrimaryOnly`, JSON.stringify(true))
    renderPage()

    fireEvent.click(await screen.findByText('Сбросить всё'))

    await waitFor(() =>
      expect(localStorage.getItem(`${KEY}countryPrimaryOnly`)).toBe('false'),
    )
  })
})
