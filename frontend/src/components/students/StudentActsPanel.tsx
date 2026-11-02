import { AutomaticContracts } from './AutomaticContracts'
import { ContractDetailsEditor } from './ContractDetailsEditor'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Send, MoreHorizontal, Plus } from 'lucide-react'
import { ACT_TEMPLATES, actsApi, type ActRecord } from '@/api/acts'
import { trustmeApi, type TrustMeLink } from '@/api/trustme'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { downloadBlob } from '@/lib/utils'
import { StudentTrustMePanel } from './StudentTrustMePanel'
import { ActPreparationDialog } from './ActPreparationDialog'
import { ActMailDialog, MAIL_STATUS } from './ActMailDialog'
import { displayDate, documentTitle } from './actTemplates'
import { ContractStatus, recordNumber, documentLink, neutralDisabled } from './contractPresentation'

export { MAIL_STATUS } from './ActMailDialog'
const panel = 'border-b border-p-line bg-p-panel'
const input = 'mt-1 block w-full rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm'
const invalidDownloadName = (value: string) => [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || '/\\:*?"<>|'.includes(char))

type PanelProps = { studentId: string; financialContractId?: string }
export function StudentActsPanel(props: PanelProps) {
  return <StudentActsWorkspace key={`${props.studentId}:${props.financialContractId || ''}`} {...props} />
}
function StudentActsWorkspace({ studentId, financialContractId }: PanelProps) {
  const { can } = useAuth()
  const cache = useQueryClient()
  const manage = can('acts', 'manage')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [editor, setEditor] = useState<{ initial: ActRecord | null } | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [viewError, setViewError] = useState('')
  const [downloadAs, setDownloadAs] = useState<ActRecord | null>(null)
  const [downloadName, setDownloadName] = useState('')
  const [mailAct, setMailAct] = useState<ActRecord | null>(null)
  const [documentPreview, setDocumentPreview] = useState<{ url: string; title: string; description: string } | null>(null)
  const [resolution, setResolution] = useState<{ act: string; attempt: string } | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [editingContract, setEditingContract] = useState(false)
  const [resolutionOutcome, setResolutionOutcome] = useState('sent')
  useEffect(() => () => { if (documentPreview) URL.revokeObjectURL(documentPreview.url) }, [documentPreview])
  const context = useQuery({ queryKey: ['acts', studentId, financialContractId], queryFn: () => financialContractId ? actsApi.financialContext(financialContractId) : actsApi.context(studentId), retry: false })
  const data = context.data
  const contracts = data?.contracts || []
  const activeContracts = contracts.filter(c => c.status === 3)
  const current = contracts.find(c => c.id === selectedId) || [...activeContracts].sort((a, b) => (b.contract_date || b.signed_date || '').localeCompare(a.contract_date || a.signed_date || ''))[0] || contracts[0] || null
  const status = useQuery({ queryKey: ['act-contract-status', studentId, current?.id], queryFn: () => actsApi.checkContract(studentId, current!.id), enabled: !!current, staleTime: 60000, retry: false })
  const currentStatus = status.data?.status ?? current?.status
  const canCreate = manage && !!current && currentStatus === 3 && !status.isPending && !status.error
  const refresh = () => { for (const key of [['act-contract-status', studentId], ['contract-requisites', studentId], ['contract-details', studentId], ['acts', studentId], ['acts-registry'], ['acts-table'], ['portal-acts'], ['finance'], ['trustme-links', studentId]]) cache.invalidateQueries({ queryKey: key }) }
  const action = useMutation({ mutationFn: async ({ type, act, fileName }: { type: string; act: ActRecord; fileName?: string }) => {
    if (type === 'share') { await actsApi.share(act.id); refresh() }
    else downloadBlob(await actsApi.pdf(act.id), fileName || act.file_name || 'Акт.pdf')
  }, retry: false })
  const pdf = useMutation({ mutationFn: async ({ id, view = false }: { id: string; view?: boolean }) => {
    const blob = await actsApi.contractPdf(studentId, id)
    if (view) setDocumentPreview({ url: URL.createObjectURL(blob), title: 'Договор студента', description: 'PDF договора' }); else downloadBlob(blob, `Договор-${data?.student_name || ''}.pdf`)
  }, retry: false })
  const assign = useMutation({ mutationFn: (id: string) => trustmeApi.assignFinancial(studentId, id, financialContractId!), onSuccess: link => { setSelectedId(link.id); refresh() }, retry: false })
  const selectNew = useMutation({ mutationFn: async (link: TrustMeLink) => {
    if (financialContractId && link.financial_contract_id !== financialContractId) await trustmeApi.assignFinancial(studentId, link.id, financialContractId)
    return link
  }, onSuccess: link => { setSelectedId(link.id); setChoosing(false); refresh() }, retry: false })
  const resolve = useMutation({ mutationFn: () => actsApi.resolveMail(resolution!.act, resolution!.attempt, resolutionOutcome, resolutionNote.trim()), onSuccess: () => { refresh(); setResolution(null); setResolutionNote('') }, retry: false })
  if (context.isPending) return <div role="status" className={`${panel} p-6 text-sm text-p-muted`}>Загружаем договоры и акты…</div>
  if (context.error || !data) return <div role="alert" className={`${panel} p-5`}><p className="text-sm">{getErrorMessage(context.error, 'Не удалось загрузить документы')}</p><AppButton className="mt-3" colorPrefix="p" variant="subtle" size="sm" onClick={() => context.refetch()}>Повторить</AppButton></div>
  const history = data.acts.filter(a => !current || a.snapshot.contract_link_id === current.id)
  const otherActs = current ? data.acts.filter(a => a.snapshot.contract_link_id !== current.id) : []
  const error = action.error || pdf.error || assign.error || selectNew.error
  const viewAct = async (act: ActRecord) => {
    try { setDocumentPreview({ url: URL.createObjectURL(await actsApi.pdf(act.id)), title: act.file_name || 'Акт', description: 'Сохранённый PDF акта' }) }
    catch (e) { setViewError(getErrorMessage(e, 'Не удалось открыть PDF')) }
  }
  const sorted = (records: ActRecord[]) => [...records].sort((a, b) => Number(b.id === fresh) - Number(a.id === fresh))
  const sentMail = (act: ActRecord) => act.mail.some(m => ['sent','confirmed_sent'].includes(m.status))
  const closeMenu = (e: { currentTarget: HTMLElement }) => e.currentTarget.closest('details')?.removeAttribute('open')
  const menuItem = `${documentLink} w-full px-3 !text-p-text`
  const actionButton = 'w-36 justify-center'
  const renderHistory = (records: ActRecord[]) => sorted(records).map(act => <article key={act.id} className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-p-line py-3 pl-4 pr-12 first:border-t-0 sm:flex-nowrap ${act.id === fresh ? 'bg-p-bg ring-2 ring-inset ring-amber-300' : ''}`}>
    <span className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg bg-p-bg text-p-text sm:grid"><FileText size={18} /></span>
    <div className="min-w-0 flex-1 basis-60">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{act.status === 'ready'
        ? <button className="min-w-0 break-words text-left text-sm font-semibold leading-snug text-p-text hover:underline" title="Открыть PDF" onClick={() => viewAct(act)}>{act.file_name || ACT_TEMPLATES[act.template]}</button>
        : <p className="min-w-0 break-words text-sm font-semibold leading-snug text-p-text">{`${ACT_TEMPLATES[act.template]} · ${act.student_name || data.student_name}`}</p>}
        <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${act.status === 'draft' ? 'bg-amber-50 text-amber-800' : sentMail(act) ? 'bg-sky-50 text-sky-700' : 'bg-emerald-50 text-emerald-800'}`}>{act.status === 'draft' ? 'Черновик' : sentMail(act) ? 'Отправлен' : 'Готов'}</span>
        {act.shared && <span className="text-[11px] font-medium text-emerald-700">Доступен студенту</span>}</div>
      <p className="mt-0.5 truncate text-xs text-p-muted" title={act.snapshot.lines.map(l => l.name).join(', ')}>{act.snapshot.lines.map(l => l.name).join(', ') || 'Услуги не выбраны'} · {displayDate(act.snapshot.period_start)} — {displayDate(act.snapshot.period_end)}{act.supersedes_id ? ' · Новая версия' : ''}</p>
      {!!act.mail.length && <ul className="mt-0.5 space-y-0.5 text-xs text-p-muted">{act.mail.map(m => <li key={m.id} className="break-words">{displayDate(m.created_at)} · {m.recipient} · {MAIL_STATUS[m.status] || m.status}{manage && can('acts_mail','manage') && ['sending','unknown'].includes(m.status) && <button className="ml-2 underline" onClick={() => { resolve.reset(); setResolution({ act:act.id, attempt:m.id }); setResolutionNote('') }}>Уточнить результат</button>}</li>)}</ul>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {act.status === 'draft' && manage && canCreate && act.snapshot.contract_link_id === current?.id && <AppButton colorPrefix="p" size="sm" className={actionButton} onClick={() => setEditor({ initial: act })}>Продолжить</AppButton>}
      {manage && can('acts_mail', 'manage') && act.status === 'ready' && <AppButton colorPrefix="p" size="sm" className={`${actionButton} ${neutralDisabled}`} title={!data.mail_configured ? 'Отправка по почте не настроена' : undefined} disabled={!data.mail_configured || act.mail.some(m => ['sending','unknown'].includes(m.status))} onClick={() => setMailAct(act)}><Send size={14} />Отправить</AppButton>}
      {act.status === 'ready' && <details className="absolute right-2 top-2"><summary aria-label="Другие действия" className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-p-muted hover:bg-p-bg [&::-webkit-details-marker]:hidden"><MoreHorizontal size={18} /></summary><div className="absolute right-0 z-20 mt-1 flex w-52 flex-col items-start rounded-lg border border-p-line bg-p-panel p-1 shadow-lg">
        <button className={menuItem} onClick={e => { closeMenu(e); viewAct(act) }}>Посмотреть</button>
        <button className={menuItem} disabled={action.isPending} onClick={e => { closeMenu(e); action.mutate({ type: 'download', act }) }}>Скачать</button>
        <button className={menuItem} onClick={e => { closeMenu(e); action.reset(); setDownloadAs(act); setDownloadName((act.file_name || 'Акт.pdf').replace(/\.pdf$/i, '')) }}>Скачать как…</button>
        {manage && !act.shared && <button className={menuItem} disabled={action.isPending} onClick={e => { closeMenu(e); action.mutate({ type: 'share', act }) }}>Открыть студенту</button>}
        {manage && canCreate && act.snapshot.contract_link_id === current?.id && <button className={menuItem} onClick={e => { closeMenu(e); setEditor({ initial: act }) }}>Новая версия</button>}
      </div></details>}
    </div>
  </article>)
  const others = contracts.filter(c => c.id !== current?.id)
  const signer = current ? current.customer_name || current.signers.filter(s => !s.is_company).map(s => s.name).filter(Boolean).join(', ') : ''
  const createReason = !current ? '' : status.isPending ? 'Проверяем статус договора…' : status.error ? 'Не удалось проверить статус договора' : currentStatus !== 3 ? 'Акт можно создать только по подписанному договору' : ''
  return <div className="min-w-0 space-y-6 text-p-text">
    {can('contracts', 'manage') && !financialContractId && <AutomaticContracts studentId={studentId} onChanged={refresh} linkedShortUrls={contracts.map(c => c.short_url)} />}
    {!current && !choosing ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-p-line p-5">
      <p className="text-sm text-p-muted">Договор пока не привязан. После привязки здесь можно будет создавать акты.</p>
      {can('contracts','manage') && <AppButton colorPrefix="p" variant="subtle" size="sm" aria-expanded={choosing} onClick={() => setChoosing(true)} disabled={choosing}>Добавить вручную</AppButton>}
      {!can('contracts','manage') && <p className="text-xs text-p-muted">Договор привяжет сотрудник с правом управления договорами.</p>}
    </div> : current ? <section aria-label="Договор" className="rounded-xl border border-p-line bg-p-panel p-4 sm:p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-p-muted">Договор для актов</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><h3 className="min-w-0 break-words text-base font-semibold">{recordNumber(current.legal_number || current.number)}</h3><ContractStatus status={currentStatus} source={current.source} /></div>
      <p className="mt-1 break-words text-sm text-p-text">{documentTitle(current.name)}</p>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3"><div><dt className="text-p-muted">Дата договора</dt><dd className="font-medium">{current.contract_date ? displayDate(current.contract_date) : 'не указана'}</dd></div><div><dt className="text-p-muted">Подписан</dt><dd className="font-medium">{(status.data?.signed_date || current.signed_date) ? displayDate(status.data?.signed_date || current.signed_date) : 'дата не указана'}{(status.data?.signed_date_source || current.signed_date_source) === 'manual' ? ' (вручную)' : ''}</dd></div><div><dt className="text-p-muted">Заказчик</dt><dd className="break-words font-medium">{signer || 'Не указан'}</dd></div></dl>
      {current.source === 'manual' && <p className="mt-2 text-xs text-p-muted">Загружен вручную · {current.status === 3 ? 'подписи подтверждены сотрудником' : 'подписи не подтверждены'}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-p-line pt-2"><button className={`${documentLink} !text-p-text`} disabled={pdf.isPending} onClick={() => pdf.mutate({ id: current.id, view: true })}>Открыть PDF</button>{can('contracts','manage') && <details className="relative ml-auto"><summary aria-label="Действия с договором" className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-lg text-p-muted hover:bg-p-bg [&::-webkit-details-marker]:hidden"><MoreHorizontal size={18} /></summary><div className="absolute right-0 z-20 mt-1 flex w-52 flex-col items-start rounded-lg border border-p-line bg-p-panel p-1 shadow-lg"><button className={`${documentLink} w-full px-3 !text-p-text`} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); setEditingContract(!editingContract) }}>Проверить реквизиты</button><button className={`${documentLink} w-full px-3 !text-p-text`} onClick={e => { e.currentTarget.closest('details')?.removeAttribute('open'); setChoosing(true) }}>Добавить договор</button></div></details>}</div>
      {!!others.length && <details className="mt-2"><summary className="cursor-pointer py-1 text-xs font-medium text-p-muted">Другие договоры студента · {others.length}</summary><div className="divide-y divide-p-line">{others.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{recordNumber(c.legal_number || c.number)} · {documentTitle(c.name)}</p><p className="mt-1 text-xs text-p-muted">{c.source === 'manual' ? 'Загружен вручную' : 'TrustMe'} · Дата договора: {c.contract_date ? displayDate(c.contract_date) : 'не указана'}</p></div><div className="flex items-center gap-3"><ContractStatus status={c.status} source={c.source} /><button className={documentLink} onClick={() => { setSelectedId(c.id); setEditingContract(false); setChoosing(false) }}>Выбрать для актов</button></div></div>)}</div></details>}
      {editingContract && <ContractDetailsEditor key={current.id} studentId={studentId} contract={{ ...current, created_at: null }} onSaved={refresh} onClose={() => setEditingContract(false)} />}
      {status.error && <p role="alert" className="mt-2 text-xs text-amber-800">Не удалось проверить статус договора. <button className="underline" onClick={() => status.refetch()}>Повторить</button></p>}
    </section> : null}
    {choosing && <section aria-label="Выбор договора" className="min-w-0 border-b border-p-line pb-5">
      <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{current ? 'Добавить договор' : 'Привязать договор'}</h3><button className={documentLink} onClick={() => setChoosing(false)}>Отмена</button></div>
      <StudentTrustMePanel studentId={studentId} studentName={data.student_name} canManage={can('contracts','manage')} onSelected={link => selectNew.mutate(link)} onChanged={refresh} />
      {selectNew.error && <p role="alert" className="py-3 text-sm text-red-700">{getErrorMessage(selectNew.error)}</p>}
    </section>}
    {!!data.unassigned_contracts?.length && <details className={panel}><summary className="cursor-pointer p-4 text-sm font-medium">Нужно сопоставить с финансовым договором · {data.unassigned_contracts.length}</summary><div className="divide-y divide-p-line border-t border-p-line">{data.unassigned_contracts.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-words text-sm">{documentTitle(c.name)}</p><button className="mt-1 text-xs text-p-muted underline" onClick={() => pdf.mutate({ id:c.id,view:true })}>Просмотреть PDF</button></div>{can('contracts','manage') && <AppButton colorPrefix="p" variant="subtle" size="sm" disabled={assign.isPending} onClick={() => assign.mutate(c.id)}>Сопоставить с этим договором</AppButton>}</div>)}</div></details>}
    {current && !choosing && <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Акты{history.length ? ` · ${history.length}` : ''}</h3>{manage && <div className="text-right"><AppButton colorPrefix="p" className={neutralDisabled} disabled={!canCreate} title={createReason || undefined} onClick={() => setEditor({ initial: null })}><Plus size={16} />Создать акт</AppButton>{createReason && <p className="mt-1 text-xs text-p-muted">{createReason}</p>}</div>}</div>
      <div className="rounded-xl border border-p-line bg-p-panel">{history.length ? renderHistory(history) : <div className="p-5 text-sm text-p-muted">{manage ? 'Актов пока нет. Нажмите «Создать акт» и отметьте выполненные услуги — реквизиты подставятся из договора.' : 'Актов пока нет.'}</div>}</div>
      {!!otherActs.length && <details className={`${panel} mt-3`}><summary className="cursor-pointer p-4 text-sm text-p-muted">Акты других договоров · {otherActs.length}</summary>{renderHistory(otherActs)}</details>}
    </section>}
    {(error || viewError) && <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{viewError || getErrorMessage(error, 'Не удалось выполнить действие')}</p>}
    {editor && current && <ActPreparationDialog studentId={studentId} studentName={data.student_name} contract={current} initial={editor.initial} previousActs={data.acts} onClose={() => setEditor(null)} onSaved={id => { if (id) setFresh(id); refresh() }} />}
    {documentPreview && <Dialog open onOpenChange={open => { if (!open) setDocumentPreview(null) }}><DialogContent className="!max-w-5xl"><DialogHeader><DialogTitle>{documentPreview.title}</DialogTitle><DialogDescription>{documentPreview.description}</DialogDescription></DialogHeader><iframe title={documentPreview.title} src={documentPreview.url} className="h-[72dvh] w-full rounded-lg border border-p-line" /></DialogContent></Dialog>}
    {downloadAs && <Dialog open onOpenChange={open => { if (!open && !action.isPending) setDownloadAs(null) }}><DialogContent><DialogHeader><DialogTitle>Скачать под другим именем</DialogTitle><DialogDescription>Название в истории и в отправляемых письмах сохранится.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={async e => {
      e.preventDefault()
      const name = downloadName.trim().replace(/\.pdf$/i, '')
      if (!name || invalidDownloadName(name) || action.isPending) return
      try { await action.mutateAsync({ type: 'download', act: downloadAs, fileName: `${name}.pdf` }); setDownloadAs(null) } catch { /* Mutation error is displayed below. */ }
    }}><label className="block text-sm font-medium">Название файла<div className="mt-2 flex items-center gap-2"><input aria-label="Название файла" autoFocus className={`${input} !mt-0 min-w-0 flex-1`} required maxLength={180} value={downloadName} onChange={e => setDownloadName(e.target.value)} /><span className="text-sm text-p-muted">.pdf</span></div></label>{invalidDownloadName(downloadName) && <p className="text-xs text-red-700">Уберите служебные символы из названия файла.</p>}<div className="flex justify-end gap-3"><button className={documentLink} type="button" disabled={action.isPending} onClick={() => setDownloadAs(null)}>Отмена</button><AppButton colorPrefix="p" variant="subtle" size="sm" type="submit" disabled={action.isPending || !downloadName.trim().replace(/\.pdf$/i, '') || invalidDownloadName(downloadName)}>{action.isPending ? 'Скачиваем…' : 'Скачать'}</AppButton></div>{action.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(action.error, 'Не удалось скачать PDF')}</p>}</form></DialogContent></Dialog>}
    {mailAct && <ActMailDialog act={mailAct} recipients={data.recipient_suggestions} onClose={() => setMailAct(null)} onSent={refresh} />}
    {resolution && <Dialog open onOpenChange={open => { if (!open && !resolve.isPending) setResolution(null) }}><DialogContent><DialogHeader><DialogTitle>Уточнить результат отправки</DialogTitle><DialogDescription>Сначала проверьте корпоративный ящик. Повтор разрешается только после подтверждения, что письмо не отправлено.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!resolve.isPending) resolve.mutate() }}><label className="block text-sm">Результат проверки<select className={input} value={resolutionOutcome} onChange={e => setResolutionOutcome(e.target.value)}><option value="sent">Письмо отправлено</option><option value="not_sent">Письмо не отправлено</option></select></label><label className="block text-sm">Как проверили<textarea className={input} minLength={10} maxLength={1000} required value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} /></label><AppButton colorPrefix="p" variant="subtle" type="submit" disabled={resolve.isPending}>Сохранить результат</AppButton>{resolve.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(resolve.error)}</p>}</form></DialogContent></Dialog>}
  </div>
}
