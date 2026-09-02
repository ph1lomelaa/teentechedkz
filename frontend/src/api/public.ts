import apiClient from './client'
import type { LoginResponse } from './auth'

export interface PublicApplicationInput {
  full_name: string
  phone: string
  email?: string
  city?: string
  degree_level?: string
  intake_year?: number
  target_country?: string
  program_interest?: string
  message?: string
}

export interface PublicApplicationResult {
  id: string
  status: string
  message: string
}

export interface MentorSignupInput {
  name: string
  email: string
  phone?: string
  password: string
}

export interface JoinInput {
  credential: string
  requested_role: 'student' | 'mentor'
  full_name: string
  phone: string
  city?: string
  direction?: string
  code?: string
}

/**
 * `status` — единственное, что решает, куда вести человека дальше.
 * `active` — он уже в системе (совпал телефон или код), `pending` — ждёт
 * админа. Сессия приходит в обоих случаях: ждущий должен видеть свою заявку.
 */
export type JoinResult = LoginResponse & { status: 'active' | 'pending' }

export const publicApi = {
  join: async (body: JoinInput): Promise<JoinResult> => {
    const response = await apiClient.post<JoinResult>('/public/join', body)
    return response.data
  },
  createApplication: async (body: PublicApplicationInput): Promise<PublicApplicationResult> => {
    const response = await apiClient.post<PublicApplicationResult>('/public/applications', body)
    return response.data
  },
  mentorSignup: async (body: MentorSignupInput): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>('/public/mentor-signup', body)
    return response.data
  },
}
