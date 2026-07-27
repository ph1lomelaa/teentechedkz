import apiClient from './client'
import { DegreeLevel, Document, NoteSession, StudentNote, TelegramContextDraft } from '../types'
import { Meeting } from './meetings'
import type { Roadmap } from './roadmap'

export interface WorkspaceScopeParams {
  mentor_id?: string | null
  scope?: 'all' | 'mine'
}

export interface WorkspaceStudentBrief {
  id: string
  full_name: string
  phone?: string | null
  degree_level: DegreeLevel
  intake_year: number
  city?: string | null
  has_portal_access: boolean
  portal_email?: string | null
}

export interface WorkspaceStudentSummary {
  student: WorkspaceStudentBrief
  primary_mentor: { id: string; name: string } | null
  roadmap: {
    id: string | null
    name: string | null
    country_name: string | null
    country_flag_emoji?: string
    country_flag_url?: string
    year: number | null
    tasks_total: number
    tasks_done: number
    progress: number
  }
  open_roadmap_tasks: number
  open_internal_tasks: number
  next_meeting: {
    id: string
    title: string
    starts_at: string
    meeting_link: string
  } | null
  documents: {
    total: number
    unverified: number
  }
  telegram: {
    linked: boolean
    pending_signals: number
  }
  notes: {
    sessions: number
    ai_drafts: number
  }
  warnings: string[]
}

export interface WorkspaceDashboard {
  stats: {
    students_total: number
    active_work: number
    open_roadmap_tasks: number
    open_internal_tasks: number
    upcoming_meetings: number
    without_roadmap: number
    telegram_signals: number
    documents_total: number
    documents_unverified: number
    ai_drafts: number
  }
  students: WorkspaceStudentSummary[]
  upcoming_meetings: Array<{
    student: WorkspaceStudentBrief
    meeting: NonNullable<WorkspaceStudentSummary['next_meeting']>
  }>
  attention: Array<{
    student: WorkspaceStudentBrief
    kind: string
    count?: number
    progress?: number
  }>
  workload: Array<{
    mentor: { id: string; name: string; role: string }
    students_total: number
    roles: string[]
    open_tasks: number
    upcoming_meetings: number
    telegram_signals: number
    documents_unverified: number
    ai_drafts: number
    health_warnings: number
    load_score: number
  }>
  health_signals: Array<{
    kind: string
    label: string
    count: number
    severity: 'low' | 'medium' | 'high'
  }>
}

export interface WorkspaceRoadmapItem {
  student: WorkspaceStudentBrief
  primary_mentor: { id: string; name: string } | null
  roadmap: WorkspaceStudentSummary['roadmap']
  warnings: string[]
}

export interface WorkspaceFullRoadmapItem {
  student: WorkspaceStudentBrief
  roadmap: Roadmap | null
}

export interface WorkspaceRoadmapTask {
  id: string
  student_id: string
  student_name: string
  roadmap_id: string
  stage_name: string
  stage_position: number
  title: string
  status: 'planned' | 'in_progress' | 'done'
  priority: 'required' | 'recommended' | 'optional'
  audience: 'applicant' | 'coordinator'
  due_date: string | null
  needs_document: boolean
  needs_zoom: boolean
  has_questionnaire: boolean
  questionnaire_url: string | null
  subtasks_total: number
  subtasks_done: number
  position: number
  review_status: 'none' | 'pending' | 'approved' | 'returned'
  completed_at: string | null
  reviewed_at: string | null
  review_comment: string | null
}

export type WorkspaceMeeting = Meeting & {
  student_name: string
}

export type WorkspaceDocument = Document & {
  student_id: string
  student_name: string
  source_message: {
    channel: 'telegram' | 'internal'
    message_id: string
    chat_id: string
  } | null
}

export interface WorkspaceQuestionnaireItem {
  id: string
  roadmap_task_id: string | null
  student_id: string
  student_name: string
  title: string
  status: 'draft' | 'sent' | 'submitted' | 'reviewed'
  question_count: number
  has_response: boolean
  created_at: string
  sent_at: string | null
  submitted_at: string | null
  reviewed_at: string | null
}

export interface WorkspaceNotes {
  sessions: NoteSession[]
  notes: StudentNote[]
  total_sessions: number
  total_notes: number
}

export interface WorkspaceUnifiedMessageAttachment {
  id: string
  kind: 'internal' | 'telegram'
  file_name: string | null
  file_size: number | null
  mime_type: string | null
  can_download: boolean
}

export interface WorkspaceUnifiedMessage {
  id: string
  source: 'internal' | 'telegram'
  source_chat_id: string
  sender_id: string | null
  sender_name: string | null
  sender_role: string
  is_current_user: boolean
  body: string | null
  message_type: string
  created_at: string
  attachments: WorkspaceUnifiedMessageAttachment[]
}

export const workspaceApi = {
  dashboard: async (params?: WorkspaceScopeParams): Promise<WorkspaceDashboard> => {
    const response = await apiClient.get<WorkspaceDashboard>('/workspace/dashboard', { params })
    return response.data
  },
  students: async (params?: WorkspaceScopeParams): Promise<{ items: WorkspaceStudentSummary[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceStudentSummary[]; total: number }>('/workspace/students', { params })
    return response.data
  },
  studentSummary: async (studentId: string): Promise<WorkspaceStudentSummary> => {
    const response = await apiClient.get<WorkspaceStudentSummary>(`/workspace/students/${studentId}/summary`)
    return response.data
  },
  roadmap: async (params?: WorkspaceScopeParams): Promise<{ items: WorkspaceRoadmapItem[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceRoadmapItem[]; total: number }>('/workspace/roadmap', { params })
    return response.data
  },
  fullRoadmaps: async (params?: WorkspaceScopeParams): Promise<{ items: WorkspaceFullRoadmapItem[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceFullRoadmapItem[]; total: number }>('/workspace/roadmaps/full', { params })
    return response.data
  },
  roadmapTasks: async (
    params?: WorkspaceScopeParams & { status?: 'open' | 'done'; review_status?: string },
  ): Promise<{ items: WorkspaceRoadmapTask[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceRoadmapTask[]; total: number }>('/workspace/roadmap-tasks', { params })
    return response.data
  },
  meetings: async (params?: WorkspaceScopeParams): Promise<{ items: WorkspaceMeeting[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceMeeting[]; total: number }>('/workspace/meetings', { params })
    return response.data
  },
  documents: async (params?: WorkspaceScopeParams): Promise<{ items: WorkspaceDocument[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceDocument[]; total: number }>('/workspace/documents', { params })
    return response.data
  },
  notes: async (params?: WorkspaceScopeParams): Promise<WorkspaceNotes> => {
    const response = await apiClient.get<WorkspaceNotes>('/workspace/notes', { params })
    return response.data
  },
  questionnaires: async (
    params?: WorkspaceScopeParams & { status?: 'draft' | 'sent' | 'submitted' | 'reviewed' },
  ): Promise<{ items: WorkspaceQuestionnaireItem[]; total: number }> => {
    const response = await apiClient.get<{ items: WorkspaceQuestionnaireItem[]; total: number }>('/workspace/questionnaires', { params })
    return response.data
  },
  studentMessages: async (
    studentId: string,
    params?: WorkspaceScopeParams & { limit?: number; offset?: number; q?: string },
  ): Promise<{ items: WorkspaceUnifiedMessage[]; total: number; student_id: string; offset: number; next_offset: number | null; has_more: boolean }> => {
    const response = await apiClient.get<{ items: WorkspaceUnifiedMessage[]; total: number; student_id: string; offset: number; next_offset: number | null; has_more: boolean }>(
      `/workspace/students/${studentId}/messages`,
      { params },
    )
    return response.data
  },
  messageUnread: async (params?: WorkspaceScopeParams): Promise<{ items: Record<string, { internal: number; telegram: number; total: number }> }> => {
    const response = await apiClient.get('/workspace/message-unread', { params })
    return response.data
  },
  markMessagesRead: (studentId: string, channel: 'all' | 'internal' | 'telegram') =>
    apiClient.post(`/workspace/students/${studentId}/messages/read`, { channel }),
  createContextDraft: async (studentId: string, body: { limit?: number; q?: string; mentor_id?: string | null }): Promise<TelegramContextDraft> => {
    const response = await apiClient.post(`/workspace/students/${studentId}/context-draft`, body)
    return response.data
  },
  applyContextDraft: async (studentId: string, body: TelegramContextDraft): Promise<{ note_id: string; applied_changes: unknown[]; tasks_created: number }> => {
    const response = await apiClient.post(`/workspace/students/${studentId}/context-draft/apply`, body)
    return response.data
  },
}
