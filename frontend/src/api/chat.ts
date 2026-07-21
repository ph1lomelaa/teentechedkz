import apiClient from './client'

export interface Contact {
  id: string
  name: string
  role: string
}

export interface LastMessage {
  body: string
  created_at: string
  sender_id: string
}

export interface ConversationListItem {
  id: string
  type: string
  title: string
  other: Contact | null
  student?: {
    id: string
    full_name: string
    user_id: string
  } | null
  can_write?: boolean
  unread: number
  last_message: LastMessage | null
  updated_at: string
}

export interface ChatMessage {
  id: string
  sender_id: string
  body: string
  created_at: string
  attachments?: Array<{
    id: string
    document_id: string | null
    file_name: string
    file_size: number
    mime_type: string
    created_at: string
  }>
}

export interface NotificationItem {
  id: string
  kind: string
  title: string
  body: string
  link: string
  is_read: boolean
  priority?: 'normal' | 'high'
  created_at: string
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const chatApi = {
  contacts: () => data<Contact[]>(apiClient.get('/portal/contacts')),
  conversations: (params?: { mentor_id?: string | null }) =>
    data<ConversationListItem[]>(apiClient.get('/conversations', { params })),
  start: (userId: string) => data<{ id: string }>(apiClient.post('/conversations', { user_id: userId })),
  staffConversation: (studentId: string) => data<{ id: string }>(apiClient.post(`/students/${studentId}/conversation`)),
  messages: (convId: string) => data<ChatMessage[]>(apiClient.get(`/conversations/${convId}/messages`)),
  send: (convId: string, body: string) => data<ChatMessage>(apiClient.post(`/conversations/${convId}/messages`, { body })),
  createTaskFromMessage: (convId: string, messageId: string, taskText?: string) =>
    data(apiClient.post(`/conversations/${convId}/messages/${messageId}/task`, { task_text: taskText })),
  createNoteFromMessage: (convId: string, messageId: string, title?: string) =>
    data(apiClient.post(`/conversations/${convId}/messages/${messageId}/note`, { title })),
  uploadAttachment: (convId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', 'other')
    return data<ChatMessage>(apiClient.post(`/conversations/${convId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }))
  },
  downloadAttachment: (attachmentId: string) =>
    data<Blob>(apiClient.get(`/message-attachments/${attachmentId}/download`, { responseType: 'blob' })),
  read: (convId: string) => apiClient.post(`/conversations/${convId}/read`),
  notifications: () => data<{ items: NotificationItem[]; unread: number }>(apiClient.get('/notifications')),
  readAllNotifications: () => apiClient.post('/notifications/read-all'),
  readNotification: (notificationId: string) => apiClient.post(`/notifications/${notificationId}/read`),
}
