import apiClient from './client'
import {
  TelegramChat,
  TelegramChatInsight,
  TelegramChatSessionHistory,
  TelegramContextApplyResult,
  TelegramContextDraft,
  TelegramGroupInviteLink,
  TelegramGroupReadiness,
  TelegramGroupSetupLink,
  TelegramImportCapabilities,
  TelegramImportResult,
  TelegramMessage,
  TelegramPairingCode,
  TelegramPairingCandidate,
  TelegramParticipant,
} from '../types'

export const telegramApi = {
  listAll: async (
    status?: string,
    scope?: 'all' | 'mine' | 'assigned' | 'unassigned',
    mentorId?: string | null,
  ): Promise<TelegramChat[]> => {
    const response = await apiClient.get<TelegramChat[]>('/telegram-chats/', {
      params: { ...(status ? { status } : {}), ...(scope ? { scope } : {}), ...(mentorId ? { mentor_id: mentorId } : {}) },
    })
    return response.data
  },
  getById: async (chatId: string): Promise<TelegramChat> => {
    const response = await apiClient.get<TelegramChat>(`/telegram-chats/${chatId}`)
    return response.data
  },
  listUnbound: async (): Promise<TelegramChat[]> => {
    const response = await apiClient.get<TelegramChat[]>('/telegram-chats/unbound')
    return response.data
  },
  getForStudent: async (studentId: string): Promise<TelegramChat | null> => {
    const response = await apiClient.get<TelegramChat | null>(`/telegram-chats/student/${studentId}`)
    return response.data
  },
  attach: async (chatId: string, studentId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/attach`, {
      student_id: studentId,
    })
    return response.data
  },
  reassign: async (chatId: string, studentId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/reassign`, {
      student_id: studentId,
    })
    return response.data
  },
  listInsights: async (chatId: string): Promise<TelegramChatInsight[]> => {
    const response = await apiClient.get<TelegramChatInsight[]>(`/telegram-chats/${chatId}/insights`)
    return response.data
  },
  pause: async (chatId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/pause`)
    return response.data
  },
  resume: async (chatId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/resume`)
    return response.data
  },
  close: async (chatId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/close`)
    return response.data
  },
  unbind: async (chatId: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/unbind`)
    return response.data
  },
  createGroupSetupLink: async (studentId: string): Promise<TelegramGroupSetupLink> => {
    const response = await apiClient.post<TelegramGroupSetupLink>('/telegram-chats/group-setup-link', {
      student_id: studentId,
    })
    return response.data
  },
  getPairingCandidate: async (code: string): Promise<TelegramPairingCandidate> => {
    const response = await apiClient.get<TelegramPairingCandidate>(`/telegram-chats/pairing-candidates/${code}`)
    return response.data
  },
  confirmPairingCandidate: async (code: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/pairing-candidates/${code}/confirm`)
    return response.data
  },
  cancelPairingCandidate: async (code: string): Promise<TelegramPairingCandidate> => {
    const response = await apiClient.post<TelegramPairingCandidate>(`/telegram-chats/pairing-candidates/${code}/cancel`)
    return response.data
  },
  getReadiness: async (chatId: string): Promise<TelegramGroupReadiness> => {
    const response = await apiClient.get<TelegramGroupReadiness>(`/telegram-chats/${chatId}/readiness`)
    return response.data
  },
  setTitle: async (chatId: string, title?: string): Promise<TelegramChat> => {
    const response = await apiClient.post<TelegramChat>(`/telegram-chats/${chatId}/set-title`, {
      ...(title ? { title } : {}),
    })
    return response.data
  },
  createGroupInviteLink: async (studentId: string, telegramChatId: number): Promise<TelegramGroupInviteLink> => {
    const response = await apiClient.post<TelegramGroupInviteLink>('/telegram-chats/invite-link', {
      student_id: studentId,
      tg_chat_id: telegramChatId,
    })
    return response.data
  },
  unbindStudentTelegram: async (studentId: string): Promise<{ ok: boolean }> => {
    const response = await apiClient.post<{ ok: boolean }>(`/telegram-chats/students/${studentId}/telegram/unbind`)
    return response.data
  },
  listMessages: async (
    chatId: string,
    params?: { q?: string; limit?: number; before_id?: string },
  ): Promise<TelegramMessage[]> => {
    const response = await apiClient.get<TelegramMessage[]>(`/telegram-chats/${chatId}/messages`, { params })
    return response.data
  },
  sendMessage: async (chatId: string, text: string): Promise<TelegramMessage> => {
    const response = await apiClient.post<TelegramMessage>(`/telegram-chats/${chatId}/messages`, { text })
    return response.data
  },
  listParticipants: async (chatId: string): Promise<TelegramParticipant[]> => {
    const response = await apiClient.get<TelegramParticipant[]>(`/telegram-chats/${chatId}/participants`)
    return response.data
  },
  identifySelf: async (chatId: string, telegramUserId: number): Promise<TelegramParticipant> => {
    const response = await apiClient.post<TelegramParticipant>(
      `/telegram-chats/${chatId}/participants/${telegramUserId}/identify-self`,
    )
    return response.data
  },
  setParticipantRole: async (
    chatId: string,
    telegramUserId: number,
    role: 'mentor' | 'student' | 'unknown',
  ): Promise<TelegramParticipant> => {
    const response = await apiClient.post<TelegramParticipant>(
      `/telegram-chats/${chatId}/participants/${telegramUserId}/set-role`,
      { role },
    )
    return response.data
  },
  createTaskFromMessage: async (chatId: string, messageId: string, taskText?: string) => {
    const response = await apiClient.post(`/telegram-chats/${chatId}/messages/${messageId}/task`, {
      task_text: taskText,
    })
    return response.data
  },
  createNoteFromMessage: async (chatId: string, messageId: string, title?: string) => {
    const response = await apiClient.post(`/telegram-chats/${chatId}/messages/${messageId}/note`, { title })
    return response.data
  },
  listSessions: async (chatId: string): Promise<TelegramChatSessionHistory[]> => {
    const response = await apiClient.get<TelegramChatSessionHistory[]>(`/telegram-chats/${chatId}/sessions`)
    return response.data
  },
  importJson: async (chatId: string, file: File): Promise<TelegramImportResult> => {
    const form = new FormData()
    form.append('file', file)
    const response = await apiClient.post<TelegramImportResult>(`/telegram-chats/${chatId}/import-json`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  importCapabilities: async (chatId: string): Promise<TelegramImportCapabilities> => {
    const response = await apiClient.get<TelegramImportCapabilities>(`/telegram-chats/${chatId}/import-capabilities`)
    return response.data
  },
  createContextDraft: async (
    chatId: string,
    params: { limit?: number; q?: string } = {},
  ): Promise<TelegramContextDraft> => {
    const response = await apiClient.post<TelegramContextDraft>(`/telegram-chats/${chatId}/context-draft`, params)
    return response.data
  },
  applyContextDraft: async (chatId: string, data: TelegramContextDraft): Promise<TelegramContextApplyResult> => {
    const response = await apiClient.post<TelegramContextApplyResult>(
      `/telegram-chats/${chatId}/context-draft/apply`,
      data,
    )
    return response.data
  },
  downloadAttachment: async (attachmentId: string): Promise<Blob> => {
    const response = await apiClient.get(`/telegram-chats/attachments/${attachmentId}/download`, {
      responseType: 'blob',
    })
    return response.data
  },
  createPairingCode: async (studentId: string): Promise<TelegramPairingCode> => {
    const response = await apiClient.post<TelegramPairingCode>('/telegram-chats/pairing-code', {
      student_id: studentId,
    })
    return response.data
  },
}
