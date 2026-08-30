import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionMatrix } from '@/api/permissions'

/**
 * Страница матрицы прав.
 *
 * Ради чего тест: матрица опасна тем, что выглядит убедительно. Галочка,
 * потерявшая метку скоупа, читается как «весь раздел» — и по ней принимают
 * решение о доступе к ПДн. Поэтому проверяется не факт рендера, а то, что до
 * экрана доезжают ровно три вещи, ради которых страница и делалась: решение,
 * его объём (скоуп) и пометки о том, чего в клетке не видно.
 */
const matrix: PermissionMatrix = {
  roles: ['admin', 'mzk_manager', 'mentor', 'student'],
  actions: ['view', 'create', 'edit', 'delete', 'manage'],
  resources: ['students', 'guardians'],
  rules: [
    {
      resource: 'students',
      action: 'view',
      roles: {
        admin: { allowed: true, scope: 'all' },
        mzk_manager: { allowed: true, scope: 'all' },
        mentor: { allowed: true, scope: 'assigned' },
        student: { allowed: true, scope: 'own' },
      },
      basis: null,
      extra_rules: ['Архивные студенты скрыты от ментора — students.py:1522'],
      denied_detail: null,
      error_code: 'FORBIDDEN',
      review: null,
      locked: false,
      is_overridden: false,
    },
    {
      resource: 'guardians',
      action: 'manage',
      roles: {
        admin: { allowed: true, scope: 'all' },
        mzk_manager: { allowed: true, scope: 'all' },
        mentor: { allowed: true, scope: 'assigned' },
        student: { allowed: false, scope: null },
      },
      basis: null,
      extra_rules: [],
      denied_detail: null,
      error_code: 'FORBIDDEN',
      review: 'Имя функции обещало admin+МЗК, но код пускает и ментора',
      locked: false,
      is_overridden: false,
    },
    {
      resource: 'permissions',
      action: 'manage',
      roles: {
        admin: { allowed: true, scope: 'all' },
        mzk_manager: { allowed: false, scope: null },
        mentor: { allowed: false, scope: null },
        student: { allowed: false, scope: null },
      },
      basis: null,
      extra_rules: [],
      denied_detail: null,
      error_code: 'FORBIDDEN',
      review: null,
      locked: true,
      is_overridden: false,
    },
  ],
  summary: { resources: 3, rules: 3, needs_review: 1, rules_with_extra: 1, extra_rules: 1 },
}

// Аргументы объявлены, чтобы mock.calls был типизирован и проверка состава
// ролей ниже читалась без приведений.
const setRoles = vi.fn(
  async (resource: string, action: string, roles: string[]) => ({
    roles,
    previous_roles: [] as string[],
    sent: `${resource}:${action}`,
  }),
)
const can = vi.fn(() => true)

vi.mock('@/api/permissions', () => ({
  permissionsApi: {
    matrix: vi.fn(async () => matrix),
    setRoles: (resource: string, action: string, roles: string[]) => setRoles(resource, action, roles),
  },
}))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ can }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const { SettingsPermissionsPage } = await import('./SettingsPermissionsPage')

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SettingsPermissionsPage />
    </QueryClientProvider>,
  )
}

function rowFor(resource: string): HTMLElement {
  return screen.getByText(resource).closest('tr') as HTMLElement
}

describe('матрица прав', () => {
  // Базовый режим этих проверок — только чтение: они про то, что видно, а не
  // про правку. В режиме правки клетка становится кнопкой и подписана иначе.
  beforeEach(() => can.mockReturnValue(false))

  it('показывает решение и объём данных отдельно', async () => {
    renderPage()
    await screen.findByText('students')

    const cells = within(rowFor('students')).getAllByLabelText('есть доступ')
    expect(cells).toHaveLength(4)
    // Скоуп — второй axis: без него ментор и админ выглядели бы одинаково.
    expect(within(rowFor('students')).getByText('свои студенты')).toBeInTheDocument()
    expect(within(rowFor('students')).getByText('своя запись')).toBeInTheDocument()
  })

  it('не подписывает скоуп «весь раздел»', async () => {
    renderPage()
    await screen.findByText('students')
    // Значение по умолчанию у большинства правил: подпись на каждой клетке
    // утопила бы в шуме те немногие, где объём действительно урезан.
    expect(within(rowFor('students')).queryByText('весь раздел')).not.toBeInTheDocument()
  })

  it('отличает запрет от разрешения', async () => {
    renderPage()
    await screen.findByText('guardians')
    expect(within(rowFor('guardians')).getAllByLabelText('нет доступа')).toHaveLength(1)
  })

  it('помечает расхождения и скрытые условия', async () => {
    renderPage()
    await screen.findByText('guardians')
    expect(within(rowFor('guardians')).getByText('требует решения')).toBeInTheDocument()
    expect(within(rowFor('students')).getByText('+1 доп. правил')).toBeInTheDocument()
  })

  it('раскрывает условие целиком, а не только его количество', async () => {
    renderPage()
    await screen.findByText('students')
    // Пометка «+N» сама по себе бесполезна: важно, что за ней стоит.
    fireEvent.click(rowFor('students'))
    expect(
      await screen.findByText('— Архивные студенты скрыты от ментора — students.py:1522'),
    ).toBeInTheDocument()
    expect(screen.getByText('Основание: регламентом не зафиксировано')).toBeInTheDocument()
  })

  it('фильтрует до правил, требующих решения', async () => {
    renderPage()
    await screen.findByText('students')
    fireEvent.click(screen.getByLabelText('Только требующие решения'))
    await waitFor(() => expect(screen.queryByText('students')).not.toBeInTheDocument())
    expect(screen.getByText('guardians')).toBeInTheDocument()
  })

  it('ищет по названию раздела', async () => {
    renderPage()
    await screen.findByText('students')
    fireEvent.change(screen.getByPlaceholderText('Найти раздел или действие'), {
      target: { value: 'guard' },
    })
    await waitFor(() => expect(screen.queryByText('students')).not.toBeInTheDocument())
    expect(screen.getByText('guardians')).toBeInTheDocument()
  })
})


describe('конструктор прав', () => {
  beforeEach(() => {
    setRoles.mockClear()
    can.mockReturnValue(true)
  })

  it('клетка переключается и шлёт новый состав ролей', async () => {
    renderPage()
    await screen.findByText('students')
    // У ментора доступ есть — нажатие обязано его снять, а не продублировать.
    fireEvent.click(within(rowFor('students')).getByRole('button', { name: /Ментор: есть доступ/ }))
    await waitFor(() => expect(setRoles).toHaveBeenCalled())
    const [resource, action, roles] = setRoles.mock.calls[0]
    expect(resource).toBe('students')
    expect(action).toBe('view')
    expect(roles).not.toContain('mentor')
    expect(roles).toContain('admin')
  })

  it('защищённое правило не переключается', async () => {
    renderPage()
    await screen.findByText('permissions')
    // Строка показывается — иначе админ будет искать пропавшее право, —
    // но кнопок в ней нет.
    expect(within(rowFor('permissions')).getByText('защищено')).toBeInTheDocument()
    expect(within(rowFor('permissions')).queryByRole('button', { name: /доступ/ })).not.toBeInTheDocument()
  })

  it('без права на правку матрица только читается', async () => {
    can.mockReturnValue(false)
    renderPage()
    await screen.findByText('students')
    expect(screen.queryByRole('button', { name: /Нажмите, чтобы/ })).not.toBeInTheDocument()
  })
})
