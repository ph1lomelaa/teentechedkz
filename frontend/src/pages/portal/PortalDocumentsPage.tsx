import React, { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Download, Trash2, Plus } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { documentsApi } from '@/api/documents'
import { DOC_TYPE_LABELS } from '@/types'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

export const PortalDocumentsPage: React.FC = () => {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['portal', 'documents'],
    queryFn: documentsApi.myDocuments,
  })

  const uploadMutation = useMutation({
    mutationFn: (file: File) => documentsApi.portalUpload(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] }),
    onError: () => alert('Не удалось загрузить файл (разрешены PDF, JPG, PNG, WebP до 25 МБ)'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.portalDelete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'documents'] }),
    onError: () => alert('Не удалось удалить документ'),
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
        accept=".pdf,.jpg,.jpeg,.png,.webp"
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

        {isLoading ? (
          <p className="text-sm text-p-muted">Загрузка…</p>
        ) : docs.length === 0 ? (
          <EmptyState icon={<FileText className="w-5 h-5" />} title="Документов пока нет" description="Загрузите свои документы или дождитесь, пока ментор поделится ими." colorPrefix="p" />
        ) : (
          <div className="space-y-2">
            {docs.map((d, i) => (
              <div key={d.id} className={cn('flex items-center gap-3.5 rounded-panel border border-p-line bg-transparent p-3.5 transition hover:border-p-accent-dim hover:bg-p-panel2', i < docs.length - 1 ? 'mb-2.5' : '')}>
                <div className="grid h-[34px] w-[34px] place-items-center rounded-ctl bg-p-accent/15 shrink-0">
                  <FileText className="h-4 w-4 text-p-accent" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold text-p-text">{d.file_name}</div>
                  <div className="mt-0.5 text-[11.5px] text-p-muted">
                    {DOC_TYPE_LABELS[d.doc_type as keyof typeof DOC_TYPE_LABELS] ?? d.doc_type} · {fmtSize(d.file_size)}
                  </div>
                </div>
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
        )}

        <button
          type="button"
          disabled={uploadMutation.isPending}
          onClick={() => fileRef.current?.click()}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-ctl border border-p-line bg-p-panel2 px-3 py-2 text-[12px] font-bold text-p-muted transition hover:border-p-accent-dim hover:text-p-text"
        >
          <Plus className="h-3.5 w-3.5" /> {uploadMutation.isPending ? 'Загрузка…' : 'Добавить документ'}
        </button>
      </div>
    </PageShell>
  )
}
