import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { useWorkspaceScope } from './useWorkspaceScope'
const auth = vi.hoisted(() => ({ role: 'mentor' }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: auth.role } }) }))
function Probe() { const { params } = useWorkspaceScope(); return <output>{JSON.stringify(params)}</output> }
function mount(role: string, query = '') { auth.role = role; render(<MemoryRouter initialEntries={[`/workspace/documents${query}`]}><Probe /></MemoryRouter>) }
it.each(['admin', 'mzk_manager', 'academic_head'])('%s sees all student work by default without an assignment', role => {
  mount(role)
  expect(screen.getByRole('status')).toHaveTextContent('{"scope":"all"}')
})
it('keeps the mentor personal scope and does not turn scope=all into a permission grant', () => {
  mount('mentor', '?scope=all')
  expect(screen.getByRole('status')).toHaveTextContent('{"scope":"mine"}')
})
it('allows a supervisor to deliberately choose only their own students', () => {
  mount('academic_head', '?scope=mine')
  expect(screen.getByRole('status')).toHaveTextContent('{"scope":"mine"}')
})
it('keeps an explicit mentor filter for supervision', () => {
  mount('mzk_manager', '?mentor_id=m2')
  expect(screen.getByRole('status')).toHaveTextContent('{"mentor_id":"m2"}')
})
