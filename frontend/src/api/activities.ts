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
  /** Тип опыта для портфолио: выбранный явно или выведенный сервером из kind. */
  experience_type?: ExperienceKey
  /** Тип выбран явно, а не угадан по kind. */
  experience_explicit?: boolean
}
export type ActivityInput = Omit<Activity, 'id' | 'created_at' | 'next_intake' | 'intake_count' | 'review_issues' | 'experience_type' | 'experience_explicit'> & { experience_type: ExperienceKey | null }
/** Типовой шаг активности: срок задаётся «за N дней до дедлайна организатора». */
export interface TemplateStep {
  title: string; description: string; expected_result: string
  priority: 'required' | 'recommended' | 'optional'
  requires_review: boolean; requires_evidence: boolean
  days_before_deadline: number | null; subtasks: string[]
}
export type IntakeInput = Omit<Intake, 'id' | 'activity_id'>
export interface DuplicateMatch { id: string; title: string; publication: Activity['publication']; reason: 'title' | 'source_url' }
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
  result_documents_count?: number
  certificates_count?: number
  result_text?: string | null
  result_review_status?: 'none' | 'pending' | 'approved' | 'returned'
  result_review_comment?: string | null
  result_submitted_at?: string | null
  result_reviewed_at?: string | null
  decline_reason?: string | null

}
export type BoardColumn = 'suggested' | 'planning' | 'in_work' | 'review' | 'done' | 'closed'
export type BoardView = 'all' | 'waiting' | 'due_soon' | 'closed' | 'planning' | 'review' | 'in_work' | 'done'
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
export type ExperienceKey = 'competitions' | 'research' | 'programs' | 'courses' | 'internships' | 'social' | 'other'
export interface ExperienceTile { key: ExperienceKey; label: string; confirmed: number; active: number }
export type PortfolioActionKind = 'fix_step' | 'fix_result' | 'do_step' | 'submit_result' | 'decide' | 'step_waiting' | 'result_waiting' | 'plan_waiting'
export interface PortfolioAction {
  kind: PortfolioActionKind; owner: 'student' | 'mentor'
  participation_id: string; activity_title: string; student_id: string; student_name: string | null
  step_id: string | null; step_title: string | null; due_date: string | null; overdue: boolean
}
export interface PortfolioCounts { active: number; suggested: number; confirmed: number; waiting_mentor: number; waiting_student: number; overdue: number }
export interface PortfolioFocus { text: string; updated_at: string; updated_by_name: string | null }
export interface NextDeadline { participation_id: string; title: string; date: string }
export interface PortfolioSummary {
  focus: PortfolioFocus | null; counts: PortfolioCounts; experience: ExperienceTile[]
  next_deadline: NextDeadline | null
  /** Ход ученика: одно самое срочное действие на участие. */
  actions: PortfolioAction[]
  /** Всё, что ждёт ментора. */
  mentor_actions: PortfolioAction[]
}
export interface StudentOverviewRow {
  student_id: string; name: string; focus_set: boolean; counts: PortfolioCounts
  experience_confirmed: ExperienceKey[]; next_deadline: NextDeadline | null
}
export const activitiesApi = {
  createFull: async (body: { activity: ActivityInput; intake: IntakeInput | null; steps: TemplateStep[] }) => (await apiClient.post<Activity>('/activities/full', body)).data,
  template: async (id: string) => (await apiClient.get<TemplateStep[]>(`/activities/${id}/step-template`)).data,
  saveTemplate: async (id: string, steps: TemplateStep[]) => (await apiClient.put<TemplateStep[]>(`/activities/${id}/step-template`, { steps })).data,
  duplicates: async (params: { title: string; source_url: string; exclude?: string }) => (await apiClient.get<DuplicateMatch[]>('/activities/staff/duplicates', { params })).data,
  duplicate: async (id: string) => (await apiClient.post<Activity>(`/activities/${id}/duplicate`)).data,
  nextSeason: async (id: string, intakeId: string) => (await apiClient.post<Intake>(`/activities/${id}/intakes/${intakeId}/next-season`)).data,
  summary: async (studentId?: string) => (await apiClient.get<PortfolioSummary>(studentId ? `/activities/students/${studentId}/portfolio-summary` : '/activities/my/portfolio-summary')).data,
  setFocus: async (studentId: string, text: string) => (await apiClient.put<PortfolioFocus | null>(`/activities/students/${studentId}/portfolio-focus`, { text })).data,
  studentsOverview: async (params: { mentor_id?: string; q?: string }) => (await apiClient.get<StudentOverviewRow[]>('/activities/staff/students-overview', { params })).data,
  participation: async (id: string) => (await apiClient.get<Participation>(`/activities/participations/${id}`)).data,
  assign: async (body: { intake_id: string; request_key: string; decision: 'suggested' | 'selected'; recommendation_note: string | null; recipients: Array<{ student_id: string; personal_deadline: string | null; steps: import('./learnerTasks').StepInput[] }> }) =>
    (await apiClient.post<{ results: Array<{ student_id: string; status: 'created' | 'existing' | 'error'; participation_id?: string; message?: string }> }>('/activities/assignments', body)).data,
  submitResult: async (id: string, text: string) => apiClient.post(`/activities/participations/${id}/result`, { text }),
  reviewResult: async (id: string, action: 'approve' | 'return', comment: string) => apiClient.post(`/activities/participations/${id}/result/review`, { action, comment }),
  reorderSteps: async (id: string, task_ids: string[]) => apiClient.put(`/activities/participations/${id}/step-order`, { task_ids }),
  resume: async (id: string) => apiClient.post(`/activities/participations/${id}/resume`),

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
  staffMentors: async () => (await apiClient.get<Array<{ id: string; name: string }>>('/activities/staff/mentors')).data,
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
  editPlan: async (id: string, body: { goal?: string | null; decision?: string; mentor_id?: string | null; status?: string; recommendation_note?: string | null; personal_deadline?: string | null; decline_reason?: string | null }, own: boolean) =>
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
