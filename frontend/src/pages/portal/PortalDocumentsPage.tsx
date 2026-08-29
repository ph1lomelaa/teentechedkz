import React, { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSignature, FileText, Plus, Trash2, X } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { QueryState } from '@/components/shared/QueryState'
import { toast } from '@/hooks/use-toast'
import { documentsApi } from '@/api/documents'
import { DOC_TYPE_LABELS } from '@/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui'
import { useAuth } from '@/contexts/AuthContext'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

/** Одна правда об ограничениях загрузки: подпись под кнопкой, текст ошибки и
 *  сам `accept` должны совпадать — раньше они жили в трёх разных строках. */
const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
const UPLOAD_LIMITS_HINT = 'PDF, JPG, PNG или WebP · до 25 МБ'

export const PortalDocumentsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [signatureDoc, setSignatureDoc] = useState<(typeof docs)[number] | null>(null)
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null)
  const [signatureViewed, setSignatureViewed] = useState(false)
  const [fullName, setFullName] = useState('')
  const { user } = useAuth()

  const { data: docs = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal', 'documents'],
    queryFn: documentsApi.myDocuments,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => documentsApi.portalUpload(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] }),
    onError: () =>
      toast({
        title: 'Файл не загрузился',
        description: UPLOAD_LIMITS_HINT,
        variant: 'destructive',
      }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.portalDelete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] }),
    onError: () =>
      toast({ title: 'Документ не удалился', description: 'Попробуйте ещё раз.', variant: 'destructive' }),
  })

  const signMutation = useMutation({
    mutationFn: () => documentsApi.sign(signatureDoc!.id, { full_name: fullName.trim(), acknowledged: signatureViewed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] })
      setSignatureDoc(null)
      if (signatureUrl) URL.revokeObjectURL(signatureUrl)
      setSignatureUrl(null)
      setSignatureViewed(false)
    },
  })

  const handleDownload = async (id: string, name: string) => {
    setDownloading(id)
    try {
      const blob = await documentsApi.portalDownload(id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(null)
    }
  }

  const openSignaturePreview = async (doc: (typeof docs)[number]) => {
    setSignatureDoc(doc)
    setSignatureViewed(false)
    setFullName(user?.name || '')
    const blob = await documentsApi.portalDownload(doc.id)
    setSignatureUrl(URL.createObjectURL(blob))
  }

  const closeSignaturePreview = () => {
    setSignatureDoc(null)
    if (signatureUrl) URL.revokeObjectURL(signatureUrl)
    setSignatureUrl(null)
    setSignatureViewed(false)
  }

  const confirmSignatureViewed = async () => {
    if (!signatureDoc) return
    await documentsApi.markSignatureViewed(signatureDoc.id)
    setSignatureViewed(true)
  }

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <div className="mb-6">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-p-accent">Кабинет</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Документы</h1>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept={UPLOAD_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) uploadMutation.mutate(f)
          e.target.value = ''
        }}
      />

      <div className="rounded-card border border-p-line bg-p-panel p-5">
        <h4 className="mb-3.5 flex items-center gap-2 font-display text-sm font-extrabold text-p-text">
          <FileText className="h-4 w-4 text-p-accent" />
          Документы
        </h4>

        <QueryState
          colorPrefix="p"
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
          isEmpty={docs.length === 0}
          empty={(
            <EmptyState icon={<FileText className="w-5 h-5" />} title="Документов пока нет" description="Загрузите свои документы или дождитесь, пока ментор поделится ими." colorPrefix="p" />
          )}
        >
          <div className="space-y-2">
            {docs.map((d, i) => (
              <div key={d.id} className={cn('flex flex-wrap items-center gap-3.5 rounded-panel border border-p-line bg-transparent p-3.5 transition hover:border-p-accent-dim hover:bg-p-panel2', d.signature_status === 'pending' ? 'border-l-4 border-l-p-accent' : '', i < docs.length - 1 ? 'mb-2.5' : '')}>
                <div className="grid h-[34px] w-[34px] place-items-center rounded-ctl bg-p-accent/15 shrink-0">
                  <FileText className="h-4 w-4 text-p-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-p-text">{d.file_name}</div>
                  <div className="mt-0.5 text-[11.5px] text-p-muted">
                    {DOC_TYPE_LABELS[d.doc_type as keyof typeof DOC_TYPE_LABELS] ?? d.doc_type} · {fmtSize(d.file_size)}
                  </div>
                  {d.signature_status === 'pending' && <div className="mt-1 text-xs font-bold text-p-accent">Ожидает вашей подписи</div>}
                  {d.signature_status === 'signed' && <div className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Подписан</div>}
                </div>
                {d.signature_status === 'pending' && (
                  <button onClick={() => openSignaturePreview(d)} className="inline-flex items-center gap-1.5 rounded-ctl bg-p-accent px-3 py-1.5 text-[11.5px] font-black text-black shrink-0">
                    <FileSignature className="h-3.5 w-3.5" /> Ознакомиться и подписать
                  </button>
                )}
                <button
                  onClick={() => handleDownload(d.id, d.file_name)}
                  disabled={downloading === d.id}
                  className="inline-flex items-center gap-1.5 rounded-ctl border border-p-line px-3 py-1.5 text-[11.5px] font-bold text-p-muted transition hover:border-p-accent-dim hover:bg-p-panel2 hover:text-p-text shrink-0"
                >
                  <Download className="h-3.5 w-3.5" /> {downloading === d.id ? '…' : 'Скачать'}
                </button>
                {d.source === 'manual_upload' && (
                  <button
                    onClick={() => {
                      if (window.confirm('Удалить документ?')) deleteMutation.mutate(d.id)
                    }}
                    disabled={deleteMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-ctl border border-p-line px-2.5 py-1.5 text-[11.5px] font-bold text-p-muted transition hover:border-p-danger/60 hover:text-p-danger shrink-0"
                    aria-label="Удалить документ"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

        </QueryState>

        <button
          type="button"
          disabled={uploadMutation.isPending}
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-[12px] font-bold text-p-muted transition hover:border-p-accent-dim hover:text-p-text"
        >
          <Plus className="h-3.5 w-3.5" /> {uploadMutation.isPending ? 'Загрузка…' : 'Добавить документ'}
        </button>
        {/* Ограничения — до попытки, а не в сообщении об ошибке после неё. */}
        <p className="mt-2 text-center text-[11px] text-p-muted2">
          {UPLOAD_LIMITS_HINT}
        </p>
      </div>

      {signatureDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-card border border-p-line bg-p-panel shadow-2xl">
            <div className="flex items-center justify-between border-b border-p-line px-4 py-3">
              <div><h2 className="font-display text-lg font-black text-p-text">Ознакомление с документом</h2><p className="text-xs text-p-muted">{signatureDoc.file_name}</p></div>
              <button type="button" onClick={closeSignaturePreview} className="grid h-8 w-8 place-items-center rounded-lg text-p-muted hover:bg-p-panel2 hover:text-p-text" aria-label="Закрыть"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-p-bg p-3 sm:p-5">
              {signatureUrl && signatureDoc.mime_type === 'application/pdf' ? (
                <iframe title={`Превью ${signatureDoc.file_name}`} src={signatureUrl} className="h-[55vh] min-h-[360px] w-full rounded-panel bg-white" />
              ) : (
                <div className="grid min-h-[360px] place-items-center rounded-panel border border-p-line bg-p-panel2 p-6 text-center text-sm text-p-muted">
                  Просмотрите файл в отдельной вкладке или скачайте его, затем подтвердите ознакомление.
                </div>
              )}
            </div>
            <div className="space-y-3 border-t border-p-line px-4 py-4 sm:px-5">
              <button type="button" onClick={confirmSignatureViewed} disabled={signatureViewed} className="inline-flex items-center gap-2 text-sm font-bold text-p-text disabled:text-emerald-700">
                <span className={cn('grid h-5 w-5 place-items-center rounded border', signatureViewed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-p-line')}>
                  {signatureViewed && <CheckCircle2 className="h-4 w-4" />}
                </span>
                {signatureViewed ? 'Документ просмотрен' : 'Я ознакомился с документом'}
              </button>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="ФИО для подписи" className="h-11 flex-1 rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none focus:border-p-accent" />
                <button type="button" disabled={!signatureViewed || !fullName.trim() || signMutation.isPending} onClick={() => signMutation.mutate()} className="inline-flex h-11 items-center justify-center gap-2 rounded-ctl bg-p-accent px-4 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-40">
                  <FileSignature className="h-4 w-4" /> {signMutation.isPending ? 'Подписываем…' : 'Подписать документ'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  )
}
