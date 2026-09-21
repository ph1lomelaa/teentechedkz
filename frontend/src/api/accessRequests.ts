import apiClient from './client'

/** Карточка-кандидат из подсказки матчинга. */
export interface SuggestedStudent {
  id: string
  full_name: string
  phone: string
  intake_year: number | null
  /** У карточки ещё нет кабинета. Занятую привязывать нельзя. */
  is_free: boolean
}

/** Похожая карточка из базы. Считается заново при каждом открытии очереди. */
export interface StudentCandidate extends SuggestedStudent {
  reason: 'phone' | 'name'
  reason_label: string
}

export interface AccessRequestItem {
  id: string
  user: { id: string; email: string; name: string; is_active: boolean }
  requested_role: 'student' | 'mentor'
  full_name: string
  phone: string
  city: string | null
  direction: string | null
  /** Все похожие карточки: телефон первым, свободные раньше занятых. */
  candidates: StudentCandidate[]
  suggested_student: SuggestedStudent | null
  confidence: number | null
  method: string | null
  method_label: string | null
  status: string
  created_at: string
}

export interface MyAccessRequest {
  id: string
  requested_role: 'student' | 'mentor'
  full_name: string
  phone: string
  city: string | null
  direction: string | null
  status: string
  created_at: string
}

export interface ApproveResult {
  ok: boolean
  status: string
  /** Временный пароль — только для сотрудника, у которого пароля не было
   *  (вход был лишь через Google). Приходит один раз; показать и передать. */
  temp_password: string | null
}

export interface ApprovedStaff {
  id: string
  name: string
  email: string
  /** Временный пароль — только у тех, у кого пароля не было (вход был через
   *  Google). Показывается один раз: нигде в открытом виде он не хранится. */
  temp_password: string | null
}

export interface BulkApproveStaffResult {
  approved: ApprovedStaff[]
  skipped: { id: string; name?: string; reason: string }[]
}

export interface BulkApproveResult {
  approved: { id: string; name: string; student_id: string }[]

  /** Кого не взяли и почему. Показывать обязательно — молчание читается как
   *  «очередь разобрана», хотя половина осталась. */
  skipped: { id: string; name?: string; reason: string }[]
}

export const accessRequestsApi = {
  list: async (status = 'new'): Promise<{ items: AccessRequestItem[]; total_new: number }> => {
    const response = await apiClient.get('/access-requests', { params: { status_filter: status } })
    return response.data
  },
  count: async (): Promise<{ total: number }> => {
    const response = await apiClient.get('/access-requests/count')
    return response.data
  },
  /** Своя заявка. Единственная ручка очереди, доступная ждущему аккаунту. */
  mine: async (): Promise<MyAccessRequest | null> => {
    const response = await apiClient.get('/access-requests/mine')
    return response.data
  },
  approve: async (id: string, body: { role: string; student_id?: string }): Promise<ApproveResult> => {
    const response = await apiClient.post<ApproveResult>(`/access-requests/${id}/approve`, body)
    return response.data
  },
  reject: async (id: string) => {
    const response = await apiClient.post(`/access-requests/${id}/reject`)
    return response.data
  },
  /** Без `force` сервер отвечает 409 `possible_duplicate`, если в базе есть похожие карточки. */
  createStudent: async (id: string, force = false) => {
    const response = await apiClient.post(`/access-requests/${id}/create-student`, { force })
    return response.data
  },
  bulkApprove: async (ids: string[]): Promise<BulkApproveResult> => {
    const response = await apiClient.post('/access-requests/bulk-approve', { ids })
    return response.data
  },
  /**
   * Одобрить пачку заявок сотрудников. Отдельно от `bulkApprove`: там решение
   * опирается на совпадение телефона с карточкой, здесь проверять нечего и
   * решение целиком человеческое — поэтому и роль задаётся явно.
   */
  bulkApproveStaff: async (
    ids: string[],
    role: 'mentor' | 'mzk_manager',
  ): Promise<BulkApproveStaffResult> => {
    const response = await apiClient.post('/access-requests/bulk-approve-staff', { ids, role })
    return response.data
  },
}
