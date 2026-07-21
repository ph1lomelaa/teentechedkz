import apiClient from './client'

export type QuestionnaireStatus = 'draft' | 'sent' | 'submitted' | 'reviewed'
export type QuestionKind = 'text' | 'long_text' | 'choice' | 'multi' | 'bool'

export interface QuestionnaireQuestion {
  id: string
  kind: QuestionKind
  label: string
  help_text: string
  required: boolean
  options: string[]
  position: number
}

export type AnswerValue = string | boolean | string[]

export interface Questionnaire {
  id: string
  roadmap_task_id: string | null
  student_id: string
  title: string
  description: string
  status: QuestionnaireStatus
  source_notion_page_id: string | null
  created_at: string
  sent_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
  questions: QuestionnaireQuestion[]
  answers: Record<string, AnswerValue>
  has_response: boolean
}

export interface QuestionInput {
  kind: QuestionKind
  label: string
  help_text?: string
  required?: boolean
  options?: string[]
}

export interface QuestionnaireTemplateItem {
  id: string
  title: string
  country_name: string | null
  degree: string | null
  step_name: string | null
  question_count: number
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const questionnairesApi = {
  forTask: (taskId: string) =>
    data<Questionnaire | null>(apiClient.get(`/roadmap-tasks/${taskId}/questionnaire`)),
  get: (id: string) => data<Questionnaire>(apiClient.get(`/questionnaires/${id}`)),
  create: (taskId: string, body: { title: string; description?: string; questions?: QuestionInput[] }) =>
    data<Questionnaire>(apiClient.post(`/roadmap-tasks/${taskId}/questionnaire`, body)),
  update: (id: string, body: { title?: string; description?: string }) =>
    data<Questionnaire>(apiClient.patch(`/questionnaires/${id}`, body)),
  putQuestions: (id: string, questions: QuestionInput[]) =>
    data<Questionnaire>(apiClient.put(`/questionnaires/${id}/questions`, { questions })),
  send: (id: string) => data<Questionnaire>(apiClient.post(`/questionnaires/${id}/send`)),
  review: (id: string) => data<Questionnaire>(apiClient.post(`/questionnaires/${id}/review`)),
  respond: (id: string, answers: Record<string, AnswerValue>, submit = true) =>
    data<Questionnaire>(apiClient.post(`/questionnaires/${id}/respond`, { answers, submit })),
  // student
  mine: () => data<Questionnaire[]>(apiClient.get('/portal/questionnaires')),
  // notion-imported templates
  templates: (params?: { q?: string; country?: string }) =>
    data<QuestionnaireTemplateItem[]>(apiClient.get('/questionnaire-templates', { params })),
  applyTemplate: (taskId: string, templateId: string) =>
    data<Questionnaire>(apiClient.post(`/roadmap-tasks/${taskId}/questionnaire/from-template/${templateId}`)),
}

export const QUESTIONNAIRE_STATUS_LABEL: Record<QuestionnaireStatus, string> = {
  draft: 'Черновик',
  sent: 'Отправлена',
  submitted: 'Заполнена',
  reviewed: 'Проверена',
}

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  text: 'Короткий текст',
  long_text: 'Длинный текст',
  choice: 'Один вариант',
  multi: 'Несколько вариантов',
  bool: 'Да / Нет',
}
