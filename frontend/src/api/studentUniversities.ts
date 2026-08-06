import apiClient from './client'
import { University } from './universities'

export interface ShortlistItem {
  id: string
  student_id: string
  university_id: string
  note: string
  priority: number | null
  added_by_user_id: string | null
  /** 'student' when the student picked it themselves, otherwise the staff role. */
  added_by_role: string
  added_by_name: string | null
  created_at: string
  university: University
}

export interface ShortlistCreate {
  university_id: string
  /** Ignored for students (always themselves); required from staff. */
  student_id?: string
  note?: string
  priority?: number | null
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const shortlistApi = {
  listForStudent: (studentId: string) =>
    data<ShortlistItem[]>(apiClient.get(`/students/${studentId}/shortlist`)),
  listMine: () => data<ShortlistItem[]>(apiClient.get('/portal/shortlist')),
  add: (body: ShortlistCreate) => data<ShortlistItem>(apiClient.post('/student-universities', body)),
  update: (id: string, body: { note?: string; priority?: number | null }) =>
    data<ShortlistItem>(apiClient.patch(`/student-universities/${id}`, body)),
  remove: (id: string) => apiClient.delete(`/student-universities/${id}`),
}
