import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PasswordField, newPasswordChecks, newPasswordReady } from './PasswordField'

describe('PasswordField', () => {
  it('показывает и скрывает пароль', () => {
    render(<PasswordField id="p" label="Пароль" value="secret12" onChange={vi.fn()} autoComplete="current-password" />)
    const input = screen.getByLabelText('Пароль') as HTMLInputElement
    expect(input.type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Показать пароль' }))
    expect(input.type).toBe('text')
  })

  it('требования к новому паролю', () => {
    expect(newPasswordReady('short', 'short')).toBe(false)
    expect(newPasswordReady('longenough', 'different')).toBe(false)
    expect(newPasswordReady('longenough', 'longenough')).toBe(true)
    const mix = newPasswordChecks('пароль12', 'пароль12').find((c) => c.key === 'mix')
    expect(mix?.ok).toBe(true)
  })
})
