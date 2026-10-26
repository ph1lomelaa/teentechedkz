import apiClient from './client'
import type { FlatTask, Priority } from './roadmap'
import type { Document } from '@/types'

export interface StepInput {
  title: string
  description: string
  expected_result: string
  due_date: string | null
  priority: Priority
  requires_review: boolean
  requires_evidence: boolean
  subtasks: string[]
}
// Шаг активности ученик закрывает сам; проверку ментор включает для важных шагов.
// Итог участия проверяется всегда.
export const emptyStep = (): StepInput => ({ title: '', description: '', expected_result: '', due_date: null, priority: 'required', requires_review: false, requires_evidence: false, subtasks: [] })
export const learnerTasksApi = {
  create: async (body: Partial<StepInput> & { title: string; student_id: string; creation_key?: string; stage_id?: string | null; activity_participation_id?: string; needs_document?: boolean; needs_zoom?: boolean; audience?: string }) => (await apiClient.post<FlatTask>('/learner-tasks', body)).data,
  get: async (id: string) => (await apiClient.get<FlatTask>(`/learner-tasks/${id}`)).data,
  update: async (id: string, body: Partial<Omit<StepInput, 'subtasks'>> & { position?: number }) => (await apiClient.patch<FlatTask>(`/learner-tasks/${id}`, body)).data,
  remove: async (id: string) => apiClient.delete(`/learner-tasks/${id}`),
  start: async (id: string) => (await apiClient.post<FlatTask>(`/learner-tasks/${id}/start`)).data,
  complete: async (id: string, result_text: string) => (await apiClient.post<FlatTask>(`/learner-tasks/${id}/complete`, { result_text })).data,
  review: async (id: string, action: 'approve' | 'return', comment: string) => (await apiClient.post<FlatTask>(`/learner-tasks/${id}/review`, { action, comment })).data,
  checklist: async (id: string, subId: string, done: boolean) => apiClient.patch(`/learner-tasks/${id}/checklist/${subId}?done=${done}`),
}
export type DocumentTarget = { task_id: string; participation_id?: never } | { participation_id: string; task_id?: never }
export const portfolioDocumentsApi = {
  list: async (target: DocumentTarget, available = false) => (await apiClient.get<Document[]>('/portfolio-documents', { params: { ...target, available } })).data,
  link: async (target: DocumentTarget, document_id: string) => (await apiClient.post<Document>('/portfolio-documents/link', { ...target, document_id })).data,
  upload: async (target: DocumentTarget, file: File, doc_type = 'other') => {
    const body = new FormData()
    Object.entries(target).forEach(([key, value]) => body.append(key, value))
    body.append('file', file); body.append('doc_type', doc_type)
    return (await apiClient.post<Document>('/portfolio-documents/upload', body, { headers: { 'Content-Type': 'multipart/form-data' } })).data
  },
}
