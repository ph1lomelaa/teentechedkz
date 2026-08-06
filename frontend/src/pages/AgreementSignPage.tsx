import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Eye, FileText, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { agreementsApi, Agreement } from '@/api/agreements'
import { downloadBlob } from '@/lib/utils'
import { AuthShell } from '@/components/auth/AuthShell'
import { useDocumentPreview } from '@/hooks/useDocumentPreview'
import { DocumentViewer } from '@/components/shared/DocumentViewer'

/**
 * Подписание регламента. Обязательно для менторов, если у их аудитории есть
 * неподписанный опубликованный регламент (agreement_signature_required) —
 * см. ОС 30/07, Блок C. Экран вне layout, как ChangePasswordPage.
 */
export const AgreementSignPage: React.FC = () => {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agreements', 'pending'],
    queryFn: agreementsApi.pending,
  })

  const pending = (data?.items || []).filter((a) => !a.signed)
  const [index, setIndex] = useState(0)
  const current: Agreement | undefined = pending[index]

  const [fullName, setFullName] = useState(user?.name || '')
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [viewed, setViewed] = useState(false)

  const preview = useDocumentPreview(previewOpen ? current ?? null : null)

  useEffect(() => {
    setChecked(false)
    setViewed(false)
    setPreviewOpen(false)
  }, [current?.id])

  // No attached file (markdown-only agreement) is already readable inline on
  // the page itself — don't force the modal round-trip to unlock the checkbox.
  useEffect(() => {
    if (current && !current.file_name) setViewed(true)
  }, [current])

  useEffect(() => {
    if (!isLoading && pending.length === 0) {
      refreshUser().then(() => navigate('/', { replace: true }))
    }
  }, [isLoading, navigate, pending.length, refreshUser])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!current) return
    setError('')
    if (!fullName.trim()) {
      setError('Укажите ФИО')
      return
    }
    if (!checked) {
      setError('Нужно подтвердить согласие')
      return
    }
    setLoading(true)
    try {
      await agreementsApi.sign(current.id, {
        full_name_typed: fullName.trim(),
        checkbox_acknowledged: checked,
      })
      if (index + 1 < pending.length) {
        setIndex(index + 1)
      } else {
        const refreshed = await refetch()
        const remaining = (refreshed.data?.items || []).filter((agreement) => !agreement.signed)
        if (remaining.length === 0) {
          await refreshUser()
          navigate('/', { replace: true })
        }
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      setError(detail || 'Не удалось подписать регламент')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    if (!current?.file_name) return
    const blob = await agreementsApi.download(current.id)
    downloadBlob(blob, current.file_name)
  }

  const openPreview = () => {
    if (!current) return
    setPreviewOpen(true)
  }

  if (isLoading || !current) {
    return (
      <AuthShell eyebrow="Регламент" title="Загрузка…" wide>
        <p className="text-sm text-white/60">Проверяем регламенты…</p>
      </AuthShell>
    )
  }

  const inputCls = 'h-12 w-full rounded-ctl border px-4 text-sm transition-colors'

  return (
    <AuthShell
      eyebrow={`Регламент ${pending.length > 1 ? `${index + 1} из ${pending.length}` : ''}`}
      title={current.title}
      description="Прочитайте и подпишите регламент, чтобы продолжить работу."
      wide
    >
      <div className="space-y-5">
        {error && (
          <div className="rounded-ctl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#FFD400] text-black">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">Документ для ознакомления</p>
              <p className="mt-1 text-xs leading-5 text-white/55">
                Откройте превью и внимательно ознакомьтесь с актуальной версией перед подписью.
              </p>
            </div>
            {viewed && <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-400" aria-label="Документ просмотрен" />}
          </div>
          {current.body_markdown && (
            <div className="mt-4 max-h-[30vh] overflow-y-auto rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-white/80 whitespace-pre-wrap">
              {current.body_markdown}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openPreview}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#FFD400] px-4 text-xs font-black text-black transition hover:bg-[#ffe04d]"
            >
              <Eye className="h-4 w-4" /> Открыть превью
            </button>
            {current.file_name && (
              <button
                type="button"
                onClick={handleDownload}
                className="h-10 rounded-xl border border-white/15 px-4 text-xs font-bold text-white/70 transition hover:border-white/30 hover:text-white"
              >
                Скачать {current.file_name}
              </button>
            )}
          </div>
        </section>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label className="auth-field-label block" htmlFor="full_name">
              ФИО
            </label>
            <input
              id="full_name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              className={inputCls}
            />
          </div>

          <label className="flex items-start gap-3 text-sm text-white/80">
            <input
              type="checkbox"
              checked={checked}
              disabled={!viewed}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 disabled:opacity-40"
            />
            <span>
              Я ознакомлен(а) с документом и согласен(на) с его условиями.
              {!viewed && <span className="mt-1 block text-xs text-[#FFD400]">Сначала откройте превью документа.</span>}
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !viewed || !checked}
            className="auth-primary-button h-12 w-full text-[13px] uppercase tracking-[0.14em]"
          >
            {loading ? 'Подписываем…' : 'Подписать регламент'}
          </button>
        </form>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Превью документа">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151515] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <p className="text-sm font-bold text-white">Превью документа</p>
                <p className="mt-0.5 text-xs text-white/50">Версия {current.version}</p>
              </div>
              <button type="button" onClick={() => setPreviewOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Закрыть превью">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[#242424] p-3 sm:p-5">
              <DocumentViewer preview={preview} title={current.title} />
            </div>
            <div className="flex flex-col gap-3 border-t border-white/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-xs leading-5 text-white/55">После подтверждения превью вы сможете поставить отметку об ознакомлении.</p>
              <button
                type="button"
                onClick={() => { setViewed(true); setPreviewOpen(false) }}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FFD400] px-4 text-xs font-black text-black hover:bg-[#ffe04d]"
              >
                <CheckCircle2 className="h-4 w-4" /> Я ознакомился с документом
              </button>
            </div>
          </div>
        </div>
      )}
    </AuthShell>
  )
}
