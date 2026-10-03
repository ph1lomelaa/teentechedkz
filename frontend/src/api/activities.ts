import apiClient from './client'

export interface Activity {
  id: string; title: string; direction: string | null; kind: string | null
  organizer: string | null; country: string | null; description: string | null
  eligibility: string | null; assignment: string | null; source_url: string | null
  publication: 'draft' | 'published' | 'archived'; created_at: string
  /** Когда команда сверяла условия с сайтом организатора; null — не сверяли. */
  conditions_checked_at?: string | null
  /** Ближайший действующий набор — только в списке каталога. */
  next_intake?: Intake | null
  /** Всего наборов: next_intake=null при intake_count>0 значит «набор закрыт». */
  intake_count?: number
  /** Чего не хватает записи (только для сотрудников). */
  review_issues?: string[]
}
export type ActivityInput = Omit<Activity, 'id' | 'created_at' | 'next_intake' | 'intake_count' | 'review_issues'>
export interface Intake {
  id: string; activity_id: string; label: string
  mode: 'fixed' | 'rolling' | 'self_paced' | 'unknown'; deadline: string | null
  dates_text: string | null; format: string | null
  cost_state: 'free' | 'paid' | 'unknown'; cost_text: string | null
}
export interface StepsSummary {
  segment_states?: Array<'done' | 'pending' | 'todo'>
  total: number; done: number; pending: number; returned: number; overdue: number
  next: { id: string; title: string; due_date: string | null; state: 'returned' | 'overdue' | 'todo' | 'pending'; submitted_at?: string | null } | null
}
export interface Participation {
  id: string; student_id: string; intake_id: string; goal: string | null
  decision: 'suggested' | 'selected' | 'not_interested'
  status: 'not_started' | 'in_progress' | 'submitted' | 'completed' | 'cancelled'
  mentor_id?: string | null; mentor_name?: string | null
  student_name?: string | null; selection_source?: 'student' | 'staff' | 'unknown'
  selected_by_id?: string | null; selected_by_name?: string | null
  recommendation_note?: string | null; personal_deadline?: string | null
  created_at?: string
  activity: Activity; intake: Intake
  steps?: StepsSummary
}
export type BoardColumn = 'suggested' | 'planning' | 'in_work' | 'review' | 'done' | 'closed'
export type BoardView = 'all' | 'waiting' | 'due_soon' | 'closed'
export interface BoardItem extends Participation {
  column: BoardColumn; due: string | null; due_soon: boolean; needs_reminder: boolean
}
export interface BoardResponse {
  items: BoardItem[]; total: number; offset: number; limit: number
  counts: Record<BoardView, number>; columns: Record<BoardColumn, number>
}
export interface RecommendInput {
  intake_id: string; decision: 'suggested' | 'selected'
  recommendation_note?: string | null; personal_deadline?: string | null
}
export const activitiesApi = {
  list: async () => {
    const all: Activity[] = []
    for (let offset = 0; ; offset += 100) {
      const { data } = await apiClient.get<Activity[]>('/activities', { params: { offset, limit: 100 } })
      all.push(...data)
      if (data.length < 100) return all
    }
  },
  overview: async (params: Record<string, string | number>) => (await apiClient.get<BoardResponse>('/activities/staff/participations', { params })).data,
  /** Ученики, которым сотрудник может рекомендовать (только свои — для ментора). */
  staffStudents: async () => (await apiClient.get<Array<{ id: string; name: string }>>('/activities/staff/students')).data,
  get: async (id: string) => (await apiClient.get<Activity>(`/activities/${id}`)).data,
  recommend: async (studentId: string, body: RecommendInput) => (await apiClient.post<Participation>(`/activities/students/${studentId}/participations`, body)).data,
  updateIntake: async (activityId: string, intakeId: string, body: Omit<Intake, 'id' | 'activity_id'>) =>
    (await apiClient.put<Intake>(`/activities/${activityId}/intakes/${intakeId}`, body)).data,
  catalogRows: async () => (await apiClient.get<Array<{ activity: Activity; intake: Intake | null }>>('/activities/catalog/rows')).data,
  save: async (body: ActivityInput, id?: string): Promise<Activity> =>
    (id ? await apiClient.put<Activity>(`/activities/${id}`, body) : await apiClient.post<Activity>('/activities', body)).data,
  addIntake: async (id: string, body: Omit<Intake, 'id' | 'activity_id'>): Promise<Intake> =>
    (await apiClient.post<Intake>(`/activities/${id}/intakes`, body)).data,
  intakes: async (id: string) => (await apiClient.get<Intake[]>(`/activities/${id}/intakes`)).data,
  plan: async (studentId?: string) => (await apiClient.get<Participation[]>(studentId ? `/activities/students/${studentId}/participations` : '/activities/my/participations')).data,
  tasks: async (id: string) => (await apiClient.get<import('./roadmap').RoadmapTask[]>(`/activities/participations/${id}/tasks`)).data,
  mentors: async (id: string) => (await apiClient.get<Array<{ id: string; name: string }>>(`/activities/participations/${id}/mentors`)).data,
  editPlan: async (id: string, body: { goal?: string | null; decision?: string; mentor_id?: string | null; status?: string; recommendation_note?: string | null; personal_deadline?: string | null }, own: boolean) =>
    (await apiClient.patch(own ? `/activities/my/participations/${id}` : `/activities/participations/${id}`, body)).data,
  linkTask: async (id: string, taskId: string) => (await apiClient.post(`/activities/participations/${id}/tasks`, { task_id: taskId })).data,
  select: async (intakeId: string, studentId?: string, decision: 'suggested' | 'selected' = 'suggested') => (await apiClient.post(studentId ? `/activities/students/${studentId}/participations` : '/activities/my/participations', { intake_id: intakeId, ...(studentId ? { decision } : {}) })).data,
}


export interface ImportRow {
  row: number; key: string; activity: Omit<Activity, 'id' | 'created_at'> | null
  dates_text: string | null; warnings: string[]; errors: string[]
  source: { filename: string; sheet: string; row: number; raw: Record<string, string> }
}
export interface ImportPreview { rows: ImportRow[]; skipped: number }
export const activityImportApi = {
  preview: async (file: File): Promise<ImportPreview> => {
    const data = new FormData(); data.append('file', file)
    return (await apiClient.post<ImportPreview>('/activity-import/preview', data, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
  commit: async (file: File, rows: number[]): Promise<{ imported_rows: number[]; skipped_rows: Array<{ row: number; errors: string[] }> }> => {
    const data = new FormData(); data.append('file', file); data.append('selected_rows', JSON.stringify(rows))
    return (await apiClient.post('/activity-import/commit', data, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
}
