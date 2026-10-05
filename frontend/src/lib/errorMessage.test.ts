import { describe, expect, it } from 'vitest'
import { getErrorMessage } from './errorMessage'

const axiosError = (data: unknown) => ({ message: 'Request failed with status code 422', response: { status: 422, data } })

describe('getErrorMessage', () => {
  it('returns string detail as is', () => {
    expect(getErrorMessage(axiosError({ detail: 'Не выбран ни один исполнитель' }))).toBe('Не выбран ни один исполнитель')
  })

  it('surfaces skipped reasons of a bulk operation instead of the axios text', () => {
    const error = axiosError({
      detail: {
        message: 'Ни одна задача не создана',
        skipped: [
          { assignee_id: '1', reason: 'Недостаточно прав для операции' },
          { assignee_id: '2', reason: 'Недостаточно прав для операции' },
        ],
      },
    })
    expect(getErrorMessage(error)).toBe('Ни одна задача не создана: Недостаточно прав для операции')
  })

  it('falls back to the axios message when the body says nothing', () => {
    expect(getErrorMessage(axiosError({}))).toBe('Request failed with status code 422')
  })
})
