import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { trustmeApi, type TrustMeCandidate, type TrustMeLink } from '@/api/trustme'
import { AppButton } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { documentTitle, displayDate } from './actTemplates'
import { ContractStatus, recordNumber, documentLink, neutralDisabled } from './contractPresentation'
import { ContractDetailsEditor } from './ContractDetailsEditor'
import { ManualContractUpload } from './ManualContractUpload'

const input = 'block w-full min-w-0 rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text'
/** Exception path only: ordinary documents are discovered without opening this panel. */
export function StudentTrustMePanel({ studentId, studentName, canManage, onChanged, onSelected }: {
  studentId: string; studentName: string; canManage: boolean; onChanged?: () => void; onSelected?: (link: TrustMeLink) => void
}) {
  const cache = useQueryClient()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<TrustMeLink | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  function refresh() {
    cache.invalidateQueries({ queryKey: ['trustme-links', studentId] })
    onChanged?.()
  }
  const lookup = useMutation({ mutationFn: () => trustmeApi.search(studentId, query.trim(), [], 'auto'), retry: false })
  const link = useMutation({ mutationFn: (candidate: TrustMeCandidate) => trustmeApi.link(studentId, candidate.short_url!),
    onSuccess: item => { refresh(); setEditing(item) }, retry: false })
  const pdf = useMutation({ mutationFn: async (candidate: TrustMeCandidate) => { const content = await trustmeApi.pdf(studentId, candidate.short_url!); setPreview(URL.createObjectURL(content)) }, retry: false })
  const error = lookup.error || link.error || pdf.error
  if (!canManage) return <p className="text-sm text-p-muted">Добавление договоров доступно ответственному сотруднику.</p>
  return <div className="min-w-0 space-y-4 text-p-text">
    {editing ? <ContractDetailsEditor key={editing.id} studentId={studentId} contract={editing} onSaved={refresh} onClose={() => { const item = editing; setEditing(null); onSelected?.(item) }} />
      : <><ManualContractUpload studentId={studentId} studentName={studentName} onUploaded={item => { refresh(); setEditing(item) }} />
      <details className="border-t border-p-line"><summary className="cursor-pointer py-3 text-sm text-p-muted">Найти другой договор в TrustMe</summary>
        <form className="space-y-3 pb-4" onSubmit={e => { e.preventDefault(); lookup.mutate() }}>
          <label className="block text-xs text-p-muted">Любые данные договора<input className={`${input} mt-2`} value={query} onChange={e => setQuery(e.target.value)} maxLength={500} placeholder="ФИО, название, номер или ссылка TrustMe" /></label>
          <AppButton colorPrefix="p" variant="subtle" size="sm" type="submit" className={neutralDisabled} disabled={!query.trim() || lookup.isPending}>{lookup.isPending ? 'Ищем…' : 'Найти'}</AppButton>
        </form>
        {lookup.data?.candidates.map((candidate, index) => <div key={candidate.short_url || index} className="min-w-0 space-y-2 border-t border-p-line py-4">
          <div className="flex flex-wrap items-center gap-2"><p className="break-words text-sm font-semibold">{documentTitle(candidate.name)}</p><ContractStatus status={candidate.status} /></div>
          <p className="text-xs text-p-muted">{recordNumber(candidate.legal_number || candidate.number)} · Дата договора: {candidate.contract_date ? displayDate(candidate.contract_date) : 'не указана'}</p>
          {[...candidate.signers].sort((a,b) => Number(a.is_company) - Number(b.is_company)).map((party, i) => <p key={i} className="text-xs text-p-muted">{party.is_company ? 'Компания' : 'Подписант'}: {party.name || 'Не указан'}</p>)}
          <p className="text-xs text-p-muted">Проверьте, что договор относится к этому студенту.</p>
          <div className="flex flex-wrap items-center gap-4"><button className={documentLink} disabled={pdf.isPending || !candidate.short_url} onClick={() => pdf.mutate(candidate)}>Открыть PDF</button><AppButton colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={!candidate.short_url || link.isPending} onClick={() => link.mutate(candidate)}>{link.isPending && link.variables?.short_url === candidate.short_url ? 'Проверяем и привязываем…' : 'Подтвердить и привязать'}</AppButton></div>
          {candidate.status !== 3 && <p className="text-xs text-p-muted">Статус проверим по самому договору при привязке.</p>}
          {link.error && link.variables?.short_url === candidate.short_url && <p role="alert" className="text-sm text-red-700">{getErrorMessage(link.error)}</p>}
        </div>)}
        {lookup.data && !lookup.data.candidates.length && <p className="py-3 text-sm text-p-muted">Договор не найден. Его можно загрузить PDF выше.</p>}
      </details></>}
    {error && error !== link.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(error)}</p>}
    {preview && <div><button className={documentLink} onClick={() => setPreview(null)}>Закрыть PDF</button><iframe title="Оригинал договора" src={preview} className="h-[65dvh] w-full border border-p-line" /></div>}
  </div>
}
