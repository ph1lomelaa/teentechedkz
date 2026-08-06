import apiClient from './client'

export type AgreementAudience = 'mentor' | 'student' | 'mzk' | 'admin'
export type AgreementStatus = 'draft' | 'published' | 'archived'

export interface Agreement {
  id: string
  title: string
  version: number
  audience: AgreementAudience
  status: AgreementStatus
  body_markdown: string | null
  file_name: string | null
  country_name: string | null
  is_active: boolean
  published_at: string | null
  created_at: string
  signed?: boolean
  signatures_count?: number
}

export interface AgreementSigner {
  user_id: string
  full_name: string
  email: string | null
  role: string | null
  signed_at: string
  agreement_version: number
  /** Подписано до повышения версии — документ с тех пор изменился. */
  outdated: boolean
}

export interface AgreementPendingSigner {
  user_id: string
  full_name: string
  email: string | null
  role: string | null
}

export const agreementsApi = {
  pending: async (): Promise<{ items: Agreement[] }> => {
    const response = await apiClient.get<{ items: Agreement[] }>('/agreements/pending')
    return response.data
  },
  list: async (audience?: AgreementAudience): Promise<{ items: Agreement[] }> => {
    const response = await apiClient.get<{ items: Agreement[] }>('/agreements', {
      params: audience ? { audience } : undefined,
    })
    return response.data
  },
  create: async (data: {
    title: string
    audience: AgreementAudience
    body_markdown?: string
    country_name?: string
    file?: File
  }): Promise<Agreement> => {
    const form = new FormData()
    form.append('title', data.title)
    form.append('audience', data.audience)
    if (data.body_markdown) form.append('body_markdown', data.body_markdown)
    if (data.country_name) form.append('country_name', data.country_name)
    if (data.file) form.append('file', data.file)
    const response = await apiClient.post<Agreement>('/agreements', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  /** Правка. У опубликованного изменение содержания поднимает version —
   *  подписи прежней редакции становятся неактуальными, нужна переподпись. */
  update: async (
    id: string,
    data: { title?: string; body_markdown?: string; country_name?: string; file?: File }
  ): Promise<Agreement> => {
    const form = new FormData()
    if (data.title !== undefined) form.append('title', data.title)
    if (data.body_markdown !== undefined) form.append('body_markdown', data.body_markdown)
    if (data.country_name !== undefined) form.append('country_name', data.country_name)
    if (data.file) form.append('file', data.file)
    const response = await apiClient.patch<Agreement>(`/agreements/${id}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  publish: async (id: string): Promise<Agreement> => {
    const response = await apiClient.patch<Agreement>(`/agreements/${id}/publish`)
    return response.data
  },
  archive: async (id: string): Promise<Agreement> => {
    const response = await apiClient.patch<Agreement>(`/agreements/${id}/archive`)
    return response.data
  },
  sign: async (id: string, data: { full_name_typed: string; checkbox_acknowledged: boolean }): Promise<{ message: string }> => {
    const response = await apiClient.post<{ message: string }>(`/agreements/${id}/sign`, data)
    return response.data
  },
  signatures: async (id: string): Promise<{
    signed: AgreementSigner[]
    pending: AgreementPendingSigner[]
    agreement_version: number
  }> => {
    const response = await apiClient.get(`/agreements/${id}/signatures`)
    return response.data
  },
  download: async (id: string): Promise<Blob> => {
    const response = await apiClient.get(`/agreements/${id}/download`, {
      responseType: 'blob',
    }) as any
    return response.data
  },
  preview: async (id: string): Promise<{ mode: 'pdf' | 'text'; file_name: string | null; mime_type: string; text?: string }> => {
    const response = await apiClient.get(`/agreements/${id}/preview`)
    return response.data
  },
}
