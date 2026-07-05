import apiClient from './client'
import {
  Contract,
  Application,
  Service,
  Payment,
  Guardian,
  StudentTask,
  PortfolioProgress,
  Country,
  FinanceSummary,
  MentorPayout,
  ClientBalance,
  HistoryEntry,
  ConfidentialNote,
  User,
  MentorAssignment,
  NoteVisibility,
  InsightWithDiff,
} from '../types'

export * from './client'
export * from './auth'
export * from './students'
export * from './notes'
export * from './integrations'
export * from './sync'
export * from './telegram'

type ContractCreatePayload = Partial<Contract> & { student_id: string }
type ApplicationCreatePayload = Partial<Application> & { student_id: string }
type ServiceCreatePayload = Partial<Service> & { student_id: string }
type GuardianCreatePayload = Partial<Guardian> & {
  student_id: string
  full_name: string
  phone: string
}
type ConfidentialNoteCreatePayload = {
  student_id: string
  note_text: string
  visible_to_role: NoteVisibility
}

export const contractsApi = {
  list: async (params?: Record<string, unknown>): Promise<Contract[]> => {
    const response = await apiClient.get<Contract[]>('/contracts', { params })
    return response.data
  },
  create: async (data: ContractCreatePayload): Promise<Contract> => {
    const response = await apiClient.post<Contract>('/contracts', data)
    return response.data
  },
  update: async (id: string, data: Partial<Contract>): Promise<Contract> => {
    const response = await apiClient.patch<Contract>(`/contracts/${id}`, data)
    return response.data
  },
}

export const applicationsApi = {
  list: async (params?: Record<string, unknown>): Promise<Application[]> => {
    const response = await apiClient.get<Application[]>('/applications', {
      params,
    })
    return response.data
  },
  create: async (data: ApplicationCreatePayload): Promise<Application> => {
    const response = await apiClient.post<Application>('/applications', data)
    return response.data
  },
  update: async (
    id: string,
    data: Partial<Application>
  ): Promise<Application> => {
    const response = await apiClient.patch<Application>(
      `/applications/${id}`,
      data
    )
    return response.data
  },
}

export const servicesApi = {
  list: async (params?: Record<string, unknown>): Promise<Service[]> => {
    const response = await apiClient.get<Service[]>('/services', { params })
    return response.data
  },
  create: async (data: ServiceCreatePayload): Promise<Service> => {
    const response = await apiClient.post<Service>('/services', data)
    return response.data
  },
  update: async (id: string, data: Partial<Service>): Promise<Service> => {
    const response = await apiClient.patch<Service>(`/services/${id}`, data)
    return response.data
  },
}

export const paymentsApi = {
  list: async (params?: Record<string, unknown>): Promise<Payment[]> => {
    const response = await apiClient.get<Payment[]>('/payments', { params })
    return response.data
  },
  create: async (data: Partial<Payment>): Promise<Payment> => {
    const response = await apiClient.post<Payment>('/payments', data)
    return response.data
  },
  update: async (id: string, data: Partial<Payment>): Promise<Payment> => {
    const response = await apiClient.patch<Payment>(`/payments/${id}`, data)
    return response.data
  },
  financeSummary: async (): Promise<FinanceSummary> => {
    const response = await apiClient.get<FinanceSummary>(
      '/payments/finance-summary'
    )
    return response.data
  },
  mentorPayouts: async (): Promise<MentorPayout[]> => {
    const response = await apiClient.get<MentorPayout[]>(
      '/payments/mentor-payouts'
    )
    return response.data
  },
  clientBalances: async (): Promise<ClientBalance[]> => {
    const response = await apiClient.get<ClientBalance[]>(
      '/payments/client-balances'
    )
    return response.data
  },
}

export const guardiansApi = {
  listByStudent: async (studentId: string): Promise<Guardian[]> => {
    const response = await apiClient.get<Guardian[]>(
      `/guardians/student/${studentId}`
    )
    return response.data
  },
  create: async (
    studentId: string,
    data: Omit<GuardianCreatePayload, 'student_id'>
  ): Promise<Guardian> => {
    const response = await apiClient.post<Guardian>(`/guardians`, {
      ...data,
      student_id: studentId,
    })
    return response.data
  },
  update: async (id: string, data: Partial<Guardian>): Promise<Guardian> => {
    const response = await apiClient.patch<Guardian>(`/guardians/${id}`, data)
    return response.data
  },
  revealIin: async (id: string): Promise<{ iin: string }> => {
    const response = await apiClient.get<{ iin: string }>(
      `/guardians/${id}/reveal-iin`
    )
    return response.data
  },
}

export const tasksApi = {
  listByStudent: async (studentId: string): Promise<StudentTask[]> => {
    const response = await apiClient.get<StudentTask[]>(
      `/tasks/student/${studentId}`
    )
    return response.data
  },
  create: async (
    studentId: string,
    data: Partial<StudentTask>
  ): Promise<StudentTask> => {
    const response = await apiClient.post<StudentTask>(`/tasks`, {
      ...data,
      student_id: studentId,
    })
    return response.data
  },
  update: async (
    id: string,
    data: Partial<StudentTask>
  ): Promise<StudentTask> => {
    const response = await apiClient.patch<StudentTask>(`/tasks/${id}`, data)
    return response.data
  },
}

export const confidentialNotesApi = {
  listByStudent: async (studentId: string): Promise<ConfidentialNote[]> => {
    const response = await apiClient.get<ConfidentialNote[]>(
      `/confidential-notes/student/${studentId}`
    )
    return response.data
  },
  create: async (
    studentId: string,
    data: Omit<ConfidentialNoteCreatePayload, 'student_id'>
  ): Promise<ConfidentialNote> => {
    const response = await apiClient.post<ConfidentialNote>(
      `/confidential-notes`,
      { ...data, student_id: studentId }
    )
    return response.data
  },
}

export const portfolioApi = {
  listByStudent: async (studentId: string): Promise<PortfolioProgress> => {
    const response = await apiClient.get<PortfolioProgress>(
      `/portfolio/student/${studentId}`
    )
    return response.data
  },
  create: async (
    studentId: string,
    data: Partial<PortfolioProgress>
  ): Promise<PortfolioProgress> => {
    const response = await apiClient.post<PortfolioProgress>(`/portfolio`, {
      ...data,
      student_id: studentId,
    })
    return response.data
  },
  update: async (
    id: string,
    data: Partial<PortfolioProgress>
  ): Promise<PortfolioProgress> => {
    const response = await apiClient.patch<PortfolioProgress>(
      `/portfolio/${id}`,
      data
    )
    return response.data
  },
}

export const countriesApi = {
  list: async (): Promise<Country[]> => {
    const response = await apiClient.get<Country[]>('/countries')
    return response.data
  },
  create: async (data: Partial<Country>): Promise<Country> => {
    const response = await apiClient.post<Country>('/countries', data)
    return response.data
  },
  update: async (id: string, data: Partial<Country>): Promise<Country> => {
    const response = await apiClient.patch<Country>(`/countries/${id}`, data)
    return response.data
  },
}

export const mentorAssignmentsApi = {
  listByStudent: async (studentId: string): Promise<MentorAssignment[]> => {
    const response = await apiClient.get<MentorAssignment[]>(
      `/mentor-assignments/student/${studentId}`
    )
    return response.data
  },
  create: async (
    studentId: string,
    data: Partial<MentorAssignment>
  ): Promise<MentorAssignment> => {
    const response = await apiClient.post<MentorAssignment>(
      `/mentor-assignments`,
      { ...data, student_id: studentId }
    )
    return response.data
  },
  assignSelf: async (studentId: string): Promise<MentorAssignment> => {
    const response = await apiClient.post<MentorAssignment>(
      `/mentor-assignments/student/${studentId}/self`
    )
    return response.data
  },
  setSelfActive: async (
    studentId: string,
    isActive: boolean
  ): Promise<MentorAssignment> => {
    const response = await apiClient.patch<MentorAssignment>(
      `/mentor-assignments/student/${studentId}/self`,
      { is_active: isActive }
    )
    return response.data
  },
}

export const pendingInsightsApi = {
  review: async (id: string, action: 'approve' | 'reject') => {
    const response = await apiClient.post(`/communications/pending-insights/${id}/review`, { action })
    return response.data
  },
  listAll: async (
    status?: string,
    scope?: 'all' | 'mine'
  ): Promise<InsightWithDiff[]> => {
    const response = await apiClient.get<InsightWithDiff[]>('/communications/pending-insights', {
      params: { ...(status ? { status } : {}), ...(scope ? { scope } : {}) },
    })
    return response.data
  },
}

export const historyApi = {
  list: async (params: {
    entity_type: string
    entity_id: string
  }): Promise<HistoryEntry[]> => {
    const response = await apiClient.get<HistoryEntry[]>('/history', { params })
    return response.data
  },
}

export const usersApi = {
  list: async (params?: { role?: string }): Promise<User[]> => {
    const response = await apiClient.get<User[]>('/users', { params })
    return response.data
  },
  create: async (data: Partial<User> & { password?: string }): Promise<User> => {
    const response = await apiClient.post<User>('/users', data)
    return response.data
  },
  update: async (
    id: string,
    data: Partial<User> & { password?: string }
  ): Promise<User> => {
    const response = await apiClient.patch<User>(`/users/${id}`, data)
    return response.data
  },
}
