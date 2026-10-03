import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { mentorAssignmentsApi, usersApi } from '@/api/index'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { Button } from '@/components/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/primitives/select'

/** Кто на Обзоре назначает другим, а не только берёт студентов себе. */
export function useCanAssignOthers() {
  const { hasRole } = useAuth()
  return hasRole('admin', 'mzk_manager', 'academic_head')
}

/** Взять студентов себе может любой сотрудник — админ в том числе. */
export function useCanSelectStudents() {
  const { hasRole } = useAuth()
  return hasRole('admin', 'mentor', 'mzk_manager', 'academic_head')
}

interface StudentAssignmentBarProps {
  selectedCount: number
  selectableCount: number
  allSelected: boolean
  onToggleAll: () => void
  targetUserId: string
  onTargetChange: (userId: string) => void
  /**
   * Превращает текущий выбор в id карточек студентов. В Notion-виде у части
   * строк карточки ещё нет — её создают прямо здесь, перед назначением.
   */
  resolveStudentIds: () => Promise<string[]>
  onAssigned: () => void
}

/**
 * Полоса массового назначения: «Назначить мне» и назначение ментору или
 * менеджеру. Общая для CRM-доски и Notion-вида Обзора.
 */
export function StudentAssignmentBar({
  selectedCount, selectableCount, allSelected, onToggleAll,
  targetUserId, onTargetChange, resolveStudentIds, onAssigned,
}: StudentAssignmentBarProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const isAdmin = useCanAssignOthers()

  const { data: assignmentUsers = [] } = useQuery({
    queryKey: ['dashboard', 'assignment-users'],
    queryFn: () => usersApi.list(),
    enabled: isAdmin,
  })
  // Админ здесь наравне с остальными: в небольшой команде он ведёт студентов
  // сам, и бэкенд это теперь разрешает (mentor_assignments.py).
  const availableAssignees = assignmentUsers.filter(
    (candidate) => candidate.is_active && ['admin', 'mentor', 'mzk_manager'].includes(candidate.role)
  )

  const assign = useMutation({
    mutationFn: async ({ assigneeId }: { assigneeId?: string }) => {
      const studentIds = await resolveStudentIds()
      if (isAdmin) {
        if (!assigneeId) throw new Error('Выберите ментора или менеджера')
        await Promise.all(studentIds.map((studentId) => mentorAssignmentsApi.create(studentId, {
          mentor_id: assigneeId,
          role: 'lead',
          is_active: true,
        })))
        return studentIds.length
      }
      await Promise.all(studentIds.map((studentId) => mentorAssignmentsApi.assignSelf(studentId)))
      return studentIds.length
    },
    onSuccess: (count) => {
      onAssigned()
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['my-students'] })
      queryClient.invalidateQueries({ queryKey: ['workspace'] })
      queryClient.invalidateQueries({ queryKey: ['notion', 'pipeline-table'] })
      toast({
        title: isAdmin ? 'Ответственный назначен' : 'Студенты добавлены в «Мои»',
        description: `Назначено: ${count}`,
      })
    },
    onError: (err) => {
      toast({
        title: 'Не удалось назначить студентов',
        description: getErrorMessage(err),
        variant: 'destructive',
      })
    },
  })

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-card border border-brand/35 bg-brand/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-sm font-semibold text-p-text">Выбрано: {selectedCount}</div>
        <p className="mt-0.5 text-xs text-p-muted">Студенты с отметкой «Уже мой» повторно не назначаются.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          variant="outline"
          size="sm"
          disabled={selectableCount === 0}
          onClick={onToggleAll}
        >
          {allSelected ? 'Снять выбор' : `Выбрать все · ${selectableCount}`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={selectedCount === 0 || assign.isPending}
          onClick={() => assign.mutate({ assigneeId: user?.id })}
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          Назначить мне
        </Button>
        {isAdmin && (
          <Select
            value={targetUserId || 'none'}
            onValueChange={(value) => onTargetChange(value === 'none' ? '' : value)}
          >
            <SelectTrigger className="h-9 w-full text-xs sm:w-56">
              <SelectValue placeholder="Ментор или менеджер" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Выберите ответственного</SelectItem>
              {availableAssignees.map((assignee) => (
                <SelectItem key={assignee.id} value={assignee.id}>
                  {assignee.name} · {assignee.role === 'mentor' ? 'ментор' : 'менеджер'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          size="sm"
          disabled={selectedCount === 0 || assign.isPending || (isAdmin && !targetUserId)}
          onClick={() => assign.mutate({ assigneeId: isAdmin ? targetUserId : user?.id })}
        >
          <UserPlus className="mr-1.5 h-3.5 w-3.5" />
          {assign.isPending ? 'Добавляем…' : isAdmin ? 'Назначить выбранных' : 'Добавить в мои'}
        </Button>
      </div>
    </div>
  )
}
