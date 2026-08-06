import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronDown, ChevronRight, Download, Eye, FileText, Plus, X } from 'lucide-react'
import { agreementsApi, Agreement, AgreementAudience } from '@/api/agreements'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { downloadBlob, cn } from '@/lib/utils'
import { AppButton, AppInput, EmptyState, PageHeader } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { ADMIN_TOKENS, type AdminColorPrefix } from './tokens'
import { renderAsync } from 'docx-preview'

const AUDIENCE_LABELS: Record<AgreementAudience, string> = {
  mentor: 'Ментор',
  student: 'Студент',
  mzk: 'МЗК',
  admin: 'Академ Хэд / Хэд МЗК',
}

const STATUS_LABELS: Record<Agreement['status'], string> = {
  draft: 'Черновик',
  published: 'Опубликован',
  archived: 'Архив',
}

interface Props {
  colorPrefix?: AdminColorPrefix
}

export const AgreementsManager: React.FC<Props> = ({ colorPrefix = 'w' }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const { hasRole } = useAuth()
  const isAdmin = hasRole('admin')
  const [creating, setCreating] = useState(false)
  const [previewAgreement, setPreviewAgreement] = useState<(Agreement & { previewUrl?: string; previewMode?: 'pdf' | 'docx' | 'text' }) | null>(null)

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['agreements', 'pending'],
    queryFn: agreementsApi.pending,
  })
  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['agreements', 'all'],
    queryFn: () => agreementsApi.list(),
    enabled: isAdmin,
  })

  const handleDownload = async (a: Agreement) => {
    if (!a.file_name) return
    try {
      const blob = await agreementsApi.download(a.id)
      downloadBlob(blob, a.file_name)
    } catch (e) {
      toast({ title: getErrorMessage(e, 'Не удалось скачать файл'), variant: 'destructive' })
    }
  }

  const handlePreview = async (a: Agreement) => {
    try {
      const preview = await agreementsApi.preview(a.id)
      let fileUrl: string | null = null
      let previewMode: 'pdf' | 'docx' | 'text' = 'text'
      if (preview.mode === 'pdf') {
        const blob = await agreementsApi.download(a.id)
        fileUrl = URL.createObjectURL(blob)
        previewMode = 'pdf'
      } else if (a.file_name?.toLowerCase().endsWith('.docx')) {
        const blob = await agreementsApi.download(a.id)
        fileUrl = URL.createObjectURL(blob)
        previewMode = 'docx'
      }
      setPreviewAgreement({ ...a, body_markdown: preview.text ?? a.body_markdown, previewUrl: fileUrl ?? undefined, previewMode })
    } catch (e) {
      toast({ title: getErrorMessage(e, 'Не удалось открыть документ'), variant: 'destructive' })
    }
  }

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          colorPrefix={colorPrefix}
          eyebrow="Регламенты"
          title="Регламенты"
          description="Правила работы, скачивание и статус подписи."
        />
        {isAdmin && (
          <AppButton colorPrefix={colorPrefix} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />Новый регламент
          </AppButton>
        )}
      </div>

      <section className="mb-8">
        <h2 className={cn('mb-3 font-display text-lg font-black', t.ink)}>Мои регламенты</h2>
        {pendingLoading ? (
          <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка...</div>
        ) : (pendingData?.items.length ?? 0) === 0 ? (
          <EmptyState colorPrefix={colorPrefix} icon={<FileText className="h-5 w-5" />} title="Регламентов для вашей роли пока нет" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pendingData!.items.map((a) => (
              <article key={a.id} className={cn('p-4', t.card)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className={cn('font-bold', t.ink)}>{a.title}</h3>
                    <p className={cn('mt-0.5 text-xs', t.muted)}>
                      версия {a.version}{a.country_name ? ` · ${a.country_name}` : ''}
                    </p>
                  </div>
                  {a.signed ? (
                    <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-2xs font-bold', t.line, t.good)}>
                      <CheckCircle2 className="h-3 w-3" /> подписан
                    </span>
                  ) : (
                    <span className={cn('shrink-0 rounded-pill px-2.5 py-1 text-2xs font-bold', t.dangerSoftBg, t.danger)}>
                      ожидает подписи
                    </span>
                  )}
                </div>
                {a.file_name && (
                  <button
                    type="button"
                    onClick={() => handlePreview(a)}
                    className={cn('mt-3 inline-flex items-center gap-1.5 text-xs font-bold hover:underline', t.accentText)}
                  >
                    <Eye className="h-3.5 w-3.5" /> Открыть документ
                  </button>
                )}
                {a.file_name && (
                  <button type="button" onClick={() => handleDownload(a)} className={cn('ml-4 mt-3 inline-flex items-center gap-1.5 text-xs font-bold hover:underline', t.muted)}>
                    <Download className="h-3.5 w-3.5" /> Скачать
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      {isAdmin && (
        <section>
          <h2 className={cn('mb-3 font-display text-lg font-black', t.ink)}>Все регламенты</h2>
          {allLoading ? (
            <div className={cn('p-5 text-sm', t.card, t.muted)}>Загрузка...</div>
          ) : (allData?.items.length ?? 0) === 0 ? (
            <EmptyState colorPrefix={colorPrefix} icon={<FileText className="h-5 w-5" />} title="Регламентов ещё нет" />
          ) : (
            <div className={cn('overflow-x-auto rounded-card border', t.borderLine)}>
              <table className="w-full text-sm">
                <thead>
                  <tr className={cn('border-b text-left text-2xs uppercase tracking-wide', t.borderLine, t.muted)}>
                    <th className="px-3 py-2">Название</th>
                    <th className="px-3 py-2">Аудитория</th>
                    <th className="px-3 py-2">Статус</th>
                    <th className="px-3 py-2">Подписей</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {allData!.items.map((a) => (
                    <AgreementRow key={a.id} agreement={a} colorPrefix={colorPrefix} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {creating && <CreateAgreementDialog colorPrefix={colorPrefix} onClose={() => setCreating(false)} />}
      {previewAgreement && <AgreementPreviewDialog agreement={previewAgreement} onClose={() => setPreviewAgreement(null)} />}
    </div>
  )
}

const AgreementPreviewDialog: React.FC<{ agreement: Agreement & { previewUrl?: string; previewMode?: 'pdf' | 'docx' | 'text' }; onClose: () => void }> = ({ agreement, onClose }) => {
  const docxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (agreement.previewMode !== 'docx' || !agreement.previewUrl || !docxRef.current) return
    let cancelled = false
    fetch(agreement.previewUrl)
      .then((response) => response.blob())
      .then((blob) => {
        if (!cancelled && docxRef.current) {
          docxRef.current.innerHTML = ''
          return renderAsync(blob, docxRef.current)
        }
        return undefined
      })
      .catch(() => {
        if (docxRef.current) docxRef.current.textContent = 'Не удалось отобразить документ.'
      })
    return () => { cancelled = true }
  }, [agreement.previewMode, agreement.previewUrl])

  useEffect(() => () => {
    if (agreement.previewUrl) URL.revokeObjectURL(agreement.previewUrl)
  }, [agreement.previewUrl])

  return (
  <Dialog open onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="portal max-h-[92vh] max-w-5xl overflow-hidden border-w-line bg-w-panel p-0 text-w-ink">
      <DialogHeader className="flex flex-row items-start justify-between border-b border-w-line px-5 py-4">
        <div>
          <DialogTitle>{agreement.title}</DialogTitle>
          <p className="mt-1 text-xs text-w-muted">Версия {agreement.version} · {agreement.signed ? 'подписан' : 'ожидает подписи'}</p>
        </div>
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-w-muted hover:bg-w-panel2 hover:text-w-ink" aria-label="Закрыть preview"><X className="h-4 w-4" /></button>
      </DialogHeader>
      <div className="max-h-[74vh] overflow-auto bg-w-bg p-4 sm:p-6">
        {agreement.previewMode === 'docx' ? (
          <div ref={docxRef} className="docx-preview mx-auto max-w-4xl rounded-card bg-white p-4 text-black sm:p-8" />
        ) : agreement.previewUrl ? (
          <iframe title={`Превью ${agreement.title}`} src={agreement.previewUrl} className="h-[68vh] min-h-[420px] w-full rounded-card bg-white" />
        ) : (
          <article className="mx-auto min-h-[55vh] max-w-3xl rounded-card bg-white p-6 text-sm leading-7 text-gray-900 whitespace-pre-wrap shadow-sm sm:p-10">
            {agreement.body_markdown || 'Текст документа недоступен для встроенного просмотра.'}
          </article>
        )}
      </div>
    </DialogContent>
  </Dialog>
  )
}

const AgreementRow: React.FC<{ agreement: Agreement; colorPrefix: AdminColorPrefix }> = ({ agreement, colorPrefix }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)

  const publishMutation = useMutation({
    mutationFn: () => agreementsApi.publish(agreement.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreements'] })
      toast({ title: 'Регламент опубликован' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось опубликовать'), variant: 'destructive' }),
  })
  const archiveMutation = useMutation({
    mutationFn: () => agreementsApi.archive(agreement.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreements'] })
      toast({ title: 'Регламент архивирован' })
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось архивировать'), variant: 'destructive' }),
  })

  return (
    <>
      <tr className={cn('border-b last:border-0', t.borderLine)}>
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={cn('inline-flex items-center gap-1.5 text-left font-medium', t.ink)}
            aria-expanded={open}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            {agreement.title}
          </button>
        </td>
        <td className={cn('px-3 py-2', t.muted)}>{AUDIENCE_LABELS[agreement.audience]}</td>
        <td className={cn('px-3 py-2', t.muted)}>{STATUS_LABELS[agreement.status]}</td>
        <td className={cn('px-3 py-2', t.muted)}>{agreement.signatures_count ?? 0}</td>
        <td className="px-3 py-2 text-right">
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Раньше правки не было вовсе: черновик можно было только
                пересоздать, а новую редакцию опубликованного — никак. */}
            {agreement.status !== 'archived' && (
              <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" onClick={() => setEditing(true)}>
                Изменить
              </AppButton>
            )}
            {agreement.status === 'draft' && (
              <AppButton colorPrefix={colorPrefix} size="sm" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
                Опубликовать
              </AppButton>
            )}
            {agreement.status === 'published' && (
              <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>
                В архив
              </AppButton>
            )}
          </div>
        </td>
      </tr>
      {editing && (
        <EditAgreementDialog
          agreement={agreement}
          colorPrefix={colorPrefix}
          onClose={() => setEditing(false)}
        />
      )}
      {open && (
        <tr className={cn('border-b last:border-0', t.borderLine)}>
          <td colSpan={5} className={cn('px-3 py-3', t.panel2)}>
            <SignatureBreakdown agreementId={agreement.id} colorPrefix={colorPrefix} />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Кто подписал и кого ещё ждём. До этого админ видел только счётчик — «кто
 * остался» приходилось собирать вручную по колонке «Регламент» в настройках,
 * то есть со стороны человека, а не документа.
 */
const SignatureBreakdown: React.FC<{ agreementId: string; colorPrefix: AdminColorPrefix }> = ({ agreementId, colorPrefix }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const { data, isLoading, isError } = useQuery({
    queryKey: ['agreements', agreementId, 'signatures'],
    queryFn: () => agreementsApi.signatures(agreementId),
  })

  if (isLoading) return <p className={cn('text-xs', t.muted)}>Загрузка...</p>
  if (isError || !data) return <p className={cn('text-xs', t.danger)}>Не удалось загрузить список подписей</p>

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <h4 className={cn('mb-2 text-2xs font-black uppercase tracking-wider', t.muted)}>
          Подписали · {data.signed.length}
        </h4>
        {data.signed.length === 0 ? (
          <p className={cn('text-xs', t.muted2)}>Пока никто</p>
        ) : (
          <ul className="space-y-1">
            {data.signed.map((s) => (
              <li key={s.user_id} className={cn('flex flex-wrap items-baseline gap-x-2 text-xs', t.ink)}>
                <span className="font-medium">{s.full_name}</span>
                <span className={t.muted2}>
                  {new Date(s.signed_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
                {s.outdated && (
                  <span className={cn('rounded-pill px-1.5 py-0.5 text-[10px] font-bold', t.dangerSoftBg, t.danger)}>
                    версия {s.agreement_version}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className={cn('mb-2 text-2xs font-black uppercase tracking-wider', t.muted)}>
          Не подписали · {data.pending.length}
        </h4>
        {data.pending.length === 0 ? (
          <p className={cn('text-xs', t.good)}>Все активные сотрудники подписали</p>
        ) : (
          <ul className="space-y-1">
            {data.pending.map((u) => (
              <li key={u.user_id} className={cn('flex flex-wrap items-baseline gap-x-2 text-xs', t.ink)}>
                <span className="font-medium">{u.full_name}</span>
                {u.email && <span className={t.muted2}>{u.email}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const CreateAgreementDialog: React.FC<{ colorPrefix: AdminColorPrefix; onClose: () => void }> = ({ colorPrefix, onClose }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<AgreementAudience>('mentor')
  const [countryName, setCountryName] = useState('')
  const [bodyMarkdown, setBodyMarkdown] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const mutation = useMutation({
    mutationFn: () => agreementsApi.create({
      title: title.trim(),
      audience,
      body_markdown: bodyMarkdown.trim() || undefined,
      country_name: countryName.trim() || undefined,
      file: file || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agreements'] })
      toast({ title: 'Регламент создан', description: 'Черновик. Опубликуйте его, когда будет готов.' })
      onClose()
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось создать регламент'), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Новый регламент</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <AppInput
            colorPrefix={colorPrefix}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название регламента"
            required
          />
          <fieldset className={cn('rounded-ctl border p-3', t.borderLine)}>
            <legend className={cn('px-1 text-xs font-bold', t.muted)}>Аудитория</legend>
            <div className="flex flex-wrap gap-4">
              {(['mentor', 'student', 'mzk', 'admin'] as const).map((value) => (
                <label key={value} className={cn('flex items-center gap-2 text-sm', t.ink)}>
                  <input type="radio" name="audience" checked={audience === value} onChange={() => setAudience(value)} />
                  {AUDIENCE_LABELS[value]}
                </label>
              ))}
            </div>
          </fieldset>
          <AppInput
            colorPrefix={colorPrefix}
            value={countryName}
            onChange={(e) => setCountryName(e.target.value)}
            placeholder="Страна поступления (опционально)"
          />
          <textarea
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder="Текст регламента (опционально, если прикреплён файл)"
            className={cn('min-h-28 w-full rounded-ctl border px-3 py-2 text-sm outline-none', t.borderLine, t.panel2, t.ink)}
          />
          <div>
            <label className={cn('mb-1 block text-xs font-bold', t.muted)}>Файл (PDF/DOCX, опционально)</label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className={cn('w-full text-sm', t.ink)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={onClose}>Отмена</AppButton>
            <AppButton
              colorPrefix={colorPrefix}
              disabled={!title.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Создаём...' : 'Создать'}
            </AppButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Правка регламента.
 *
 * У опубликованного документа изменение содержания — это новая редакция:
 * бэкенд поднимает version, подписи прежней становятся неактуальными и
 * аудитория обязана подписать заново. Предупреждаем об этом явно, иначе
 * админ случайно снимет подписи со всех менторов.
 */
const EditAgreementDialog: React.FC<{
  agreement: Agreement
  colorPrefix: AdminColorPrefix
  onClose: () => void
}> = ({ agreement, colorPrefix, onClose }) => {
  const t = ADMIN_TOKENS[colorPrefix]
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(agreement.title)
  const [countryName, setCountryName] = useState(agreement.country_name || '')
  const [bodyMarkdown, setBodyMarkdown] = useState(agreement.body_markdown || '')
  const [file, setFile] = useState<File | null>(null)

  const contentChanged = bodyMarkdown !== (agreement.body_markdown || '') || Boolean(file)
  const isPublished = agreement.status === 'published'

  const mutation = useMutation({
    mutationFn: () =>
      agreementsApi.update(agreement.id, {
        title: title.trim(),
        body_markdown: bodyMarkdown,
        country_name: countryName,
        ...(file ? { file } : {}),
      }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['agreements'] })
      toast({
        title:
          updated.version > agreement.version
            ? `Сохранено, версия ${updated.version} — требуется переподписание`
            : 'Регламент сохранён',
      })
      onClose()
    },
    onError: (e) => toast({ title: getErrorMessage(e, 'Не удалось сохранить'), variant: 'destructive' }),
  })

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Изменить регламент</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isPublished && contentChanged && (
            <p className="rounded-ctl border border-amber-400/60 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-600 dark:text-amber-300">
              Документ опубликован. Изменение содержания создаст версию{' '}
              {agreement.version + 1}: все подписи станут неактуальными, аудитории
              придётся подписать заново.
            </p>
          )}
          <AppInput
            colorPrefix={colorPrefix}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название"
          />
          <AppInput
            colorPrefix={colorPrefix}
            value={countryName}
            onChange={(e) => setCountryName(e.target.value)}
            placeholder="Страна (необязательно)"
          />
          <textarea
            value={bodyMarkdown}
            onChange={(e) => setBodyMarkdown(e.target.value)}
            placeholder="Текст регламента (markdown)"
            className={cn('min-h-40 w-full rounded-ctl border px-3 py-2 text-sm', t.borderLine, t.panel2, t.ink)}
          />
          <div>
            <label className={cn('mb-1 block text-xs font-bold', t.muted)}>
              Заменить файл {agreement.file_name ? `(сейчас: ${agreement.file_name})` : ''}
            </label>
            <input
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className={cn('w-full text-sm', t.ink)}
            />
          </div>
          <div className="flex justify-end gap-2">
            <AppButton colorPrefix={colorPrefix} variant="ghost" onClick={onClose}>Отмена</AppButton>
            <AppButton
              colorPrefix={colorPrefix}
              disabled={!title.trim() || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Сохраняем...' : 'Сохранить'}
            </AppButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
