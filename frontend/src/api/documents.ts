import apiClient from './client'
import { Document, DocType } from '../types'

export const documentsApi = {
  upload: async (studentId: string, file: File, docType: DocType): Promise<Document> => {
    const form = new FormData()
    form.append('file', file)
    form.append('doc_type', docType)
    const response = await apiClient.post<Document>(`/documents/student/${studentId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  verify: async (docId: string): Promise<Document> => {
    const response = await apiClient.patch<Document>(`/documents/${docId}/verify`)
    return response.data
  },
  download: async (docId: string): Promise<Blob> => {
    const response = await apiClient.get(`/documents/${docId}/download`, {
      responseType: 'blob',
    }) as any
    return response.data
  },
  delete: async (docId: string): Promise<{ ok: true }> => {
    const response = await apiClient.delete<{ ok: true }>(`/documents/${docId}`)
    return response.data
  },
  saveFromTelegram: async (attachmentId: string, docType: DocType): Promise<Document> => {
    const form = new FormData()
    form.append('doc_type', docType)
    const response = await apiClient.post<Document>(`/documents/from-telegram/${attachmentId}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },

  setVisibility: async (docId: string, visible: boolean): Promise<Document> => {
    const response = await apiClient.patch<Document>(`/documents/${docId}/visibility`, {
      visible_to_student: visible,
    })
    return response.data
  },
  setType: async (docId: string, docType: DocType): Promise<Document> => {
    const response = await apiClient.patch<Document>(`/documents/${docId}/type`, {
      doc_type: docType,
    })
    return response.data
  },

  // portal (student)
  myDocuments: async (): Promise<Document[]> => {
    const response = await apiClient.get<Document[]>('/documents/portal/mine')
    return response.data
  },
  portalUpload: async (file: File): Promise<Document> => {
    const form = new FormData()
    form.append('file', file)
    const response = await apiClient.post<Document>('/documents/portal/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    return response.data
  },
  portalDownload: async (docId: string): Promise<Blob> => {
    const response = await apiClient.get(`/documents/portal/${docId}/download`, {
      responseType: 'blob',
    }) as any
    return response.data
  },
  portalDelete: async (docId: string): Promise<{ ok: true }> => {
    const response = await apiClient.delete<{ ok: true }>(`/documents/portal/${docId}`)
    return response.data
  },
}
