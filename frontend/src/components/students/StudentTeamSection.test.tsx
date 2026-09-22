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
        mentors={[]}
        mzkManagers={[]}
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
