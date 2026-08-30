import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '@/api/students'
import { usersApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import { StudentListItem } from '@/types'

/**
 * Единый справочник студентов + фасеты фильтров (год/страна/степень) + список
 * ответственных (реальные User, а не Notion-канонизированные people-facets —
 * только они совпадают по id с student.responsibles[].id).
 * Используется страницами без собственного /list-эндпоинта с фильтрами
 * (Telegram, Конспекты, Статус, Риски), чтобы соединять их записи со студентом
 * по student_id и фильтровать на клиенте так же, как в «Общей базе».
 */
export function useStudentDirectory() {
  const { can } = useAuth()
  // Решение 30.08.2026: фильтр по ответственному открыт и ментору — это
  // фильтр выдачи, а не доступ к данным.
  const isManager = can('users', 'view')

  const { data: students = [], isLoading: studentsLoading } = useQuery({
    queryKey: ['student-directory', 'students'],
    queryFn: () => studentsApi.getAll({ size: 2000 }),
    staleTime: 60_000,
  })

  const { data: facets, isLoading: facetsLoading } = useQuery({
    queryKey: ['student-directory', 'facets'],
    queryFn: () => studentsApi.facets(),
    staleTime: 60_000,
  })

  const { data: mentors = [] } = useQuery({
    queryKey: ['student-directory', 'users', 'mentor'],
    queryFn: () => usersApi.list({ role: 'mentor' }),
    enabled: isManager,
    staleTime: 60_000,
  })

  const { data: managers = [] } = useQuery({
    queryKey: ['student-directory', 'users', 'mzk_manager'],
    queryFn: () => usersApi.list({ role: 'mzk_manager' }),
    enabled: isManager,
    staleTime: 60_000,
  })

  const byId = useMemo(() => {
    const map = new Map<string, StudentListItem>()
    students.forEach((s) => map.set(s.id, s))
    return map
  }, [students])

  const responsibleUsers = useMemo(
    () => [...managers, ...mentors].sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    [managers, mentors],
  )

  return {
    students,
    byId,
    years: facets?.years ?? [],
    countries: facets?.countries ?? [],
    degrees: facets?.degrees ?? [],
    responsibleUsers,
    canFilterByResponsible: isManager,
    isLoading: studentsLoading || facetsLoading,
  }
}

export interface StudentDirectoryFilters {
  year: string
  country: string
  degree: string
  responsibleId: string
}

export const EMPTY_DIRECTORY_FILTERS: StudentDirectoryFilters = {
  year: '',
  country: '',
  degree: '',
  responsibleId: '',
}

/** true если студент проходит по году/стране/степени/ответственному. Запись
 * без student_id (например Telegram-чат без привязки) не проходит фильтр,
 * как только выбран хотя бы один из этих критериев. */
export function matchesDirectoryFilters(
  student: StudentListItem | undefined,
  filters: StudentDirectoryFilters,
): boolean {
  const hasAnyFilter = filters.year || filters.country || filters.degree || filters.responsibleId
  if (!hasAnyFilter) return true
  if (!student) return false
  if (filters.year && String(student.intake_year) !== filters.year) return false
  if (filters.country && student.country !== filters.country) return false
  if (filters.degree && student.degree_level !== filters.degree) return false
  if (
    filters.responsibleId &&
    !student.responsibles?.some((r) => r.id === filters.responsibleId && r.is_active)
  )
    return false
  return true
}
