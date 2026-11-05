import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { UserModal } from './SettingsUsersPage'
import type { User } from '@/types'
const update = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock('@/api/index', () => ({ usersApi: { update } }))
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'admin' } }) }))
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
function open(role: User['role']) {
 const user = { id: 'employee', name: 'Test', email: 'test@example.test', role, mentor_specialties: ['portfolio'] } as User
 render(<QueryClientProvider client={new QueryClient()}><UserModal user={user} open onClose={vi.fn()} /></QueryClientProvider>)
}
it('hides specialties for finance staff and does not submit hidden values', async () => {
 open('finance_manager')
 expect(screen.queryByText('Специализация')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
 await waitFor(() => expect(update).toHaveBeenCalledWith('employee', expect.objectContaining({ role: 'finance_manager', mentor_specialties: [] })))
})
it('keeps specialties available for mentors', () => {
 open('mentor')
 expect(screen.getByText('Специализация')).toBeInTheDocument()
 expect(screen.getByRole('checkbox', { name: 'Портфолио' })).toBeChecked()
})
