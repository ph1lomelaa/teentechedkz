import apiClient from './client'

/** Доступ к порталу вуза (admission). Пароль в списке не приходит —
 *  только через `reveal`, и каждый показ пишется в журнал на бэкенде. */
export interface PortalCredential {
  id: string
  student_id: string
  university_id: string | null
  application_id: string | null
  portal_name: string
  portal_url: string
  login: string
  notes: string
  created_at: string
  updated_at: string
}

export interface PortalCredentialPayload {
  application_id?: string | null
  university_id?: string | null
  portal_name: string
  portal_url: string
  login: string
  /** При правке пустой пароль не отправляется — остаётся прежний. */
  password?: string
  notes: string
}

export const credentialsApi = {
  listForStudent: async (studentId: string): Promise<PortalCredential[]> => {
    const response = await apiClient.get<PortalCredential[]>(`/students/${studentId}/credentials`)
    return response.data
  },
  listMine: async (): Promise<PortalCredential[]> => {
    const response = await apiClient.get<PortalCredential[]>('/portal/credentials')
    return response.data
  },
  create: async (data: PortalCredentialPayload & { student_id: string }): Promise<PortalCredential> => {
    const response = await apiClient.post<PortalCredential>('/credentials', data)
    return response.data
  },
  update: async (id: string, data: Partial<PortalCredentialPayload>): Promise<PortalCredential> => {
    const response = await apiClient.patch<PortalCredential>(`/credentials/${id}`, data)
    return response.data
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/credentials/${id}`)
  },
  reveal: async (id: string): Promise<string> => {
    const response = await apiClient.get<{ password: string }>(`/credentials/${id}/reveal`)
    return response.data.password
  },
}

/** Есть ли у подачи доступ: привязан к ней самой или к тому же вузу.
 *  Та же логика, что в backend services/admission_guard.py. */
export function hasCredentialFor(
  creds: PortalCredential[],
  app: { id: string; university_id?: string | null }
): boolean {
  return creds.some(
    (c) => c.application_id === app.id || (Boolean(app.university_id) && c.university_id === app.university_id)
  )
}
