import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StudentCardErrorBoundary } from './StudentCardErrorBoundary'
import { reportClientRuntimeError } from '@/lib/clientRuntimeErrors'

vi.mock('@/lib/clientRuntimeErrors', () => ({ reportClientRuntimeError: vi.fn() }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

let broken = true
function Card() { if (broken) throw new TypeError('bad card'); return <div>Карточка открыта</div> }

describe('card error isolation', () => {
  it.each([true, false])('keeps navigation and allows recovery (workspace=%s)', workspace => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    broken = true
    render(<MemoryRouter><nav>Кабинет и навигация</nav><StudentCardErrorBoundary workspace={workspace}><Card /></StudentCardErrorBoundary></MemoryRouter>)
    expect(screen.getByText('Кабинет и навигация')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось открыть карточку')
    expect(screen.getByText('К списку учеников')).toHaveAttribute('href', workspace ? '/workspace/students' : '/students')
    expect(reportClientRuntimeError).toHaveBeenCalled()
    broken = false
    fireEvent.click(screen.getByText('Повторить'))
    expect(screen.getByText('Карточка открыта')).toBeInTheDocument()
    expect(screen.getByText('Кабинет и навигация')).toBeInTheDocument()
  })
})
