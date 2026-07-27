import apiClient from './client'
import { User } from '../types'

export interface InviteInfo {
  valid: boolean
  name?: string | null
  email?: string | null
}

export interface AcceptInviteResponse {
  message: string
  access_token: string
  token_type: string
  expires_in: number
  user: User
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
