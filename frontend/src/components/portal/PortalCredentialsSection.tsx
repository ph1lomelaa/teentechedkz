import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, ExternalLink, Eye, EyeOff, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react'
import { applicationsApi } from '@/api'
import { credentialsApi, hasCredentialFor, PortalCredential, PortalCredentialPayload } from '@/api/credentials'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { Application } from '@/types'
import { QueryError } from '@/components/shared/QueryState'
import { applicationTitle, CredentialFormDialog } from './CredentialFormDialog'

export const credentialsQueryKey = (mode: 'staff' | 'self', studentId?: string) =>
  mode === 'self' ? ['credentials', 'mine'] : ['credentials', studentId]

/** Доступы к порталам вузов (регламент admission) — общий блок для CRM,
 *  воркспейса и портала.
 *
 * Повод — поддельный оффер, который вскрылся, только когда студент прилетел
 * в страну обучения. С доступами компания проверяет оффер сама, поэтому
 * без них бэкенд не даёт отметить оффер или зачисление.
 *
 * 'staff' вносит и правит доступы; 'self' — студент, только смотрит.
 */
export const PortalCredentialsSection: React.FC<{
  mode: 'staff' | 'self'
  studentId?: string
}> = ({ mode, studentId }) => {
  const queryClient = useQueryClient()
  // null — диалог закрыт; undefined — создание; доступ — правка
  const [editing, setEditing] = useState<PortalCredential | null | undefined>(null)
  const [presetApp, setPresetApp] = useState<Application | null>(null)

  const queryKey = credentialsQueryKey(mode, studentId)
  const enabled = mode === 'self' || Boolean(studentId)
  const { data: creds = [], isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => (mode === 'self' ? credentialsApi.listMine() : credentialsApi.listForStudent(studentId!)),
    enabled,
  })
  // Тот же ключ, что в ApplicationsSection — запрос не дублируется.
  const { data: applications = [] } = useQuery({
    queryKey: mode === 'self' ? ['applications', 'mine'] : ['applications', studentId],
    queryFn: () => (mode === 'self' ? applicationsApi.listMine() : applicationsApi.listForStudent(studentId!)),
    enabled,
  })

  const canManage = mode === 'staff' && Boolean(studentId)
  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const saveMutation = useMutation({
    mutationFn: (values: PortalCredentialPayload) =>
      editing
        ? credentialsApi.update(editing.id, values)
        : credentialsApi.create({ ...values, student_id: studentId! }),
    onSuccess: () => {
      invalidate()
      const wasEditing = Boolean(editing)
      setEditing(null)
      setPresetApp(null)
      toast({ title: wasEditing ? 'Доступ обновлён' : 'Доступ добавлен' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось сохранить доступ', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => credentialsApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Доступ удалён' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось удалить доступ', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const appsWithout = canManage ? applications.filter((a) => !hasCredentialFor(creds, a)) : []
  const titleById = new Map(applications.map((a) => [a.id, applicationTitle(a)]))

  const openFor = (app: Application | null) => {
    setPresetApp(app)
    setEditing(undefined)
  }

  if (isError) return <QueryError colorPrefix="p" error={error} onRetry={refetch} />
  if (isLoading) return <p className="text-sm text-p-muted">Загрузка…</p>

  return (
    <div>
      {canManage && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-p-muted">Ссылка, логин и пароль от портала каждой подачи.</p>
          <button
            type="button"
            onClick={() => openFor(null)}
            className="inline-flex flex-none items-center gap-1.5 rounded-ctl border border-p-line px-3 py-1.5 text-xs font-bold text-p-text transition-colors hover:border-brand-dim"
          >
            <Plus className="h-3.5 w-3.5" /> Добавить доступ
          </button>
        </div>
      )}

      {appsWithout.length > 0 && (
        <div className="mb-3 rounded-card border border-p-line bg-p-panel2 p-3">
          <p className="flex items-center gap-1.5 text-xs font-bold text-p-danger-text">
            <AlertTriangle className="h-3.5 w-3.5" /> Нет доступов к порталу — оффер по этим заявкам не отметить
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {appsWithout.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => openFor(a)}
                className="inline-flex items-center gap-1 rounded-full border border-p-line px-2.5 py-1 text-[11px] font-bold text-p-text hover:border-brand-dim"
              >
                <Plus className="h-3 w-3" /> {applicationTitle(a)}
              </button>
            ))}
          </div>
        </div>
      )}

      {creds.length === 0 ? (
        <div className="rounded-card border border-dashed border-p-line p-5 text-center">
          <KeyRound className="mx-auto h-5 w-5 text-p-muted2" />
          <p className="mt-2 text-sm text-p-muted">
            {mode === 'self'
              ? 'Доступов пока нет. Их добавит ментор, когда зарегистрирует вас на портале вуза.'
              : 'Доступы не добавлены.'}
          </p>
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {creds.map((c) => (
            <CredentialRow
              key={c.id}
              cred={c}
              applicationTitle={c.application_id ? titleById.get(c.application_id) : undefined}
              canManage={canManage}
              onEdit={() => {
                setPresetApp(null)
                setEditing(c)
              }}
              onDelete={() => {
                if (window.confirm(`Удалить доступ «${c.portal_name}»?`)) deleteMutation.mutate(c.id)
              }}
            />
          ))}
        </ul>
      )}

      {canManage && (
        <CredentialFormDialog
          open={editing !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null)
              setPresetApp(null)
            }
          }}
          initial={editing ?? null}
          presetApplication={presetApp}
          applications={applications}
          onSubmit={(values) => saveMutation.mutate(values)}
          isPending={saveMutation.isPending}
        />
      )}
    </div>
  )
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast({ title: `${what} скопирован` })
  } catch {
    toast({ title: 'Не удалось скопировать', variant: 'destructive' })
  }
}

const CredentialRow: React.FC<{
  cred: PortalCredential
  applicationTitle?: string
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}> = ({ cred, applicationTitle, canManage, onEdit, onDelete }) => {
  const [password, setPassword] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Пароль запрашиваем только по клику: каждый показ пишется в журнал.
  const reveal = async (): Promise<string | null> => {
    if (password !== null) return password
    setLoading(true)
    try {
      const value = await credentialsApi.reveal(cred.id)
      setPassword(value)
      return value
    } catch (err) {
      toast({ title: 'Не удалось показать пароль', description: getErrorMessage(err), variant: 'destructive' })
      return null
    } finally {
      setLoading(false)
    }
  }

  const iconButton =
    'inline-flex h-7 w-7 flex-none items-center justify-center rounded-ctl text-p-muted2 transition-colors hover:bg-p-panel2 hover:text-p-text disabled:opacity-50'

  return (
    <li className="rounded-card border border-p-line bg-p-panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-p-text">{cred.portal_name}</p>
          {applicationTitle && applicationTitle !== cred.portal_name && (
            <p className="truncate text-xs text-p-muted">Заявка: {applicationTitle}</p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-none items-center gap-1">
            <button type="button" onClick={onEdit} className={iconButton} aria-label="Изменить">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onDelete} className={`${iconButton} hover:text-p-danger-text`} aria-label="Удалить">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <dl className="mt-2 grid gap-1.5 text-sm">
        {cred.portal_url && (
          <Line label="Ссылка">
            <a
              href={cred.portal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1 truncate text-p-text hover:underline"
            >
              <span className="truncate">{cred.portal_url}</span>
              <ExternalLink className="h-3 w-3 flex-none" />
            </a>
          </Line>
        )}
        <Line label="Логин">
          <span className="truncate font-mono text-p-text">{cred.login}</span>
          <button type="button" onClick={() => copy(cred.login, 'Логин')} className={iconButton} aria-label="Скопировать логин">
            <Copy className="h-3.5 w-3.5" />
          </button>
        </Line>
        <Line label="Пароль">
          <span className="truncate font-mono text-p-text">{password ?? '••••••••'}</span>
          <button
            type="button"
            disabled={loading}
            onClick={() => (password !== null ? setPassword(null) : void reveal())}
            className={iconButton}
            aria-label={password !== null ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {password !== null ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              const value = await reveal()
              if (value !== null) await copy(value, 'Пароль')
            }}
            className={iconButton}
            aria-label="Скопировать пароль"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </Line>
        {cred.notes && <Line label="Заметка"><span className="text-p-muted">{cred.notes}</span></Line>}
      </dl>
    </li>
  )
}

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 items-center gap-2">
    <dt className="w-16 flex-none text-[11px] font-bold uppercase tracking-wider text-p-muted2">{label}</dt>
    <dd className="flex min-w-0 flex-1 items-center gap-1">{children}</dd>
  </div>
)
