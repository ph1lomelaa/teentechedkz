import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportClientRuntimeError } from './clientRuntimeErrors'
import { setAccessToken } from '@/api/client'

afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null); window.history.replaceState({}, '', '/') })
describe('first-party client diagnostics', () => {
  it('reports component names without the private message, student ID or query', () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 202 })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/workspace/students/private-student-id?token=secret')
    setAccessToken('access-token')
    reportClientRuntimeError(new TypeError('private@example.kz password=secret'), '\n    at WorkspaceStudentDetailPage (private-data)\n    at AppLayout (data)')
    const [, options] = fetchMock.mock.calls[0]
    const payload = JSON.parse(options.body)
    expect(payload).toEqual({ kind: 'render', error_type: 'TypeError', route: 'workspace_student_card', components: ['WorkspaceStudentDetailPage', 'AppLayout'] })
    expect(options.body).not.toMatch(/private|secret|password|token/)
    reportClientRuntimeError(new TypeError('same'), '\n    at WorkspaceStudentDetailPage\n    at AppLayout')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does nothing when there is no authenticated session', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    reportClientRuntimeError(new Error('ignored'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('ignores diagnostic transport failures without refreshing or throwing', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    setAccessToken('access')
    expect(() => reportClientRuntimeError(new RangeError('failure'), '', 'unhandled')).not.toThrow()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
