import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trustmeApi, type RegistryItem } from '@/api/trustme'
import { AppButton } from '@/components/ui'
import { StudentPickerDialog } from '@/components/shared/StudentPickerDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { documentLink, neutralDisabled, recordNumber } from '@/components/students/contractPresentation'
import { documentTitle } from '@/components/students/actTemplates'

// Договоры TrustMe, которые фоновая синхронизация не привязала сама: совпадение
// не однозначное, студента нет в базе или PDF без текста. Сотрудник выбирает карточку.
const TABS = [['review', 'На проверку'], ['unmatched', 'Студент не найден'], ['unreadable', 'Скан без текста']] as const
const PAGE = 40

export function UnlinkedContracts() {
  const cache = useQueryClient()
  const [tab, setTab] = useState<RegistryItem['decision']>('review')
  const [shown, setShown] = useState(PAGE)
  const [picking, setPicking] = useState<RegistryItem | null>(null)
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
  const registry = useQuery({ queryKey: ['trustme-registry'], queryFn: trustmeApi.registry, retry: false, refetchOnWindowFocus: false })
  const done = () => { cache.invalidateQueries({ queryKey: ['trustme-registry'] }); cache.invalidateQueries({ queryKey: ['acts-table'] }) }
  const link = useMutation({ mutationFn: ({ item, studentId }: { item: RegistryItem; studentId: string }) => trustmeApi.registryLink(item.id, studentId),
    onSuccess: () => { setPicking(null); done() }, onError: () => setPicking(null), retry: false })
  const dismiss = useMutation({ mutationFn: (item: RegistryItem) => trustmeApi.registryDismiss(item.id), onSuccess: done, retry: false })
  const pdf = useMutation({ mutationFn: async (item: RegistryItem) => setPreview({ url: URL.createObjectURL(await trustmeApi.registryPdf(item.id)), title: `${recordNumber(item.number)} · ${documentTitle(item.name)}` }), retry: false })
  if (registry.isPending) return <p role="status" className="text-sm text-p-muted">Загружаем непривязанные договоры…</p>
  if (registry.error) return <p role="alert" className="text-sm text-red-700">Не удалось загрузить непривязанные договоры: {getErrorMessage(registry.error)} <button className={documentLink} onClick={() => registry.refetch()}>Повторить</button></p>
  const { counts, items } = registry.data
  if (!items.length) return null
  const activeTab = items.some(i => i.decision === tab) ? tab : TABS.find(([key]) => items.some(i => i.decision === key))![0]
  const list = items.filter(i => i.decision === activeTab)
  const busy = (item: RegistryItem) => (link.isPending && link.variables?.item.id === item.id) || (dismiss.isPending && dismiss.variables?.id === item.id)
  const failed = (item: RegistryItem) => (link.error && link.variables?.item.id === item.id ? link.error : null) || (dismiss.error && dismiss.variables?.id === item.id ? dismiss.error : null)
  return <details className="rounded-xl border border-p-line bg-p-panel" open>
    <summary className="cursor-pointer p-4 text-sm"><span className="font-semibold">Непривязанные договоры TrustMe · {items.length}</span>
      <span className="ml-2 text-p-muted">В реестре привязано: {counts.linked || 0}.</span></summary>
    <div className="border-t border-p-line">
      <div className="flex flex-wrap gap-1 px-4 pt-3">{TABS.map(([key, label]) => { const n = items.filter(i => i.decision === key).length; return <button key={key} type="button" disabled={!n}
        className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${activeTab === key ? 'bg-p-bg font-semibold' : 'text-p-muted'}`} onClick={() => { setTab(key); setShown(PAGE) }}>{label} · {n}</button> })}</div>
      {pdf.error && <p role="alert" className="px-4 pt-3 text-sm text-red-700">{getErrorMessage(pdf.error)}</p>}
      <div className="divide-y divide-p-line">{list.slice(0, shown).map(item => <div key={item.id} className="space-y-2 px-4 py-3 text-sm">
        <p className="break-words font-medium">{recordNumber(item.number)} · {documentTitle(item.name)}</p>
        {(item.student_name || item.customer_name) && <p className="text-xs text-p-muted">В договоре: {[item.student_name && `студент ${item.student_name}`, item.customer_name && `заказчик ${item.customer_name}`].filter(Boolean).join(' · ')}</p>}
        {item.reason && <p className="text-xs text-p-muted">{item.reason}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button className={documentLink} disabled={pdf.isPending} onClick={() => pdf.mutate(item)}>Открыть PDF</button>
          {item.candidates.map(c => <AppButton key={c.id} colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={busy(item)} onClick={() => link.mutate({ item, studentId: c.id })}>{busy(item) && link.variables?.studentId === c.id ? 'Привязываем…' : `Привязать к: ${c.full_name}`}</AppButton>)}
          <button className={documentLink} disabled={busy(item)} onClick={() => { link.reset(); setPicking(item) }}>{item.candidates.length ? 'Другой студент…' : 'Выбрать студента…'}</button>
          <button className={`${documentLink} ml-auto`} disabled={busy(item)} onClick={() => dismiss.mutate(item)}>Не студент — убрать</button>
        </div>
        {failed(item) && <p role="alert" className="text-sm text-red-700">{getErrorMessage(failed(item))}</p>}
      </div>)}</div>
      {list.length > shown && <div className="border-t border-p-line p-3 text-center"><button className={documentLink} onClick={() => setShown(n => n + PAGE)}>Показать ещё · {list.length - shown}</button></div>}
    </div>
    {picking && <StudentPickerDialog open title="К какому студенту привязать договор?" description={`${recordNumber(picking.number)} · ${documentTitle(picking.name)}`} confirmBeforeSelect
      isPending={link.isPending} onClose={() => setPicking(null)} onSelect={studentId => link.mutate({ item: picking, studentId })} />}
    {preview && <Dialog open onOpenChange={open => { if (!open) setPreview(null) }}><DialogContent className="!max-w-5xl"><DialogHeader><DialogTitle>Договор TrustMe</DialogTitle><DialogDescription>{preview.title}</DialogDescription></DialogHeader><iframe title="Договор TrustMe" src={preview.url} className="h-[72dvh] w-full rounded-lg border border-p-line" /></DialogContent></Dialog>}
  </details>
}
