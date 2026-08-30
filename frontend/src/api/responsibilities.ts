import apiClient from './client'
import { UserRole } from '../types'

/**
 * Зоны ответственности: кто ведёт какой участок у конкретного ученика.
 *
 * Отвечает на вопрос «кто ведёт встречи именно у него» — роль отвечает на
 * другой вопрос, «кому вообще можно». Ответственность ничего не запрещает:
 * она вешает табличку с именем, а дверь открывает право (`can()`).
 */
export type ResponsibilityArea =
  | 'meetings'
  | 'telegram'
  | 'notes'
  | 'tasks'
  | 'roadmap'
  | 'documents'
  | 'portfolio'
  | 'applications'
  | 'questionnaires'
  | 'finance'

/** Подписи и порядок задаёт сервер (AREA_ORDER); здесь только перевод. */
export const AREA_LABELS: Record<ResponsibilityArea, string> = {
  meetings: 'Встречи',
  telegram: 'Telegram и переписка',
  notes: 'Конспекты и заметки',
  tasks: 'Задачи ученику',
  roadmap: 'Roadmap',
  documents: 'Документы',
  portfolio: 'Портфолио',
  applications: 'Заявки в вузы',
  questionnaires: 'Анкеты',
  finance: 'Договор и платежи',
}

export interface ResponsibilityCell {
  area: ResponsibilityArea
  user_id: string | null
  user_name: string | null
  user_role: UserRole | null
  assigned_at: string | null
  note: string | null
}

export interface ResponsibilityCoverage {
  total: number
  covered: number
  covered_areas: ResponsibilityArea[]
  /** Зоны без ответственного — то, ради чего всё и затевалось. */
  missing_areas: ResponsibilityArea[]
  is_complete: boolean
}

export interface StudentResponsibilities {
  student_id: string
  areas: ResponsibilityCell[]
  coverage: ResponsibilityCoverage
}

export interface MyResponsibilities {
  areas: Array<{
    area: ResponsibilityArea
    students: Array<{ student_id: string; student_name: string | null }>
  }>
  total_students: number
}

export interface OverviewRow {
  student_id: string
  student_name: string
  areas: Partial<Record<ResponsibilityArea, ResponsibilityCell>>
  coverage: ResponsibilityCoverage
}

export interface ResponsibilitiesOverview {
  students: OverviewRow[]
  areas: ResponsibilityArea[]
}

export const responsibilitiesApi = {
  forStudent: async (studentId: string): Promise<StudentResponsibilities> => {
    const response = await apiClient.get<StudentResponsibilities>(`/responsibilities/students/${studentId}`)
    return response.data
  },

  assign: async (
    studentId: string,
    area: ResponsibilityArea,
    userId: string,
    note?: string,
  ): Promise<{ coverage: ResponsibilityCoverage }> => {
    const response = await apiClient.put<{ coverage: ResponsibilityCoverage }>(
      `/responsibilities/students/${studentId}/${area}`,
      { user_id: userId, note: note || null },
    )
    return response.data
  },

  clear: async (studentId: string, area: ResponsibilityArea): Promise<{ coverage: ResponsibilityCoverage }> => {
    const response = await apiClient.delete<{ coverage: ResponsibilityCoverage }>(
      `/responsibilities/students/${studentId}/${area}`,
    )
    return response.data
  },

  mine: async (): Promise<MyResponsibilities> => {
    const response = await apiClient.get<MyResponsibilities>('/responsibilities/mine')
    return response.data
  },

  overview: async (params?: {
    only_incomplete?: boolean
    user_id?: string
  }): Promise<ResponsibilitiesOverview> => {
    const response = await apiClient.get<ResponsibilitiesOverview>('/responsibilities/overview', { params })
    return response.data
  },
}
