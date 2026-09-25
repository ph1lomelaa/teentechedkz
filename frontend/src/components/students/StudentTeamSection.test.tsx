import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { ResponsibleUser } from '@/types'

/**
 * «Команда ученика». Раньше строка «МЗК:» читала договор и показывала «—»
 * рядом с активным назначением МЗК, а два ментора по УП сразу висели молча.
 */
vi.mock('@/api/index', () => ({
  mentorAssignmentsApi: { unassign: vi.fn(), history: vi.fn(() => Promise.resolve([])), create: vi.fn() },
  // Кандидатов на роль диалог спрашивает сам — список больше не приходит пропсами.
  usersApi: { listAssignable: vi.fn(() => Promise.resolve([])) },
}))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))

const { StudentTeamSection } = await import('./StudentTeamSection')

const person = (over: Partial<ResponsibleUser>): ResponsibleUser => ({
  id: 'u1',
  assignment_id: 'a1',
  name: 'Мерей Рахимгалиева',
  role: 'mzk',
  is_active: true,
  assignment_status: 'active',
  ...over,
})

function renderTeam(responsibles: ResponsibleUser[], canManage = true) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <StudentTeamSection
        studentId="s1"
        responsibles={responsibles}
        canManage={canManage}
      />
    </QueryClientProvider>,
  )
}

describe('команда ученика', () => {
  it('МЗК берётся из назначения, а не из договора', () => {
    renderTeam([person({})])
    expect(screen.getByText('Мерей Рахимгалиева')).toBeInTheDocument()
    expect(screen.getAllByText('Требуется назначение')).toHaveLength(4)
  })

  it('помечает двух ответственных в одной роли', () => {
    renderTeam([
      person({ role: 'lead' }),
      person({ id: 'u2', assignment_id: 'a2', name: 'Нусупжанова Аружан', role: 'lead', assignment_status: 'awaiting_signature' }),
    ])
    expect(screen.getByText(/Два ответственных в одной роли/)).toBeInTheDocument()
  })

  it('двое менторов по стране — норма, а не авария', () => {
    // Ученик подаётся в несколько стран, и каждую ведёт свой человек. Пока
    // предупреждение висело на любой роли, штатное состояние выглядело ошибкой
    // данных и подсказывало «снимите лишнего».
    renderTeam([
      person({ role: 'country', name: 'Айана Ділмағанбет', country_scope: 'США' }),
      person({ id: 'u2', assignment_id: 'a2', name: 'Кызжибек', role: 'country', country_scope: 'Канада' }),
    ])
    expect(screen.queryByText(/Два ответственных в одной роли/)).not.toBeInTheDocument()
  })

  it('страна показана рядом с именем — иначе строки не различить', () => {
    renderTeam([
      person({ role: 'country', name: 'Айана Ділмағанбет', country_scope: 'США' }),
      person({ id: 'u2', assignment_id: 'a2', name: 'Кызжибек', role: 'country', country_scope: 'Канада' }),
    ])
    expect(screen.getByText('· США')).toBeInTheDocument()
    expect(screen.getByText('· Канада')).toBeInTheDocument()
  })

  it('в мультироли кнопка добавляет, а не заменяет', () => {
    // Общая кнопка справа: для занятой одиночной роли это «Заменить», а для
    // страны — «Добавить», иначе второго ментора нечем завести.
    renderTeam([person({ role: 'country', name: 'Айана Ділмағанбет', country_scope: 'США' })])
    expect(screen.getByText('Добавить')).toBeInTheDocument()
    expect(screen.queryAllByText('Заменить').length).toBeGreaterThan(0)
  })

  it('в одиночной роли занятая роль по-прежнему заменяется', () => {
    renderTeam([person({ role: 'lead' })])
    expect(screen.getByText('Заменить')).toBeInTheDocument()
    expect(screen.queryByText('Добавить')).not.toBeInTheDocument()
  })

  it('снятые и плейсхолдеры не показываются как люди', () => {
    renderTeam([
      person({ is_active: false, name: 'Снятый Человек' }),
      person({ assignment_status: 'required', name: null, role: 'career' }),
    ])
    expect(screen.queryByText('Снятый Человек')).not.toBeInTheDocument()
  })

  it('без права управлять — только чтение', () => {
    renderTeam([person({})], false)
    expect(screen.queryByText('Снять')).not.toBeInTheDocument()
    expect(screen.queryByText('Назначить')).not.toBeInTheDocument()
  })
})
