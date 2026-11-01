import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, ArrowRight, Download, ChevronDown } from 'lucide-react'
import { ACT_TEMPLATES, actsApi, type ActRecord, type ActTemplate } from '@/api/acts'
import { trustmeApi, type TrustMeLink } from '@/api/trustme'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { downloadBlob } from '@/lib/utils'
import { StudentTrustMePanel } from './StudentTrustMePanel'
import { ActPreparationDialog } from './ActPreparationDialog'
import { ActMailDialog, MAIL_STATUS } from './ActMailDialog'
import { ACT_CATALOG, displayDate, documentTitle } from './actTemplates'
import { ContractStatus, recordNumber, documentLink, neutralDisabled } from './contractPresentation'

export { MAIL_STATUS } from './ActMailDialog'
const panel = 'border-b border-p-line bg-p-panel'
const input = 'mt-1 block w-full rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm'

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
  const [showArchive, setShowArchive] = useState(false)
  const [editor, setEditor] = useState<{ initial: ActRecord | null; template: ActTemplate } | null>(null)
  const [downloadAs, setDownloadAs] = useState<ActRecord | null>(null)
  const [downloadName, setDownloadName] = useState('')
  const [mailAct, setMailAct] = useState<ActRecord | null>(null)
  const [documentPreview, setDocumentPreview] = useState<string | null>(null)
  const [resolution, setResolution] = useState<{ act: string; attempt: string } | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolutionOutcome, setResolutionOutcome] = useState('sent')
  useEffect(() => () => { if (documentPreview) URL.revokeObjectURL(documentPreview) }, [documentPreview])
  const context = useQuery({ queryKey: ['acts', studentId, financialContractId], queryFn: () => financialContractId ? actsApi.financialContext(financialContractId) : actsApi.context(studentId), retry: false })
  const data = context.data
  const contracts = data?.contracts || []
  const activeContracts = contracts.filter(c => c.status === 3)
  const current = contracts.find(c => c.id === selectedId) || (activeContracts.length === 1 ? activeContracts[0] : contracts.length === 1 ? contracts[0] : null)
  const status = useQuery({ queryKey: ['act-contract-status', studentId, current?.id], queryFn: () => actsApi.checkContract(studentId, current!.id), enabled: !!current, staleTime: 60000, retry: false })
  const currentStatus = status.data?.status ?? current?.status
  const canCreate = manage && !!current && currentStatus === 3 && !status.isPending && !status.error
  const refresh = () => { for (const key of [['acts', studentId], ['acts-registry'], ['portal-acts'], ['finance'], ['trustme-links', studentId]]) cache.invalidateQueries({ queryKey: key }) }
  const action = useMutation({ mutationFn: async ({ type, act, fileName }: { type: string; act: ActRecord; fileName?: string }) => {
    if (type === 'share') { await actsApi.share(act.id); refresh() }
    else downloadBlob(await actsApi.pdf(act.id), fileName || act.file_name || 'Акт.pdf')
  }, retry: false })
  const pdf = useMutation({ mutationFn: async ({ id, view = false }: { id: string; view?: boolean }) => {
    const blob = await actsApi.contractPdf(studentId, id)
    if (view) setDocumentPreview(URL.createObjectURL(blob)); else downloadBlob(blob, `Договор-${data?.student_name || ''}.pdf`)
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
  const archive = contracts.filter(c => c.status !== 3)
  const error = action.error || pdf.error || assign.error || selectNew.error
  const renderHistory = (records: ActRecord[]) => records.map(act => <article key={act.id} className="space-y-4 border-t border-p-line py-5 first:border-t-0">
    <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-p-bg text-p-text"><FileText size={21} /></span><div className="min-w-0 flex-1"><p className="break-words text-base font-semibold leading-snug text-p-text">{act.file_name || `${ACT_TEMPLATES[act.template]} · ${act.student_name || data.student_name}`}</p><p className="mt-1.5 text-sm text-p-muted">{displayDate(act.snapshot.period_start)} — {displayDate(act.snapshot.period_end)}{act.author_name ? ` · ${act.author_name}` : ''}{act.supersedes_id ? ' · Новая версия' : ''}</p></div><span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${act.status === 'draft' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{act.status === 'draft' ? 'Черновик' : 'PDF готов'}</span></div>
    <div className="flex flex-wrap items-center gap-2 sm:pl-[52px]">
      {act.status === 'ready' && <AppButton colorPrefix="p" variant="subtle" size="sm" className={`!text-p-text ${neutralDisabled}`} disabled={action.isPending} onClick={() => action.mutate({ type: 'download', act })}><Download size={14} />Скачать акт</AppButton>}
      {act.status === 'ready' && <button className={`${documentLink} !text-p-text`} onClick={() => { action.reset(); setDownloadAs(act); setDownloadName((act.file_name || 'Акт.pdf').replace(/\.pdf$/i, '')) }}>Скачать как…</button>}
      {manage && canCreate && act.snapshot.contract_link_id === current?.id && <AppButton colorPrefix="p" variant="subtle" size="sm" className="!text-p-text" onClick={() => setEditor({ initial: act, template: act.template })}>{act.status === 'draft' ? 'Дополнить черновик' : 'Новая версия'}</AppButton>}
      {manage && act.status === 'ready' && !act.shared && <AppButton colorPrefix="p" variant="subtle" size="sm" className={`!text-p-text ${neutralDisabled}`} disabled={action.isPending} onClick={() => action.mutate({ type: 'share', act })}>Открыть студенту</AppButton>}
      {act.shared && <span className="text-xs font-medium text-emerald-700">Доступен студенту</span>}
      {manage && can('acts_mail', 'manage') && act.status === 'ready' && <AppButton colorPrefix="p" variant="subtle" size="sm" className={`!text-p-text ${neutralDisabled}`} title={!data.mail_configured ? 'Отправка по почте недоступна' : undefined} disabled={!data.mail_configured || act.mail.some(m => ['sending','unknown'].includes(m.status))} onClick={() => setMailAct(act)}>Отправить по почте</AppButton>}
    </div>
    {!!act.mail.length && <ul className="space-y-1 text-xs text-p-muted sm:pl-[52px]">{act.mail.map(m => <li key={m.id} className="break-words">{displayDate(m.created_at)} · {m.recipient} · {MAIL_STATUS[m.status] || m.status}{manage && can('acts_mail','manage') && ['sending','unknown'].includes(m.status) && <button className="ml-2 underline" onClick={() => { resolve.reset(); setResolution({ act:act.id, attempt:m.id }); setResolutionNote('') }}>Уточнить результат</button>}</li>)}</ul>}
  </article>)
  return <div className="min-w-0 space-y-6 text-p-text">
    {!current && !choosing ? <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <p className="text-sm text-p-muted">{activeContracts.length > 1 ? 'Выберите договор студента' : 'Договор не привязан'}</p>
      {can('contracts','manage') && <AppButton colorPrefix="p" variant="subtle" size="sm" aria-expanded={choosing} onClick={() => setChoosing(true)} disabled={choosing}>Привязать договор</AppButton>}
      {!can('contracts','manage') && <p className="text-xs text-p-muted">Договор привяжет сотрудник с правом управления договорами.</p>}
    </div> : current ? <section className="border-b border-p-line pb-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 break-words text-sm font-semibold">{documentTitle(current.name)}</h3><span className="text-xs text-p-muted">{recordNumber(current.legal_number || current.number)}</span><ContractStatus status={currentStatus} /></div>
      <p className="mt-2 text-xs text-p-muted">{displayDate(current.contract_date)} · Подписант: {current.signers.filter(s => !s.is_company).map(s => s.name).filter(Boolean).join(', ') || 'Не указан'}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1"><button className={documentLink} disabled={pdf.isPending} onClick={() => pdf.mutate({ id: current.id, view: true })}>Открыть PDF</button>{can('contracts','manage') && <button className={documentLink} onClick={() => setChoosing(true)}>Сменить</button>}</div>
      {status.isPending && <p role="status" className="mt-2 text-xs text-p-muted">Проверяем статус договора…</p>}
      {status.error && <p role="alert" className="mt-2 text-xs text-amber-800">Не удалось проверить статус договора. <button className="underline" onClick={() => status.refetch()}>Повторить</button></p>}
      {!status.isPending && !status.error && currentStatus !== 3 && <p className="mt-2 text-xs text-p-muted">Создание актов недоступно: нужен подписанный действующий договор. История сохранена.</p>}
    </section> : null}
    {choosing && <section aria-label="Выбор договора" className="min-w-0 border-b border-p-line pb-5">
      <div className="mb-4 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{current ? 'Сменить договор' : 'Привязать договор'}</h3><button className={documentLink} onClick={() => setChoosing(false)}>Отмена</button></div>
      <StudentTrustMePanel studentId={studentId} studentName={data.student_name} canManage={can('contracts','manage')} onSelected={link => selectNew.mutate(link)} onChanged={refresh} />
      {selectNew.error && <p role="alert" className="py-3 text-sm text-red-700">{getErrorMessage(selectNew.error)}</p>}
    </section>}
    {!!data.unassigned_contracts?.length && <details className={panel}><summary className="cursor-pointer p-4 text-sm font-medium">Нужно сопоставить с финансовым договором · {data.unassigned_contracts.length}</summary><div className="divide-y divide-p-line border-t border-p-line">{data.unassigned_contracts.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="break-words text-sm">{documentTitle(c.name)}</p><button className="mt-1 text-xs text-p-muted underline" onClick={() => pdf.mutate({ id:c.id,view:true })}>Просмотреть PDF</button></div>{can('contracts','manage') && <AppButton colorPrefix="p" variant="subtle" size="sm" disabled={assign.isPending} onClick={() => assign.mutate(c.id)}>Сопоставить с этим договором</AppButton>}</div>)}</div></details>}
    {current && !choosing && manage && <section><h3 className="mb-1 text-sm font-semibold">Создать акт по шаблону</h3><p className="mb-3 text-xs text-p-muted">Реквизиты — из договора. Период и выполненные услуги — от вас.</p><div className="divide-y divide-p-line">{ACT_CATALOG.map(t => {
      const existing = history.filter(a => a.template === t.id)
      const reason = !canCreate ? status.isPending ? 'Проверяем статус договора' : status.error ? 'Сначала повторите проверку статуса договора' : 'Для создания акта нужен подписанный действующий договор' : ''
      return <article key={t.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0 flex-1 basis-48"><h4 className="text-sm font-medium">{t.title}</h4><p className="mt-1 text-xs leading-relaxed text-p-muted">{t.description}</p>{!!existing.length && <p className="mt-1 text-[11px] text-p-muted">Готово: {existing.filter(a => a.status === 'ready').length} · Черновики: {existing.filter(a => a.status === 'draft').length}</p>}</div><div className="max-w-full"><AppButton colorPrefix="p" size="sm" className={neutralDisabled} aria-label={`Создать акт: ${t.title}`} title={reason || undefined} disabled={!canCreate} onClick={() => setEditor({ initial: null, template: t.id })}>Создать акт <ArrowRight size={13} /></AppButton>{reason && <p className="mt-1 max-w-52 text-xs text-p-muted">{reason}</p>}</div></article>
    })}</div></section>}
    {!!archive.length && <div><button className="flex items-center gap-2 text-xs text-p-muted" onClick={() => setShowArchive(!showArchive)}><ChevronDown size={14} />{showArchive ? 'Скрыть' : 'Показать'} архив договоров · {archive.length}</button>{showArchive && <div className={`${panel} mt-3 divide-y divide-p-line`}>{archive.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><p className="min-w-0 break-words text-sm text-p-muted">{documentTitle(c.name)} · <ContractStatus status={c.status} /></p><button className="text-xs underline" onClick={() => { setSelectedId(c.id); setShowArchive(false) }}>История и PDF</button></div>)}</div>}</div>}
    {current && !choosing && <section><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">История актов</h3><span className="text-xs text-p-muted">{history.length}</span></div><div className={panel}>{history.length ? renderHistory(history) : <div className="p-5 text-sm text-p-muted">{current ? 'Готовые PDF и сохранённые черновики появятся здесь.' : 'Сначала выберите договор, чтобы подготовить акт.'}</div>}</div>{!!otherActs.length && <details className={`${panel} mt-3`}><summary className="cursor-pointer p-4 text-sm text-p-muted">Акты других договоров · {otherActs.length}</summary>{renderHistory(otherActs)}</details>}</section>}
    {error && <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{getErrorMessage(error, 'Не удалось выполнить действие')}</p>}
    {editor && current && <ActPreparationDialog studentId={studentId} studentName={data.student_name} contract={current} template={editor.template} initial={editor.initial} onClose={() => setEditor(null)} onSaved={refresh} />}
    {documentPreview && <Dialog open onOpenChange={open => { if (!open) setDocumentPreview(null) }}><DialogContent className="!max-w-5xl"><DialogHeader><DialogTitle>Договор студента</DialogTitle><DialogDescription>PDF из TrustMe</DialogDescription></DialogHeader><iframe title="Договор TrustMe PDF" src={documentPreview} className="h-[72dvh] w-full rounded-lg border border-p-line" /></DialogContent></Dialog>}
    {downloadAs && <Dialog open onOpenChange={open => { if (!open && !action.isPending) setDownloadAs(null) }}><DialogContent><DialogHeader><DialogTitle>Скачать под другим именем</DialogTitle><DialogDescription>Название в истории и в отправляемых письмах сохранится.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={async e => {
      e.preventDefault()
      const name = downloadName.trim().replace(/\.pdf$/i, '')
      if (!name || /[\x00-\x1f\x7f/\\:*?"<>|]/.test(name) || action.isPending) return
      try { await action.mutateAsync({ type: 'download', act: downloadAs, fileName: `${name}.pdf` }); setDownloadAs(null) } catch { /* Mutation error is displayed below. */ }
    }}><label className="block text-sm font-medium">Название файла<div className="mt-2 flex items-center gap-2"><input aria-label="Название файла" autoFocus className={`${input} !mt-0 min-w-0 flex-1`} required maxLength={180} value={downloadName} onChange={e => setDownloadName(e.target.value)} /><span className="text-sm text-p-muted">.pdf</span></div></label>{/[\x00-\x1f\x7f/\\:*?"<>|]/.test(downloadName) && <p className="text-xs text-red-700">Уберите служебные символы из названия файла.</p>}<div className="flex justify-end gap-3"><button className={documentLink} type="button" disabled={action.isPending} onClick={() => setDownloadAs(null)}>Отмена</button><AppButton colorPrefix="p" variant="subtle" size="sm" type="submit" disabled={action.isPending || !downloadName.trim().replace(/\.pdf$/i, '') || /[\x00-\x1f\x7f/\\:*?"<>|]/.test(downloadName)}>{action.isPending ? 'Скачиваем…' : 'Скачать'}</AppButton></div>{action.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(action.error, 'Не удалось скачать PDF')}</p>}</form></DialogContent></Dialog>}
    {mailAct && <ActMailDialog act={mailAct} recipients={data.recipient_suggestions} onClose={() => setMailAct(null)} onSent={refresh} />}
    {resolution && <Dialog open onOpenChange={open => { if (!open && !resolve.isPending) setResolution(null) }}><DialogContent><DialogHeader><DialogTitle>Уточнить результат отправки</DialogTitle><DialogDescription>Сначала проверьте корпоративный ящик. Повтор разрешается только после подтверждения, что письмо не отправлено.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!resolve.isPending) resolve.mutate() }}><label className="block text-sm">Результат проверки<select className={input} value={resolutionOutcome} onChange={e => setResolutionOutcome(e.target.value)}><option value="sent">Письмо отправлено</option><option value="not_sent">Письмо не отправлено</option></select></label><label className="block text-sm">Как проверили<textarea className={input} minLength={10} maxLength={1000} required value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} /></label><AppButton colorPrefix="p" variant="subtle" type="submit" disabled={resolve.isPending}>Сохранить результат</AppButton>{resolve.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(resolve.error)}</p>}</form></DialogContent></Dialog>}
  </div>
}
