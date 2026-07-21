import apiClient from './client'

export interface InviteInfo {
  valid: boolean
  name?: string | null
  email?: string | null
}

export interface AcceptInviteResponse {
  message: string
  email: string
}

// Public (unauthenticated) invite flow — either URL token or short code.
export const inviteApi = {
  get: (token: string) =>
    apiClient.get<InviteInfo>(`/public/invite/${encodeURIComponent(token)}`).then((r) => r.data),

  accept: (token: string, password: string) =>
    apiClient
      .post<AcceptInviteResponse>(`/public/invite/${encodeURIComponent(token)}/accept`, { password })
      .then((r) => r.data),

  acceptByCode: (code: string, password: string) =>
    apiClient
      .post<AcceptInviteResponse>(`/public/invite/${encodeURIComponent(code)}/accept-code`, { password })
      .then((r) => r.data),
}
