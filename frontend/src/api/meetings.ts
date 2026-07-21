import apiClient from './client'
import { StudentNote } from '@/types'

export type MeetingStatus = 'scheduled' | 'completed' | 'cancelled'
export type MeetingType = 'intro' | 'regular' | 'documents' | 'roadmap' | 'application' | 'finance' | 'other'

export interface Meeting {
  id: string
  student_id: string
  service_id?: string | null
  mentor_id: string | null
  title: string
  meeting_type: MeetingType
  description: string
  outcome: string
  starts_at: string
  ends_at: string
  meeting_link: string
  recording_url: string
  transcript_url: string
  status: MeetingStatus
  note_session_id?: string | null
  created_at: string
}

export interface MeetingCreateInput {
  student_id: string
  service_id?: string | null
  title: string
  meeting_type?: MeetingType
  description?: string
  outcome?: string
  starts_at: string
  ends_at: string
  meeting_link?: string
  mentor_id?: string
}

export interface MeetingFollowUpDraft {
  meeting_id: string
  student_id: string
  student_name?: string | null
  message: string
  auto_sent: boolean
}

export interface MeetingFollowUpSendResult {
  meeting_id: string
  student_id: string
  conversation_id: string
  message_id: string
  sent: boolean
  auto_sent: boolean
}

export type MeetingUpdateInput = Partial<{
  title: string
  service_id: string | null
  meeting_type: MeetingType
  description: string
  outcome: string
  starts_at: string
  ends_at: string
  meeting_link: string
  recording_url: string
  transcript_url: string
  status: MeetingStatus
}>

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const meetingsApi = {
  studentMeetings: (studentId: string) =>
    data<Meeting[]>(apiClient.get(`/students/${studentId}/meetings`)),
  myMeetings: () => data<Meeting[]>(apiClient.get('/portal/meetings')),
  create: (body: MeetingCreateInput) => data<Meeting>(apiClient.post('/meetings', body)),
  update: (id: string, body: MeetingUpdateInput) => data<Meeting>(apiClient.patch(`/meetings/${id}`, body)),
  createAiActions: (id: string) => data<StudentNote>(apiClient.post(`/meetings/${id}/ai-actions`)),
  createFollowUpDraft: (id: string) =>
    data<MeetingFollowUpDraft>(apiClient.post(`/meetings/${id}/follow-up-draft`)),
  sendFollowUp: (id: string, message: string) =>
    data<MeetingFollowUpSendResult>(apiClient.post(`/meetings/${id}/follow-up-send`, { message })),
  remove: (id: string) => apiClient.delete(`/meetings/${id}`),
}
