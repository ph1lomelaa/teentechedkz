import apiClient from './client'

export interface EmailEntry {
  id: string | null
  email: string
  is_primary: boolean
  is_verified: boolean
}

export interface AccessStatus {
  has_access: boolean
  user_id?: string | null
  email?: string | null
  name?: string | null
  is_active?: boolean | null
  must_change_password?: boolean | null
  last_login_at?: string | null
  primary_mentor_id?: string | null
  primary_mentor_name?: string | null
  emails?: EmailEntry[]
}

export interface GrantAccessResponse {
  user_id: string
  email: string
  name: string
  temp_password: string
  invite_url: string
  invite_code: string
  invite_expires_at: string
}

export interface ResetPasswordResponse {
  temp_password: string
}

export interface InviteResponse {
  invite_url: string
  invite_code: string
  invite_expires_at: string
}

export const portalAccessApi = {
  get: (studentId: string) =>
    apiClient.get<AccessStatus>(`/students/${studentId}/access`).then((r) => r.data),

  grant: (studentId: string, email: string, name?: string) =>
    apiClient
      .post<GrantAccessResponse>(`/students/${studentId}/grant-access`, { email, name })
      .then((r) => r.data),

  reset: (studentId: string) =>
    apiClient
      .post<ResetPasswordResponse>(`/students/${studentId}/reset-password`)
      .then((r) => r.data),

  reissueInvite: (studentId: string) =>
    apiClient
      .post<InviteResponse>(`/students/${studentId}/invite`)
      .then((r) => r.data),

  addEmail: (studentId: string, email: string) =>
    apiClient
      .post<AccessStatus>(`/students/${studentId}/emails`, { email })
      .then((r) => r.data),

  removeEmail: (studentId: string, emailId: string) =>
    apiClient
      .delete<AccessStatus>(`/students/${studentId}/emails/${emailId}`)
      .then((r) => r.data),

  toggle: (studentId: string, is_active: boolean) =>
    apiClient
      .patch<AccessStatus>(`/students/${studentId}/access`, { is_active })
      .then((r) => r.data),
}
