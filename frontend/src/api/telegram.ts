import apiClient from './client'
import {
  TelegramChat,
  TelegramChatInsight,
  TelegramContextApplyResult,
  TelegramContextDraft,
  TelegramMessage,
  TelegramPairingCode,
} from '../types'

export const telegramApi = {
  listAll: async (status?: string, scope?: 'all' | 'mine' | 'unassigned'): Promise<TelegramChat[]> => {
    const response = await apiClient.get<TelegramChat[]>('/telegram-chats/', {
      params: { ...(status ? { status } : {}), ...(scope ? { scope } : {}) },
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
  listMessages: async (chatId: string): Promise<TelegramMessage[]> => {
    const response = await apiClient.get<TelegramMessage[]>(`/telegram-chats/${chatId}/messages`)
    return response.data
  },
  createContextDraft: async (chatId: string, limit = 30): Promise<TelegramContextDraft> => {
    const response = await apiClient.post<TelegramContextDraft>(`/telegram-chats/${chatId}/context-draft`, { limit })
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
