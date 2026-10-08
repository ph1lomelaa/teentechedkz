import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForgotPasswordForm } from './ForgotPasswordForm'

const requestPasswordReset = vi.fn()

vi.mock('@/api/auth', () => ({
  authApi: { requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a) },
}))

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    requestPasswordReset.mockReset()
  })

  it('отправляет почту из формы входа и напоминает про «Спам»', async () => {
    requestPasswordReset.mockResolvedValue({ message: 'ok' })
    render(<ForgotPasswordForm initialEmail=" aigerim@gmail.com " />)
    fireEvent.click(screen.getByRole('button', { name: 'Прислать ссылку' }))
    expect(await screen.findByText('Проверьте почту')).toBeTruthy()
    expect(requestPasswordReset).toHaveBeenCalledWith('aigerim@gmail.com')
    expect(screen.getByText(/«Спам»/)).toBeTruthy()
  })

  it('без настроенной почты отправляет к куратору', async () => {
    requestPasswordReset.mockRejectedValue({
      response: { status: 503, headers: { 'x-error-code': 'MAIL_NOT_CONFIGURED' } },
      message: 'Request failed with status code 503',
    })
    render(<ForgotPasswordForm initialEmail="a@b.kz" />)
    fireEvent.click(screen.getByRole('button', { name: 'Прислать ссылку' }))
    expect(await screen.findByText(/Напишите своему ментору/)).toBeTruthy()
  })
})
