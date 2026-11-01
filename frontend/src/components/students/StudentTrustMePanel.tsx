import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { trustmeApi, type TrustMeCandidate, type TrustMeLink } from '@/api/trustme'
import { guardiansApi } from '@/api'
import { actsApi } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorCode, getErrorMessage } from '@/lib/errorMessage'
import { documentTitle, displayDate } from './actTemplates'
import { ContractStatus, recordNumber, identityMatch, documentLink, neutralDisabled } from './contractPresentation'

const input = 'block w-full min-w-0 rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text focus:outline-none focus:ring-2 focus:ring-p-accent/15'
export function StudentTrustMePanel({ studentId, studentName, canManage, onChanged, onSelected }: {
  studentId: string; studentName: string; canManage: boolean; onChanged?: () => void; onSelected?: (link: TrustMeLink) => void
}) {
  const cache = useQueryClient()
  const [query, setQuery] = useState(studentName)
  const [aliases, setAliases] = useState('')
  const [extraOpen, setExtraOpen] = useState(false)
  const [criteria, setCriteria] = useState({ query: studentName, aliases: [] as string[] })
  const [showUnsigned, setShowUnsigned] = useState(false)
  const [selected, setSelected] = useState<TrustMeCandidate | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  const links = useQuery({ queryKey: ['trustme-links', studentId], queryFn: () => trustmeApi.list(studentId), retry: false })
  const guardians = useQuery({ queryKey: ['guardians', studentId], queryFn: () => guardiansApi.listByStudent(studentId), enabled: canManage, retry: false })
  const search = useQuery({ queryKey: ['trustme-candidates', studentId, criteria], queryFn: () => trustmeApi.search(studentId, criteria.query, criteria.aliases), enabled: canManage, staleTime: 15*60*1000, retry: false })
  const choose = useMutation({ mutationFn: async (item: TrustMeCandidate) => {
    const existing = links.data?.find(c => c.short_url === item.short_url)
    return existing || await trustmeApi.link(studentId, item.short_url!)
  }, onSuccess: item => {
    for (const key of [['trustme-links', studentId], ['acts', studentId], ['acts-registry']]) cache.invalidateQueries({ queryKey: key })
    setSelected(null); setConfirmed(false); onChanged?.(); onSelected?.(item)
  }, retry: false })
  const preview = useMutation({ mutationFn: async (item: TrustMeCandidate) => {
    const existing = links.data?.find(c => c.short_url === item.short_url)
    const blob = existing ? await actsApi.contractPdf(studentId, existing.id) : await trustmeApi.pdf(studentId, item.short_url!)
    setPreviewUrl(URL.createObjectURL(blob))
  }, retry: false })
  const error = search.error || links.error || choose.error || preview.error
  const names = [studentName, ...(guardians.data || []).map(g => g.full_name), ...criteria.aliases]
  const all = [...(links.data || []), ...(search.data?.candidates || []).filter(c => !(links.data || []).some(l => l.short_url === c.short_url))]
  const visible = all.filter(c => showUnsigned || c.status === 3)
  const matching = visible.filter(c => identityMatch(c, names))
  const others = visible.filter(c => !identityMatch(c, names))
  function row(item: TrustMeCandidate, index: number) {
    const people = [...item.signers].sort((a,b) => Number(a.is_company) - Number(b.is_company))
    return <div key={item.short_url || item.external_id || index} className="min-w-0 border-b border-p-line py-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-words text-sm font-semibold">{documentTitle(item.name)}</span><ContractStatus status={item.status} /></div>
      <p className="mt-1 text-xs text-p-muted">{recordNumber(item.number)} · {displayDate(item.created_at)}</p>
      <div className="mt-2 space-y-1">{people.map((s,i) => <p key={i} className="break-words text-xs text-p-muted">{s.is_company ? 'Компания' : 'Подписант'}: <span className="text-p-text">{s.name || 'Не указан'}</span> · {s.signed ? 'подписал' : 'не подписал'}</p>)}</div>
      <div className="mt-2 flex flex-wrap items-center justify-end gap-4"><button className={documentLink} disabled={preview.isPending || !item.short_url} onClick={() => preview.mutate(item)}>Открыть PDF</button>{canManage && <AppButton colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={item.status !== 3 || !item.short_url || choose.isPending || links.isPending || !!links.error} title={item.status !== 3 ? 'Можно привязать только подписанный договор' : !item.short_url ? 'PDF договора недоступен' : undefined} onClick={() => { setSelected(item); setConfirmed(false); choose.reset() }}>Выбрать</AppButton>}</div>
      {item.status !== 3 && <p className="mt-1 text-right text-xs text-p-muted">Для привязки нужен подписанный договор</p>}
    </div>
  }
  return <div className="min-w-0 text-p-text">
    {canManage && <form className="shrink-0 space-y-3 border-b border-p-line pb-5" onSubmit={e => { e.preventDefault(); const next = { query: query.trim() || studentName, aliases: aliases.split('\n').map(s => s.trim()).filter(Boolean).slice(0,6) }; setSelected(null); setCriteria(next); if (JSON.stringify(next) === JSON.stringify(criteria)) search.refetch() }}>
      <label className="block text-xs text-p-muted">ФИО студента или родителя<input className={`${input} mt-2`} value={query} onChange={e => setQuery(e.target.value)} maxLength={500} /></label>
      <div className="flex items-center justify-between gap-3"><button type="button" className={documentLink} onClick={() => setExtraOpen(!extraOpen)} aria-expanded={extraOpen}>{extraOpen ? '− скрыть другое написание' : '+ другое написание'}</button><AppButton colorPrefix="p" variant="subtle" size="sm" type="submit" className={neutralDisabled} disabled={search.isFetching}><Search size={14} />{search.isFetching ? 'Ищем…' : 'Найти'}</AppButton></div>
      {extraOpen && <label className="block text-xs text-p-muted">Другие написания — по одному в строке<textarea className={`${input} mt-2`} rows={2} maxLength={3000} value={aliases} onChange={e => setAliases(e.target.value)} /></label>}
      <p className="text-xs leading-relaxed text-p-muted">Учитываем ФИО студента и родителей из карточки. Перед привязкой проверьте стороны в PDF.</p>
    </form>}
    {error && <div role="alert" className="py-3 text-sm text-red-700">{getErrorMessage(error, 'Не удалось загрузить договоры')} <button className="underline" onClick={() => { search.refetch(); links.refetch() }}>Повторить</button>{getErrorCode(error) === 'TRUSTME_CHALLENGE_REQUIRED' && <a className="ml-2 underline" href="https://trustme.kz/app/sign-in" target="_blank" rel="noopener noreferrer">Открыть TrustMe</a>}</div>}
    <div className="min-w-0">
      <label className="flex items-center gap-2 py-4 text-xs text-p-muted"><input type="checkbox" checked={showUnsigned} onChange={e => setShowUnsigned(e.target.checked)} />Показать неподписанные и отозванные</label>
      {(search.isFetching || links.isPending) && <p role="status" className="py-3 text-sm text-p-muted">Ищем договоры…</p>}
      {!search.isFetching && !links.isPending && <><h3 className="text-xs font-semibold text-p-muted">Совпадения по ФИО · {matching.length}</h3>{matching.map(row)}{!matching.length && <p className="py-4 text-sm text-p-muted">Уверенных совпадений нет. Уточните ФИО родителя или проверьте другие результаты.</p>}
      {!!others.length && <details className="border-t border-p-line"><summary className="cursor-pointer py-4 text-sm text-p-muted">Другие результаты · {others.length}</summary><p className="pb-2 text-xs text-p-muted">Совпадение только по имени может относиться к другому студенту.</p>{others.map(row)}</details>}</>}
      {guardians.error && <p className="py-2 text-xs text-p-muted">Не удалось загрузить ФИО родителей. Их можно указать в поиске вручную.</p>}
      {search.data?.truncated && <p className="py-3 text-xs text-amber-800">Показана часть результатов. Уточните фамилию и имя.</p>}
    </div>
    {selected && <div className="shrink-0 space-y-3 border-t border-p-line bg-p-panel py-4"><p className="break-words text-sm font-semibold">{documentTitle(selected.name)}</p><label className="flex items-start gap-3 text-sm leading-relaxed"><input type="checkbox" className="mt-1 shrink-0" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Проверено по PDF: договор относится к студенту «{studentName}» или его родителю.</label><div className="flex justify-end gap-3"><button className={documentLink} disabled={choose.isPending} onClick={() => setSelected(null)}>Отмена</button><AppButton colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={!confirmed || choose.isPending} onClick={() => choose.mutate(selected)}>Привязать договор</AppButton></div>{!confirmed && <p className="text-xs text-p-muted">Для привязки подтвердите соответствие договора студенту.</p>}</div>}
    {previewUrl && <Dialog open onOpenChange={open => { if (!open) setPreviewUrl(null) }}><DialogContent className="!w-[calc(100vw-1rem)] !max-w-5xl"><DialogHeader><DialogTitle>Проверить договор</DialogTitle><DialogDescription>Сверьте студента, подписанта и условия услуг.</DialogDescription></DialogHeader><iframe title="PDF договора TrustMe" src={previewUrl} className="h-[70dvh] w-full border-0" /></DialogContent></Dialog>}
  </div>
}
