import React, { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Download, Trash2 } from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { DOC_TYPE_LABELS } from '@/types'
import { Button } from '@/components/ui/button'

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
    <div className="mx-auto max-w-4xl animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
          <h1 className="mt-2 font-display text-[32px] font-black tracking-tight text-p-text">Документы</h1>
        </div>
        <Button
          size="sm"
          className="h-10 rounded-[11px] bg-brand px-4 text-xs font-extrabold text-black hover:bg-brand-dark"
          disabled={uploadMutation.isPending}
          onClick={() => fileRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5 mr-2" /> {uploadMutation.isPending ? 'Загрузка…' : 'Загрузить'}
        </Button>
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
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="w-11 h-11 rounded-[13px] bg-brand/15 grid place-items-center mx-auto">
            <FileText className="w-5 h-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Документов пока нет</h2>
          <p className="mt-1.5 text-sm text-p-muted">Загрузите свои документы или дождитесь, пока ментор поделится ими.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border border-p-line rounded-[14px] bg-p-panel p-3">
              <div className="w-10 h-10 rounded-[12px] bg-brand/15 grid place-items-center shrink-0">
                <FileText className="w-4 h-4 text-brand" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-p-text truncate">{d.file_name}</div>
                <div className="text-[11.5px] text-p-muted mt-0.5">
                  {DOC_TYPE_LABELS[d.doc_type as keyof typeof DOC_TYPE_LABELS] ?? d.doc_type} · {fmtSize(d.file_size)}
                </div>
              </div>
              <button
                onClick={() => handleDownload(d.id, d.file_name)}
                disabled={downloading === d.id}
                className="inline-flex items-center gap-1.5 text-xs font-semibold border border-p-line rounded-[10px] px-3 py-1.5 text-p-muted hover:bg-p-panel2 hover:text-p-text shrink-0"
              >
                <Download className="w-3.5 h-3.5" /> {downloading === d.id ? '…' : 'Скачать'}
              </button>
              {d.source === 'manual_upload' && (
                <button
                  onClick={() => {
                    if (window.confirm('Удалить документ?')) deleteMutation.mutate(d.id)
                  }}
                  disabled={deleteMutation.isPending}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold border border-p-line rounded-[10px] px-2.5 py-1.5 text-p-muted hover:border-brand/60 hover:text-brand shrink-0"
                  aria-label="Удалить документ"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
