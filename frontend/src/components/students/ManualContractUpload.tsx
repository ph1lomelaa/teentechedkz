import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { trustmeApi, type TrustMeLink } from '@/api/trustme'
import { AppButton } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { neutralDisabled } from './contractPresentation'

export function ManualContractUpload({ studentId, studentName, onUploaded }: { studentId: string; studentName: string; onUploaded: (link: TrustMeLink) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [signed, setSigned] = useState(false)
  const [error, setError] = useState('')
  const upload = useMutation({ mutationFn: () => trustmeApi.upload(studentId, file!, name.trim(), signed), onSuccess: onUploaded, retry: false })
  return <form className="space-y-4 py-4" onSubmit={e => { e.preventDefault(); upload.mutate() }}>
    <p className="text-sm text-p-muted">Загрузите договор, если он не найден в TrustMe. PDF до 30 МБ, без пароля. Данные из документа появятся для проверки.</p>
    <label className="block text-xs text-p-muted">Файл договора<input type="file" accept="application/pdf,.pdf" className="mt-2 block w-full min-w-0 text-sm" onChange={e => {
      const next = e.target.files?.[0]; setError(''); setFile(null)
      if (!next) return
      if (next.size > 30000000 || !next.name.toLowerCase().endsWith('.pdf')) { setError('Выберите PDF размером до 30 МБ'); return }
      setFile(next); setName(next.name.replace(/\.pdf$/i, ''))
    }} /></label>
    <label className="block text-xs text-p-muted">Название договора<input className="mt-2 block w-full rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text" value={name} maxLength={500} onChange={e => setName(e.target.value)} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Договор относится к студенту «{studentName}», независимо от того, кто его подписал</label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={signed} onChange={e => setSigned(e.target.checked)} />Проверено: договор подписан обеими сторонами</label>
    <p className="text-xs text-p-muted">Источник будет указан как «Загружен вручную». Без подтверждения подписания договор сохранится, создание актов будет недоступно.</p>
    <AppButton colorPrefix="p" variant="subtle" size="sm" type="submit" className={neutralDisabled} disabled={!file || !name.trim() || !confirmed || upload.isPending}>{upload.isPending ? 'Загружаем и читаем PDF…' : 'Загрузить договор'}</AppButton>
    {(error || upload.error) && <p role="alert" className="text-sm text-red-700">{error || getErrorMessage(upload.error)}</p>}
  </form>
}
