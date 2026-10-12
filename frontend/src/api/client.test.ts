import axios, { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient, getAccessToken, refreshAccessToken, setAccessToken } from './client'

afterEach(() => { vi.restoreAllMocks(); setAccessToken(null) })

describe('session refresh', () => {
  it.each([503, undefined])('keeps the session on transient failure %s', async status => {
    const error = status ? { response: { status } } : new Error('offline')
    vi.spyOn(axios, 'post').mockRejectedValue(error)
    setAccessToken('existing-session')
    await expect(refreshAccessToken()).rejects.toBe(error)
    expect(getAccessToken()).toBe('existing-session')
  })

  it('clears the token only on confirmed invalid refresh credentials', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } })
    setAccessToken('old')
    expect(await refreshAccessToken()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })

  it('shares one refresh across concurrent requests', async () => {
    let finish!: (value: unknown) => void
    const post = vi.spyOn(axios, 'post').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = refreshAccessToken()
    const second = refreshAccessToken()
    expect(first).toBe(second)
    finish({ data: { access_token: 'new' } })
    expect(await Promise.all([first, second])).toEqual(['new', 'new'])
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('an API 401 followed by a server failure preserves login and allows retry', async () => {
    const post = vi.spyOn(axios, 'post').mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: { access_token: 'new' } })
    let calls = 0
    const adapter = vi.fn(async config => {
      calls++
      if (calls < 3) throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, undefined,
        { status: 401, statusText: 'Unauthorized', data: {}, headers: {}, config })
      return { status: 200, statusText: 'OK', data: { ok: true }, headers: {}, config }
    })
    setAccessToken('old')
    await expect(apiClient.get('/test', { adapter })).rejects.toMatchObject({ response: { status: 503 } })
    expect(getAccessToken()).toBe('old')
    expect((await apiClient.get('/test', { adapter })).data).toEqual({ ok: true })
    expect(post).toHaveBeenCalledTimes(2)
    expect(getAccessToken()).toBe('new')
  })
})
