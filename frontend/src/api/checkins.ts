import apiClient from './client'

export type CheckinStatus = 'on_time' | 'late' | 'missed'

export interface Checkin {
  id: string
  user_id: string
  checkin_date: string
  status: CheckinStatus
  checked_in_at: string | null
  note: string | null
  user_name?: string
  user_role?: string
}

export interface CheckinWindow {
  hour: number
  minute: number
  grace_minutes: number
  timezone: string
}

export interface CheckinToday {
  date: string
  /** Обязателен ли чекин этому пользователю сегодня (роль + рабочий день). */
  required: boolean
  checkin: Checkin | null
  window: CheckinWindow
}

export interface CheckinStaffRow {
  user_id: string
  user_name: string | null
  user_role: string | null
}

export interface CheckinSummaryRow extends CheckinStaffRow {
  on_time: number
  late: number
  missed: number
}

export const checkinsApi = {
  today: async (): Promise<CheckinToday> => {
    const response = await apiClient.get<CheckinToday>('/checkins/me/today')
    return response.data
  },
  checkIn: async (note?: string): Promise<Checkin> => {
    const response = await apiClient.post<Checkin>('/checkins/me', note ? { note } : {})
    return response.data
  },
  list: async (params?: {
    date_from?: string
    date_to?: string
    user_id?: string
    days?: number
  }): Promise<{
    date_from: string
    date_to: string
    items: Checkin[]
    staff: CheckinStaffRow[]
    window: CheckinWindow
  }> => {
    const response = await apiClient.get('/checkins', { params })
    return response.data
  },
  summary: async (days = 30): Promise<{
    date_from: string
    date_to: string
    items: CheckinSummaryRow[]
  }> => {
    const response = await apiClient.get('/checkins/summary', { params: { days } })
    return response.data
  },
}
