import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Переключатель «Доска / Таблица» и фильтры живут в URL: ссылкой делятся,
 * а «Назад» в браузере должен возвращать прежний вид. Проверяем на настоящем
 * компоненте страницы, а не на отдельной кнопке.
 */
const rows = [
  { id: 'p1', snapshot_id: 's1', notion_page_id: 'p1', student_id: 'st1', source: 'notion', link_status: 'linked',
    responsibles: [{ id: 'm1', name: 'Bibinur', role: 'lead' }],
    values: { 'е': 'Аян', Intake: '2026', 'Статус выплат': 'Активная работа', Degree: 'Bachelor' } },
  { id: 'p2', snapshot_id: 's2', notion_page_id: 'p2', student_id: 'st2', source: 'notion', link_status: 'linked',
    responsibles: [],
    values: { 'е': 'Дана', Intake: '2027', 'Статус выплат': 'Пауза', Degree: 'Master' } },
]

vi.mock('@/api/notion', () => ({
  notionApi: {
    pipelineTable: () => Promise.resolve({
      columns: ['е', 'Degree', 'Intake', 'Статус выплат'], items: rows, total: rows.length,
      option_colors: { 'Статус выплат': { 'Активная работа': 'green', 'Пауза': 'gray' } }, field_meta: {},
    }),
    status: () => Promise.resolve({ configured: true, needs_review: 0,
      last_run: { at: new Date().toISOString(), ok: true, error: null, counters: { total: 2 } } }),
    pipelineReport: () => Promise.resolve(null),
    run: vi.fn(),
    ensureStudent: vi.fn(),
    link: vi.fn(),
    studentNotion: () => Promise.resolve({}),
  },
}))
vi.mock('@/api/students', () => ({ studentsApi: { get: () => Promise.resolve({}) } }))
vi.mock('@/api/index', () => ({ usersApi: { list: () => Promise.resolve([]) }, mentorAssignmentsApi: {} }))
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ can: () => true, hasRole: () => true, user: { id: 'u1', role: 'admin' } }),
}))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const { NotionPipelineTable } = await import('./NotionPipelineTable')

let location = { search: '' }
let navigate: (delta: number) => void = () => {}
function Probe() {
  location = useLocation()
  const nav = useNavigate()
  navigate = (delta) => nav(delta)
  return null
}

function renderPage(url = '/dashboard') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <NotionPipelineTable overview />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const search = () => new URLSearchParams(location.search)

describe('вид пайплайна', () => {
  beforeEach(() => localStorage.clear())

  it('по умолчанию таблица; «Доска» пишет ?view=board, «Назад» возвращает таблицу', async () => {
    renderPage()
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Таблица/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(screen.getByRole('tab', { name: /Доска/ }))
    await waitFor(() => expect(search().get('view')).toBe('board'))
    expect(screen.getByRole('tab', { name: /Доска/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText('Активная работа · 1')).toBeInTheDocument()

    act(() => navigate(-1))
    await waitFor(() => expect(search().get('view')).toBeNull())
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('стрелки на вкладках переключают вид и переносят фокус', async () => {
    renderPage('/dashboard?view=board')
    const board = await screen.findByRole('tab', { name: /Доска/ })
    board.focus()
    fireEvent.keyDown(board, { key: 'ArrowRight' })
    await waitFor(() => expect(search().get('view')).toBe('table'))
    expect(screen.getByRole('tab', { name: /Таблица/ })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: /Таблица/ }), { key: 'ArrowLeft' })
    await waitFor(() => expect(search().get('view')).toBe('board'))
  })

  it('фильтр из ссылки показывается чипом и отбирает строки; крестик его снимает', async () => {
    const f = encodeURIComponent(JSON.stringify({ Intake: { operator: 'is', values: ['2026'] } }))
    renderPage(`/dashboard?view=table&group=none&f=${f}`)
    const table = await screen.findByRole('table')
    expect(screen.getByText('Intake: 2026')).toBeInTheDocument()
    expect(within(table).getByText('Аян')).toBeInTheDocument()
    expect(within(table).queryByText('Дана')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Убрать фильтр Intake' }))
    await waitFor(() => expect(search().get('f')).toBeNull())
    expect(within(screen.getByRole('table')).getByText('Дана')).toBeInTheDocument()
  })

  it('пустой результат — «Ничего не найдено» и сброс фильтров', async () => {
    const f = encodeURIComponent(JSON.stringify({ Intake: { operator: 'is', values: ['1999'] } }))
    renderPage(`/dashboard?f=${f}`)
    expect(await screen.findByText('Ничего не найдено')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }))
    await waitFor(() => expect(search().get('f')).toBeNull())
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })
})
