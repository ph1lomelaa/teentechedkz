import apiClient from './client'

export interface PortalProfile {
  user: { id: string; name: string; email: string; phone: string | null }
  student: {
    id: string
    full_name: string
    phone: string
    city: string | null
    age: number | null
    degree_level: string
    specialty: string | null
    intake_year: number
    intake_season: string | null
  } | null
}

export interface PortalTelegramMessage {
  id: string
  sender_name: string | null
  raw_text: string | null
  message_type: string
  is_me: boolean
  created_at: string
  attachments: Array<{ id: string; file_name: string | null; mime_type: string | null }>
}

export interface PortalTelegram {
  chat: { id: string; title: string | null; status: string } | null
  messages: PortalTelegramMessage[]
}

export const portalApi = {
  profile: () => apiClient.get<PortalProfile>('/portal/profile').then((r) => r.data),
  telegram: () => apiClient.get<PortalTelegram>('/portal/telegram').then((r) => r.data),
  telegramSend: (text: string) => apiClient.post<{ success: boolean; message: string }>('/portal/telegram/send', { text }).then((r) => r.data),

  downloadMeetingsIcal: async () => {
    const response = await apiClient.get('/portal/export/meetings/ical', {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `meetings_${new Date().toISOString().split('T')[0]}.ics`
    link.click()
    URL.revokeObjectURL(url)
  },

  downloadNotesMarkdown: async () => {
    const response = await apiClient.get('/portal/export/notes/markdown', {
      responseType: 'blob',
    })
    const url = URL.createObjectURL(response.data)
    const link = document.createElement('a')
    link.href = url
    link.download = `notes_${new Date().toISOString().split('T')[0]}.md`
    link.click()
    URL.revokeObjectURL(url)
  },
}
