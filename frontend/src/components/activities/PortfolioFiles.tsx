import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Download } from 'lucide-react'
import { portfolioDocumentsApi, type DocumentTarget } from '@/api/learnerTasks'
import { documentsApi } from '@/api/documents'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'
import { getErrorMessage } from '@/lib/errorMessage'

export function PortfolioFiles({ target, editable = true, result = false }: { target: DocumentTarget; editable?: boolean; result?: boolean }) {
  const { user } = useAuth()
  const client = useQueryClient()
  const [existing, setExisting] = useState('')
  const [choose, setChoose] = useState(false)
  const [docType, setDocType] = useState(result ? 'certificate' : 'other')
  const key = ['portfolio-files', target.task_id ?? target.participation_id]
  const files = useQuery({ queryKey: key, queryFn: () => portfolioDocumentsApi.list(target) })
  const available = useQuery({ queryKey: [...key, 'available'], queryFn: () => portfolioDocumentsApi.list(target, true), enabled: choose })
  const refresh = () => { client.invalidateQueries({ queryKey: key }); client.invalidateQueries({ queryKey: ['portal', 'documents'] }) }
  const upload = useMutation({ mutationFn: (file: File) => portfolioDocumentsApi.upload(target, file, docType), onSuccess: refresh })
  const link = useMutation({ mutationFn: () => portfolioDocumentsApi.link(target, existing), onSuccess: () => { setExisting(''); setChoose(false); refresh() } })
  const download = useMutation({ mutationFn: async (id: string) => {
    const blob = await (user?.role === 'student' ? documentsApi.portalDownload(id) : documentsApi.download(id))
    const file = files.data?.find(f => f.id === id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = file?.file_name ?? 'document'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } })
  return <div className="space-y-3">
    <QueryState isLoading={files.isLoading} isError={files.isError} error={files.error} onRetry={() => files.refetch()}>
      <ul className="space-y-2">{files.data?.map(file => <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-ctl border border-ds-line p-3 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-ds-muted" /><span className="min-w-0 flex-1 break-words">{file.display_name || file.file_name}</span>
        <AppButton variant="subtle" size="sm" disabled={download.isPending} aria-label={`Скачать ${file.file_name}`} onClick={() => download.mutate(file.id)}><Download className="h-4 w-4" /></AppButton>
      </li>)}</ul>
      {!files.data?.length && <p className="text-sm text-ds-muted">{result ? 'Файла итога пока нет.' : 'Файлов пока нет.'}</p>}
    </QueryState>
    {editable && <div className="space-y-3">
      {result && <label className="block text-xs text-ds-muted">Тип документа<select className="ml-2 rounded-ctl border border-ds-line bg-ds-panel p-2 text-sm text-ds-ink" value={docType} onChange={e => setDocType(e.target.value)}><option value="certificate">Сертификат</option><option value="achievement">Диплом / достижение</option><option value="other">Другой документ</option></select></label>}
      <div className="flex flex-wrap gap-2">
        <label className={`inline-flex cursor-pointer items-center gap-2 rounded-ctl border border-ds-line px-3 py-2 text-sm font-semibold ${upload.isPending ? 'pointer-events-none opacity-50' : ''}`}><Upload className="h-4 w-4" />{upload.isPending ? 'Загружаем…' : 'Загрузить файл'}<input className="sr-only" type="file" disabled={upload.isPending} onChange={e => { const file = e.target.files?.[0]; if (file) upload.mutate(file); e.target.value = '' }} /></label>
        <AppButton size="sm" variant="subtle" onClick={() => setChoose(!choose)}>{user?.role === 'student' ? 'Из моих документов' : 'Из документов ученика'}</AppButton>
      </div>
      {choose && <QueryState isLoading={available.isLoading} isError={available.isError} error={available.error} onRetry={() => available.refetch()}><div className="flex flex-wrap gap-2"><select aria-label="Выбрать документ" className="min-w-0 flex-1 rounded-ctl border border-ds-line bg-ds-panel p-2 text-sm" value={existing} onChange={e => setExisting(e.target.value)}><option value="">Выберите документ</option>{available.data?.filter(d => !files.data?.some(f => f.id === d.id)).map(d => <option key={d.id} value={d.id}>{d.display_name || d.file_name}</option>)}</select><AppButton size="sm" disabled={!existing || link.isPending} onClick={() => link.mutate()}>Прикрепить</AppButton></div></QueryState>}
    </div>}
    {(upload.isError || link.isError || download.isError) && <p role="alert" className="text-sm text-ds-danger">{getErrorMessage(upload.error || link.error || download.error)}</p>}
  </div>
}
