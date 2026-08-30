import React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleUser, UserCheck } from 'lucide-react'
import {
  AREA_LABELS,
  ResponsibilityArea,
  responsibilitiesApi,
} from '@/api/responsibilities'
import { usersApi } from '@/api/index'
import { ROLE_LABELS, User } from '@/types'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'

/**
 * «Кто за что отвечает» у одного ученика.
 *
 * Не путать с блоком «Ответственные» выше по карточке: там специализации из
 * mentor_assignments (ментор по IELTS, по визе) — кто чем занимается ПО
 * ПРЕДМЕТУ. Здесь — участки работы: кто ведёт встречи, Telegram, заметки.
 * Ментор по IELTS может вести встречи, а может не вести; это про разное.
 *
 * Раздел ничего не запрещает. Он отвечает на вопрос «чей это участок», а кому
 * вообще можно — решает право (`can()`).
 */
export const StudentResponsibilitiesSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { can, user } = useAuth()
  const queryClient = useQueryClient()
  const canManage = can('responsibilities', 'manage')

  const { data, isLoading } = useQuery({
    queryKey: ['responsibilities', studentId],
    queryFn: () => responsibilitiesApi.forStudent(studentId),
  })

  // Назначать можно только сотрудников: кабинет ученика — не рабочая роль.
  const { data: staff = [] } = useQuery({
    queryKey: ['users', 'assignable'],
    queryFn: () => usersApi.list(),
    enabled: canManage,
    staleTime: 60_000,
    select: (users: User[]) =>
      users.filter((u) => u.is_active !== false && u.role !== 'student'),
  })

  const assign = useMutation({
    mutationFn: ({ area, userId }: { area: ResponsibilityArea; userId: string }) =>
      userId
        ? responsibilitiesApi.assign(studentId, area, userId)
        : responsibilitiesApi.clear(studentId, area),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['responsibilities', studentId] })
      queryClient.invalidateQueries({ queryKey: ['responsibilities', 'mine'] })
    },
    onError: () => toast({ title: 'Не удалось сохранить', variant: 'destructive' }),
  })

  if (isLoading) return <p className="text-sm text-p-muted">Загрузка…</p>
  if (!data) return null

  const { coverage } = data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-p-muted">
          Кто ведёт какой участок. Не ограничивает доступ — показывает, к кому идти с вопросом.
        </p>
        {/* Счётчик покрытия: пустая зона — это вопрос без ответа, а не ошибка. */}
        <span
          className={`shrink-0 rounded-pill border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${
            coverage.is_complete
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-amber-200 bg-amber-50 text-amber-700'
          }`}
        >
          {coverage.is_complete
            ? 'Все зоны закрыты'
            : `Закрыто ${coverage.covered} из ${coverage.total}`}
        </span>
      </div>

      <div className="overflow-hidden rounded-panel border border-p-line">
        {data.areas.map((cell, index) => {
          const isMine = !!cell.user_id && cell.user_id === user?.id
          return (
            <div
              key={cell.area}
              className={`flex flex-wrap items-center gap-3 px-4 py-3 ${
                index > 0 ? 'border-t border-p-line' : ''
              } ${isMine ? 'bg-p-accent/5' : ''}`}
            >
              <div className="min-w-[160px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-p-text">{AREA_LABELS[cell.area]}</span>
                  {/* Свой участок помечен и цветом, и словом: цвет в одиночку
                      не читается при дальтонизме и в чёрно-белой печати. */}
                  {isMine && (
                    <span className="inline-flex items-center gap-1 rounded-pill border border-p-accent/30 bg-p-accent/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-p-accent">
                      <UserCheck className="h-3 w-3" aria-hidden />
                      Ваш участок
                    </span>
                  )}
                </div>
                {cell.note && <p className="mt-0.5 text-xs text-p-muted">{cell.note}</p>}
              </div>

              {canManage ? (
                <select
                  value={cell.user_id ?? ''}
                  onChange={(e) => assign.mutate({ area: cell.area, userId: e.target.value })}
                  disabled={assign.isPending}
                  aria-label={`Ответственный за «${AREA_LABELS[cell.area]}»`}
                  className="h-9 min-w-[220px] rounded-ctl border border-p-line bg-p-panel px-3 text-sm text-p-text"
                >
                  <option value="">— не назначен —</option>
                  {staff.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {ROLE_LABELS[person.role]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="flex min-w-[220px] items-center gap-2 text-sm">
                  {cell.user_name ? (
                    <>
                      <CircleUser className="h-4 w-4 text-p-muted2" aria-hidden />
                      <span className="text-p-text">{cell.user_name}</span>
                      {cell.user_role && (
                        <span className="text-xs text-p-muted">{ROLE_LABELS[cell.user_role]}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-p-muted2">не назначен</span>
                  )}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
