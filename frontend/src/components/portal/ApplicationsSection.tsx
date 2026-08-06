import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Link2, Link2Off, Pencil, Plus, Send, Star, Trash2 } from 'lucide-react'
import { applicationsApi } from '@/api'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/utils'
import { Application, SUBMISSION_STATUS_LABELS, VISA_STATUS_LABELS } from '@/types'
import { UniversityPicker } from './UniversityPicker'
import { ApplicationFormDialog, ApplicationFormValues } from './ApplicationFormDialog'

/** Заявки студента на поступление — общий блок для CRM, воркспейса и портала.
 *
 * `mode` выбирает источник данных, а не оформление: 'staff' читает заявки
 * заданного студента, 'self' — собственные заявки вошедшего студента (бэкенд
 * сам определяет, чьи). Оформление на p-* токенах, поэтому один и тот же
 * компонент корректно рендерится во всех трёх оболочках.
 *
 * В режиме 'staff' блок полностью управляет заявками: добавление, правка,
 * удаление и привязка вуза. Студент свои заявки только читает.
 */
export const ApplicationsSection: React.FC<{
  mode: 'staff' | 'self'
  studentId?: string
  /** Куда ведёт ссылка на вуз — у каждой оболочки свой каталог. */
  basePath?: string
}> = ({ mode, studentId, basePath = '/portal/universities' }) => {
  const queryClient = useQueryClient()
  // id заявки, для которой открыт выбор вуза
  const [linking, setLinking] = useState<string | null>(null)
  // null — диалог закрыт; undefined — создание; заявка — редактирование
  const [editing, setEditing] = useState<Application | null | undefined>(null)

  const queryKey = mode === 'self' ? ['applications', 'mine'] : ['applications', studentId]
  const { data: items = [], isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      mode === 'self' ? applicationsApi.listMine() : applicationsApi.listForStudent(studentId!),
    enabled: mode === 'self' || Boolean(studentId),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey })
    // Карточка студента читает заявки ещё и внутри объекта студента.
    queryClient.invalidateQueries({ queryKey: ['student', studentId] })
  }

  const saveMutation = useMutation({
    mutationFn: (values: ApplicationFormValues) =>
      editing
        ? applicationsApi.update(editing.id, values)
        : applicationsApi.create({ ...values, student_id: studentId! }),
    onSuccess: () => {
      invalidate()
      const wasEditing = Boolean(editing)
      setEditing(null)
      toast({ title: wasEditing ? 'Заявка обновлена' : 'Заявка добавлена' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось сохранить заявку', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => applicationsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Заявка удалена' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось удалить заявку', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const linkMutation = useMutation({
    mutationFn: ({ id, universityId }: { id: string; universityId: string | null }) =>
      applicationsApi.update(id, { university_id: universityId }),
    onSuccess: (_data, vars) => {
      invalidate()
      setLinking(null)
      toast({ title: vars.universityId ? 'Вуз привязан' : 'Привязка снята' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось изменить заявку', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const canManage = mode === 'staff' && Boolean(studentId)

  const addButton = canManage && (
    <button
      type="button"
      onClick={() => setEditing(undefined)}
      className="inline-flex items-center gap-1.5 rounded-ctl border border-p-line px-3 py-1.5 text-xs font-bold text-p-text transition-colors hover:border-brand-dim"
    >
      <Plus className="h-3.5 w-3.5" /> Добавить заявку
    </button>
  )

  const dialogs = canManage && (
    <>
      <ApplicationFormDialog
        open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null) }}
        initial={editing ?? null}
        onSubmit={(values) => saveMutation.mutate(values)}
        isPending={saveMutation.isPending}
      />
      <UniversityPicker
        open={Boolean(linking)}
        onOpenChange={(open) => { if (!open) setLinking(null) }}
        onPick={(universityId) => linking && linkMutation.mutate({ id: linking, universityId })}
        isPending={linkMutation.isPending}
      />
    </>
  )

  if (isLoading) {
    return <p className="text-sm text-p-muted">Загрузка…</p>
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-p-line p-5 text-center">
        <Send className="mx-auto h-5 w-5 text-p-muted2" />
        <p className="mt-2 text-sm text-p-muted">
          {mode === 'self'
            ? 'Заявок пока нет. Они появятся, когда ментор начнёт подачу.'
            : 'Заявки не добавлены.'}
        </p>
        {addButton && <div className="mt-3">{addButton}</div>}
        {dialogs}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-p-muted">Заявок: {items.length}</p>
        {addButton}
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {items.map((app) => (
          <ApplicationCard
            key={app.id}
            app={app}
            basePath={basePath}
            // Заявки ведёт персонал: студент свои заявки только читает.
            canManage={canManage}
            onLink={() => setLinking(app.id)}
            onUnlink={() => linkMutation.mutate({ id: app.id, universityId: null })}
            onEdit={() => setEditing(app)}
            onDelete={() => {
              if (window.confirm('Удалить заявку? Действие необратимо.')) {
                deleteMutation.mutate(app.id)
              }
            }}
          />
        ))}
      </ul>

      {dialogs}
    </div>
  )
}

const ApplicationCard: React.FC<{
  app: Application
  basePath: string
  canManage?: boolean
  onLink?: () => void
  onUnlink?: () => void
  onEdit?: () => void
  onDelete?: () => void
}> = ({ app, basePath, canManage = false, onLink, onUnlink, onEdit, onDelete }) => {
  const uni = app.university_ref
  // Своя дата — главная; пока её нет, показываем справочный ориентир вуза,
  // явно помечая его, чтобы не приняли за подтверждённый дедлайн.
  const referenceDeadline = uni?.deadline_note || null
  // Заголовок: имя из справочника → свободный текст → страна. Последнее — то
  // единственное, что заполнено у большинства существующих заявок.
  const title = uni?.name || app.university || app.country
  const subtitle = [uni?.country_name || app.country, uni?.city, app.program]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className="flex items-start gap-3 rounded-card border border-p-line bg-p-panel p-3">
      {uni?.photo_url ? (
        <img src={uni.photo_url} alt="" className="h-11 w-11 flex-none rounded-ctl object-cover" loading="lazy" />
      ) : (
        <span className="grid h-11 w-11 flex-none place-items-center rounded-ctl bg-p-panel2 text-base">
          {uni?.country_flag_emoji || '🎓'}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {/* Кликабельно только когда заявка привязана к справочнику —
              иначе вести некуда, вуз существует лишь как строка. */}
          {uni ? (
            <Link to={`${basePath}/${uni.id}`} className="block truncate text-sm font-bold text-p-text hover:underline">
              {title}
            </Link>
          ) : (
            <span className="block truncate text-sm font-bold text-p-text">{title}</span>
          )}
          {app.is_primary && (
            <Star className="mt-0.5 h-3.5 w-3.5 flex-none text-p-accent" aria-label="Основная заявка" />
          )}
        </div>

        {subtitle && <p className="mt-0.5 truncate text-xs text-p-muted">{subtitle}</p>}

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted2">
            {SUBMISSION_STATUS_LABELS[app.submission_status]}
          </span>
          {app.visa_status && (
            <span className="rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted2">
              Виза: {VISA_STATUS_LABELS[app.visa_status] ?? app.visa_status}
            </span>
          )}
          {app.scholarship_target && (
            <span className="rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted2">
              Цель — грант
            </span>
          )}
          {app.submissions_planned > 1 && (
            <span className="rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted2">
              Подано {app.submissions_done} из {app.submissions_planned}
            </span>
          )}
        </div>

        {/* Дедлайн — снизу отдельной строкой, чтобы его было видно, не
            вчитываясь в бейджи статусов. */}
        {(app.deadline || referenceDeadline) && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-p-muted2">
            <CalendarClock className="h-3 w-3 flex-none" />
            {app.deadline ? (
              <span className="font-bold text-p-muted">
                Дедлайн: {formatDate(app.deadline)}
              </span>
            ) : (
              <span className="truncate">Дедлайн справочно: {referenceDeadline}</span>
            )}
          </p>
        )}

        {/* Без привязки к справочнику заявка остаётся просто строкой: ни фото,
            ни ссылки, ни требований. Поэтому кнопка выведена прямо на карточку. */}
        {canManage && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {uni ? (
              <button
                type="button"
                onClick={onUnlink}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-p-muted2 hover:text-p-danger"
              >
                <Link2Off className="h-3 w-3" /> Открепить вуз
              </button>
            ) : (
              <button
                type="button"
                onClick={onLink}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-p-muted2 hover:text-p-text"
              >
                <Link2 className="h-3 w-3" /> Привязать вуз из справочника
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-p-muted2 hover:text-p-text"
            >
              <Pencil className="h-3 w-3" /> Изменить
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-[11px] font-bold text-p-muted2 hover:text-p-danger"
            >
              <Trash2 className="h-3 w-3" /> Удалить
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
