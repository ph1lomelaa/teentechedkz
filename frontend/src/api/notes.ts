import apiClient from './client'
import {
  NoteSession,
  NoteSessionAudioChunk,
  NoteSessionDetail,
  NoteSessionDraft,
  NoteSessionReconcileResult,
  NoteSessionStatus,
  NoteTranscript,
  StudentNote,
  StudentNoteStatus,
} from '../types'

export interface StudentNoteCreatePayload {
  student_id?: string | null
  title: string
  source_text: string
  summary_markdown?: string
  suggested_changes?: Record<string, unknown>
}

export interface StudentNoteReviewPayload {
  action: 'approve' | 'reject'
  summary_markdown?: string
  suggested_changes?: Record<string, unknown>
}

export interface NoteSessionCreatePayload {
  student_id?: string | null
  title?: string
  source?: string
}

export interface NoteTranscriptCreatePayload {
  text: string
  timestamp?: string
  speaker?: string | null
  client_segment_id?: string | null
}

export interface StudentNoteDiff {
  note_id: string
  student_name?: string | null
  student_id?: string | null
  snapshot: Record<string, unknown>
  suggested_changes: Record<string, unknown>
  preview: Array<{
    field: string
    old_value: unknown
    new_value: unknown
  }>
  diff: Array<{
    field: string
    old_value: unknown
    new_value: unknown
  }>
}

export const notesApi = {
  listSessions: async (params?: { student_id?: string; status?: NoteSessionStatus }): Promise<NoteSession[]> => {
    const response = await apiClient.get<NoteSession[]>('/note-sessions', { params })
    return response.data
  },
  getSession: async (id: string): Promise<NoteSessionDetail> => {
    const response = await apiClient.get<NoteSessionDetail>(`/note-sessions/${id}`)
    return response.data
  },
  createSession: async (data: NoteSessionCreatePayload): Promise<NoteSession> => {
    const response = await apiClient.post<NoteSession>('/note-sessions', data)
    return response.data
  },
  addTranscript: async (sessionId: string, data: NoteTranscriptCreatePayload): Promise<NoteTranscript> => {
    const response = await apiClient.post<NoteTranscript>(`/note-sessions/${sessionId}/transcripts`, data)
    return response.data
  },
  heartbeatSession: async (sessionId: string): Promise<void> => {
    await apiClient.post(`/note-sessions/${sessionId}/heartbeat`)
  },
  endSession: async (sessionId: string): Promise<NoteSession> => {
    const response = await apiClient.patch<NoteSession>(`/note-sessions/${sessionId}/end`)
    return response.data
  },
  draftSession: async (sessionId: string): Promise<NoteSessionDraft> => {
    const response = await apiClient.post<NoteSessionDraft>(`/note-sessions/${sessionId}/draft`)
    return response.data
  },
  finalizeSession: async (sessionId: string): Promise<{ session: NoteSession; note: StudentNote }> => {
    const response = await apiClient.post<{ session: NoteSession; note: StudentNote }>(
      `/note-sessions/${sessionId}/finalize`,
    )
    return response.data
  },
  uploadAudioChunk: async (sessionId: string, blob: Blob, chunkIndex: number): Promise<NoteSessionAudioChunk> => {
    const form = new FormData()
    form.append('chunk_index', String(chunkIndex))
    form.append('file', blob, `chunk_${chunkIndex}.webm`)
    const response = await apiClient.post<NoteSessionAudioChunk>(
      `/note-sessions/${sessionId}/audio-chunks`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    )
    return response.data
  },
  listAudioChunks: async (sessionId: string): Promise<NoteSessionAudioChunk[]> => {
    const response = await apiClient.get<NoteSessionAudioChunk[]>(`/note-sessions/${sessionId}/audio-chunks`)
    return response.data
  },
  reconcileAudio: async (sessionId: string): Promise<NoteSessionReconcileResult> => {
    const response = await apiClient.post<NoteSessionReconcileResult>(`/note-sessions/${sessionId}/reconcile-audio`)
    return response.data
  },
  list: async (params?: { student_id?: string; status?: StudentNoteStatus; scope?: 'all' | 'mine' }): Promise<StudentNote[]> => {
    const response = await apiClient.get<StudentNote[]>('/notes', { params })
    return response.data
  },
  get: async (id: string): Promise<StudentNote> => {
    const response = await apiClient.get<StudentNote>(`/notes/${id}`)
    return response.data
  },
  create: async (data: StudentNoteCreatePayload): Promise<StudentNote> => {
    const response = await apiClient.post<StudentNote>('/notes', data)
    return response.data
  },
  review: async (id: string, data: StudentNoteReviewPayload): Promise<StudentNote> => {
    const response = await apiClient.post<StudentNote>(`/notes/${id}/review`, data)
    return response.data
  },
  diff: async (id: string): Promise<StudentNoteDiff> => {
    const response = await apiClient.get<StudentNoteDiff>(`/notes/${id}/diff`)
    return response.data
  },
}
