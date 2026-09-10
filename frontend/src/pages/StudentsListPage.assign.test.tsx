import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Назначение ответственных прямо из общей базы.
 *
 * Ради чего тест: назначить ответственного раньше можно было только внутри
 * карточки студента — на разборе набора это десятки переходов, и ответственные
 * просто не проставлялись.
 *
 * Здесь проверяется выбор студентов и подсветка «ментор только по имени» —
 * то, что видно до открытия выпадающих списков. Сам сценарий отправки и
 * повторный запрос по студентам с `needs_reason` отсюда не покрыты: списки
 * сделаны на Radix Select, который в jsdom не открывается. Эта половина
 * закреплена со стороны бэкенда (`test_mentor_assignment_bulk.py`, где живёт
 * само правило «частичный отказ не роняет пачку») и ручной проверкой.
 */
const bulkAssign = vi.fn()

vi.mock('@/api/students', () => ({
  studentsApi: {
    list: () =>
      Promise.resolve({
        items: [
          {
            id: 's1',
            full_name: 'Первый Студент',
            phone: '+77000000001',
            degree_level: 'undergraduate',
            intake_year: 2028,
            pipeline_status: null,
            responsibles: [],
            mentors: [],
            services_summary: { total: 0, in_progress: 0, scheduled: 0, completed: 0, items: [] },
          },
          {
            id: 's2',
            full_name: 'Второй Студент',
            phone: '+77000000002',
            degree_level: 'undergraduate',
            intake_year: 2028,
            pipeline_status: null,
            responsibles: [],
            // Ментор «по имени» из импорта — настоящего назначения нет.
            mentors: ['Айгерим К.'],
            services_summary: { total: 0, in_progress: 0, scheduled: 0, completed: 0, items: [] },
          },
        ],
        total: 2,
      }),
    getAll: () => Promise.resolve([]),
    facets: () => Promise.resolve({ statuses: [], years: [], degrees: [], countries: [] }),
  },
}))
vi.mock('@/api/index', () => ({
  usersApi: { list: () => Promise.resolve([{ id: 'm1', name: 'Ментор Один', role: 'mentor' }]) },
  mentorAssignmentsApi: {
    bulkAssign: (payload: unknown) => {
      bulkAssign(payload)
      return Promise.resolve(nextResponse)
    },
  },
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
  useAuth: () => ({ can: () => true, hasRole: () => true, user: { id: 'u1', role: 'admin' } }),
}))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

let nextResponse: unknown = { assigned: 0, replaced: 0, skipped: [], assignment_status: 'active' }

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

/**
 * Галочки и панель назначения живут внутри режима выбора: общую базу чаще
 * открывают, чтобы посмотреть студента, и постоянная колонка выделения читалась
 * как «здесь надо что-то отметить». Каждый сценарий сначала входит в режим.
 */
async function enterAssignMode() {
  fireEvent.click(await screen.findByText('Выбрать студентов'))
  return screen.findByLabelText('Выбрать Первый Студент')
}

describe('назначение ответственных из общей базы', () => {
  beforeEach(() => {
    localStorage.clear()
    bulkAssign.mockClear()
    nextResponse = { assigned: 0, replaced: 0, skipped: [], assignment_status: 'active' }
  })

  it('ментор «по имени» из импорта помечен как непривязанный', async () => {
    renderPage()
    // Именно это и путало: в списке такой студент выглядел как студент с
    // ответственным, хотя ментор его у себя не видит.
    expect(await screen.findByText(/по имени: Айгерим К\./)).toBeTruthy()
  })

  it('строчное назначение называет роль, а не молчит про неё', async () => {
    // Кнопка в строке раньше жёстко ставила «Ментор по УП» и никак этого не
    // показывала: выбрав в панели «Профориентолог», сотрудник всё равно
    // назначил бы ментора по УП и не увидел бы подвоха.
    renderPage()
    await enterAssignMode()

    expect(screen.queryByText('+ Назначить')).toBeNull()
    expect(screen.getAllByText('+ Ментор по УП').length).toBeGreaterThan(0)
  })

  it('панель массового назначения появляется после выбора студентов', async () => {
    renderPage()

    // До выбора панели нет — она не должна занимать место просто так.
    await enterAssignMode()
    expect(screen.queryByText(/^Выбрано:/)).toBeNull()

    // Кого назначить — видно сразу, вместе с ролью: роль выбирают именно
    // затем, чтобы увидеть список людей. Кнопка при этом ждёт выделения.
    expect(screen.getByText('Кого назначить')).toBeTruthy()
    expect(screen.getByText('Назначить ответственного').closest('button')?.disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('Выбрать Первый Студент'))
    fireEvent.click(screen.getByLabelText('Выбрать Второй Студент'))

    expect(await screen.findByText('Выбрано: 2')).toBeTruthy()
    expect(screen.getByText('Назначить ответственного')).toBeTruthy()
  })

  it('счётчик учитывает только видимых — выделение переживает фильтр', async () => {
    // Отметил двоих, сузил поиск до одного — «Выбрано» обязано стать 1.
    // Иначе кнопка назначала бы и тому, кого на экране уже нет.
    renderPage()
    await enterAssignMode()
    fireEvent.click(screen.getByLabelText('Выбрать Первый Студент'))
    fireEvent.click(screen.getByLabelText('Выбрать Второй Студент'))
    expect(await screen.findByText('Выбрано: 2')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Поиск студентов...'), {
      target: { value: 'Первый' },
    })

    expect(await screen.findByText('Выбрано: 1')).toBeTruthy()
  })

  it('без режима выбора таблица чистая — ни галочек, ни панели', async () => {
    // Ради чего: галочка в каждой строке и панель с ролью — инструмент разбора
    // набора, а не постоянная часть списка.
    renderPage()
    await screen.findByText('Первый Студент')

    expect(screen.queryByLabelText('Выбрать Первый Студент')).toBeNull()
    expect(screen.queryByLabelText('Выбрать всех на странице')).toBeNull()
    expect(screen.queryByText('Назначить:')).toBeNull()
    expect(screen.queryByText('+ Ментор по УП')).toBeNull()
  })

  it('«выбрать всех» берёт только то, что видно после фильтров', async () => {
    renderPage()
    // Дожидаемся строк: заголовок таблицы рисуется и во время загрузки, а
    // «выбрать всех» относится к загруженной выборке.
    await enterAssignMode()
    fireEvent.click(screen.getByLabelText('Выбрать всех на странице'))
    expect(await screen.findByText('Выбрано: 2')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Выбрать всех на странице'))
    await waitFor(() => expect(screen.queryByText(/^Выбрано:/)).toBeNull())
  })
})
