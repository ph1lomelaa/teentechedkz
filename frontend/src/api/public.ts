import apiClient from './client'
import type { LoginResponse } from './auth'

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

/**
 * Публичное API — ровно одна ручка.
 *
 * Здесь были ещё две: `createApplication` (форма лида, аккаунта не создавала) и
 * `mentorSignup` (регистрация ментора по паролю). Вместе с /join получалось три
 * разных способа «оставить заявку», два из которых заводили аккаунт по-разному.
 * Осталась одна дверь: ФИО, нормализованный телефон, роль — и строка в очереди.
 */
export const publicApi = {
  join: async (body: JoinInput): Promise<JoinResult> => {
    const response = await apiClient.post<JoinResult>('/public/join', body)
    return response.data
  },
}
