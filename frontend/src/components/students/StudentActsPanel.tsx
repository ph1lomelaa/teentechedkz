import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ACT_TEMPLATES, actsApi, type ActContext, type ActInput, type ActLine, type ActRecord, type ActTemplate, type ContractInspection } from '@/api/acts'
import { useAuth } from '@/contexts/AuthContext'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { StudentTrustMePanel } from './StudentTrustMePanel'
import { getErrorMessage } from '@/lib/errorMessage'
import { downloadBlob } from '@/lib/utils'
import { trustmeApi } from '@/api/trustme'

const control = 'mt-1 w-full rounded-ctl border border-p-line bg-p-panel px-3 py-2 text-sm text-p-text'
const box = 'rounded-card border border-p-line bg-p-panel p-4'
export const MAIL_STATUS: Record<string, string> = { sending: 'Отправка выполняется', sent: 'Принято почтовым сервером', confirmed_sent: 'Отправка подтверждена сотрудником', failed: 'Не отправлено', unknown: 'Результат неизвестен — проверьте почту' }
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty' }).format(new Date())
const emptyLine = (name = ''): ActLine => ({ name, result: '', evidence: '', contract_source: '', quantity: '1', unit: 'услуга', unit_price: null })

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-medium text-p-text">{label}{children}</label>
}

function ActEditor({ studentId, context, initial, onClose, onSaved }: {
  studentId: string; context: ActContext; initial: ActRecord | null; onClose: () => void; onSaved: () => void
}) {
  const [draftId, setDraftId] = useState(initial?.status === 'draft' ? initial.id : null)
  const [form, setForm] = useState<ActInput>(() => initial ? {
    ...initial.snapshot, supersedes_id: initial.status === 'ready' ? initial.id : initial.snapshot.supersedes_id,
    verified: false, full_completion_confirmed: false,
  } : {
    contract_link_id: context.contracts[0]?.id || '', supersedes_id: null, template: 'stages',
    student_name: context.student_name, customer_name: '', customer_id: '', student_id_number: '',
    executor_name: '', executor_representative: '', executor_basis: '', executor_requisites: '',
    contract_number: '', contract_date: '', act_date: today(), city: 'Алматы',
    period_start: today(), period_end: today(), calls_count: null,
    include_amount: false, currency: 'KZT', lines: [emptyLine()], verified: false, full_completion_confirmed: false,
  })
  const [inspection, setInspection] = useState<ContractInspection | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  function change<K extends keyof ActInput>(key: K, value: ActInput[K]) {
    setForm(old => ({ ...old, verified: false, [key]: value }))
    setPreviewUrl(null); setMessage('')
    if (key === 'contract_link_id') setInspection(null)
  }
  const inspect = useMutation({ mutationFn: () => actsApi.inspect(studentId, form.contract_link_id),
    onSuccess: value => setInspection(value), retry: false })
  const meetings = useMutation({ mutationFn: () => actsApi.context(studentId, { period_start: form.period_start, period_end: form.period_end }),
    onSuccess: data => { change('calls_count', data.completed_meetings); setMessage('Подставлены только встречи со статусом «Завершена» за выбранный период. Проверьте, какие относятся к услугам акта.') }, retry: false })
  const save = useMutation({
    mutationFn: async (action: string) => {
      if (action === 'preview') {
        const blob = await actsApi.preview(studentId, form)
        setPreviewUrl(URL.createObjectURL(blob)); return
      }
      const record = draftId ? await actsApi.update(draftId, form) : await actsApi.create(studentId, form)
      setDraftId(record.id)
      onSaved()
      if (action === 'generate') {
        await actsApi.generate(record.id); onSaved(); onClose()
      } else { setMessage('Черновик сохранён. Он доступен в списке актов.'); }
    }, retry: false,
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value || 'draft'
    if (!save.isPending) save.mutate(action)
  }
  const textField = (label: string, key: keyof ActInput, required = true, type = 'text', maxLength = 300) =>
    <Field label={label}><input className={control} type={type} value={String(form[key] ?? '')} required={required} maxLength={maxLength}
      onChange={e => change(key, e.target.value as never)} /></Field>
  const error = save.error || inspect.error || meetings.error
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose() }}>
    <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{initial?.status === 'ready' ? 'Новая версия акта' : 'Создать акт'}</DialogTitle>
        <DialogDescription>Проверьте данные по PDF договора. Заполните фактически оказанные услуги и недостающие сведения.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-5">
        <fieldset disabled={save.isPending || inspect.isPending} className="space-y-5 disabled:opacity-70">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Договор"><select className={control} value={form.contract_link_id} required onChange={e => change('contract_link_id', e.target.value)}>
              <option value="">Выберите договор</option>{context.contracts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></Field>
            <Field label="Вид акта"><select className={control} value={form.template} onChange={e => {
              const value = e.target.value as ActTemplate; change('template', value)
              if (form.lines.length === 1 && !form.lines[0].name) change('lines', [emptyLine(value === 'stages' || value === 'final' ? '' : ACT_TEMPLATES[value])])
            }}>{Object.entries(ACT_TEMPLATES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AppButton colorPrefix="p" type="button" disabled={!form.contract_link_id || inspect.isPending} onClick={() => inspect.mutate()}>{inspect.isPending ? 'Читаем договор…' : 'Прочитать данные договора'}</AppButton>
            <p className="text-xs text-p-muted">Номер записи TrustMe может отличаться от номера внутри PDF.</p>
          </div>
          {inspection && <div className={box}>
            <p className="text-sm font-semibold">Текст договора для проверки</p>
            {inspection.suggested_contract_number && <AppButton colorPrefix="p" type="button" onClick={() => change('contract_number', inspection.suggested_contract_number!)}>Подставить найденный №{inspection.suggested_contract_number}</AppButton>}
            {inspection.signers.filter(s => !s.is_company && s.name).map((s, i) => <button key={i} type="button" className="m-2 text-sm underline" onClick={() => change('customer_name', s.name!)}>Заказчик: {s.name}</button>)}
            <div className="mt-2 max-h-60 overflow-y-auto">{inspection.pages.map(p => <details key={p.page}><summary className="cursor-pointer py-1 text-sm">Страница {p.page}</summary><pre className="whitespace-pre-wrap break-words text-xs text-p-muted">{p.text || 'Текст не распознан. Откройте PDF.'}</pre></details>)}</div>
          </div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {textField('Фамилия и имя студента по договору', 'student_name')}
            {textField('Заказчик / подписант по договору', 'customer_name')}
            {textField('ИИН / идентификатор студента (необязательно)', 'student_id_number', false, 'text', 30)}
            {textField('ИИН / идентификатор заказчика (необязательно)', 'customer_id', false, 'text', 30)}
            {textField('Номер договора внутри PDF', 'contract_number', true, 'text', 100)}
            {textField('Дата договора', 'contract_date', true, 'date')}
            {textField('Исполнитель — точное наименование', 'executor_name', true, 'text', 500)}
            {textField('Представитель исполнителя', 'executor_representative')}
            {textField('Основание полномочий представителя', 'executor_basis')}
            {textField('Реквизиты исполнителя (необязательно)', 'executor_requisites', false, 'text', 1500)}
            {textField('Дата акта', 'act_date', true, 'date')}
            {textField('Город', 'city', true, 'text', 100)}
            {textField('Начало оказания услуг', 'period_start', true, 'date')}
            {textField('Конец оказания услуг', 'period_end', true, 'date')}
            <Field label="Количество звонков / встреч (необязательно)"><input className={control} type="number" min="0" max="10000" value={form.calls_count ?? ''} onChange={e => change('calls_count', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <div className="self-end"><AppButton colorPrefix="p" type="button" disabled={!form.period_start || !form.period_end || meetings.isPending} onClick={() => meetings.mutate()}>Подставить завершённые встречи</AppButton></div>
          </div>
          <div className="space-y-3">
            <h3 className="font-semibold text-p-text">Оказанные услуги</h3>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.include_amount} onChange={e => change('include_amount', e.target.checked)} />Указать стоимость услуг из договора</label>
            {form.include_amount && <Field label="Валюта всех строк"><select className={control} value={form.currency} onChange={e => change('currency', e.target.value as ActInput['currency'])}>{['KZT', 'RUB', 'USD', 'EUR'].map(c => <option key={c}>{c}</option>)}</select></Field>}
            {form.lines.map((line, index) => {
              const changeLine = (key: keyof ActLine, value: string | null) => change('lines', form.lines.map((x, i) => i === index ? { ...x, [key]: value } : x))
              return <div key={index} className={`${box} space-y-3`}>
                <div className="flex items-center justify-between"><h4 className="text-sm font-semibold">Услуга {index + 1}</h4>{form.lines.length > 1 && <button type="button" className="text-sm underline" onClick={() => change('lines', form.lines.filter((_, i) => i !== index))}>Убрать услугу {index + 1}</button>}</div>
                <Field label="Название услуги по договору"><input className={control} required minLength={3} maxLength={300} value={line.name} onChange={e => changeLine('name', e.target.value)} /></Field>
                <Field label="Что фактически сделано"><textarea className={control} required minLength={3} maxLength={2000} value={line.result} onChange={e => changeLine('result', e.target.value)} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Страница / пункт договора"><input className={control} required minLength={2} maxLength={300} value={line.contract_source} onChange={e => changeLine('contract_source', e.target.value)} /></Field>
                  <Field label="Подтверждение выполнения — ссылка или материал"><input className={control} required minLength={3} maxLength={1500} value={line.evidence} onChange={e => changeLine('evidence', e.target.value)} /></Field>
                  <Field label="Количество"><input className={control} required type="number" min="0.01" max="100000" step="0.01" value={line.quantity} onChange={e => changeLine('quantity', e.target.value)} /></Field>
                  <Field label="Единица измерения"><input className={control} required maxLength={50} value={line.unit} onChange={e => changeLine('unit', e.target.value)} /></Field>
                  {form.include_amount && <Field label={`Цена за единицу, ${form.currency}`}><input className={control} required type="number" min="0" max="1000000000" step="0.01" value={line.unit_price ?? ''} onChange={e => changeLine('unit_price', e.target.value || null)} /></Field>}
                </div>
              </div>
            })}
            <AppButton colorPrefix="p" type="button" disabled={form.lines.length >= 30} onClick={() => change('lines', [...form.lines, emptyLine()])}>Добавить услугу</AppButton>
          </div>
          {form.template === 'final' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.full_completion_confirmed} onChange={e => change('full_completion_confirmed', e.target.checked)} className="mt-1" />Подтверждаю исполнение всего договора, включая все предусмотренные услуги.</label>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={form.verified} onChange={e => change('verified', e.target.checked)} className="mt-1" />Проверены ФИО, подписант, реквизиты, состав, объём и выполнение услуг; указанные цены соответствуют договору.</label>
          <div className="flex flex-wrap gap-2">
            <AppButton colorPrefix="p" type="submit" value="preview">Предпросмотр PDF</AppButton>
            <AppButton colorPrefix="p" type="submit" value="draft">Сохранить черновик</AppButton>
            <AppButton colorPrefix="p" type="submit" value="generate" disabled={!form.verified || (form.template === 'final' && !form.full_completion_confirmed)}>Создать акт</AppButton>
          </div>
        </fieldset>
        {save.isPending && <p role="status" className="text-sm">Сохраняем документ…</p>}
        {message && <p role="status" className="text-sm text-p-muted">{message}</p>}
        {error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(error, 'Не удалось подготовить акт')}</p>}
        {previewUrl && <div><h3 className="mb-2 font-semibold">Предпросмотр</h3><iframe title="Предпросмотр акта PDF" src={previewUrl} className="h-[65vh] w-full rounded-ctl border border-p-line" /><a className="text-sm underline" href={previewUrl} target="_blank" rel="noreferrer">Открыть предпросмотр отдельно</a></div>}
      </form>
    </DialogContent>
  </Dialog>
}

function MailEditor({ act, recipients, onClose, onSent }: { act: ActRecord; recipients: string[]; onClose: () => void; onSent: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [recipient, setRecipient] = useState(recipients[0] || '')
  const [subject, setSubject] = useState(`Акт оказанных услуг — ${act.student_name}`)
  const [body, setBody] = useState(`Здравствуйте!\n\nНаправляем акт оказанных услуг от ${act.act_date}. Документ приложен к письму.\n\nС уважением,\nTeenTechEd`)
  const send = useMutation({ mutationFn: () => actsApi.send(act.id, { request_id: requestId, recipient, subject, body }), onSuccess: onSent, retry: false })
  return <Dialog open onOpenChange={open => { if (!open && !send.isPending) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Отправить акт по почте</DialogTitle><DialogDescription>Проверьте адрес заказчика или подписанта. Вложение: {act.file_name}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!send.isPending && !send.data) send.mutate() }}>
      <fieldset disabled={send.isPending || !!send.data} className="space-y-3">
        <Field label="Получатель"><input className={control} type="email" required value={recipient} list="act-recipients" onChange={e => setRecipient(e.target.value)} /><datalist id="act-recipients">{recipients.map(email => <option key={email}>{email}</option>)}</datalist></Field>
        <Field label="Тема"><input className={control} required maxLength={300} value={subject} onChange={e => setSubject(e.target.value)} /></Field>
        <Field label="Текст письма"><textarea className={control} required maxLength={10000} rows={7} value={body} onChange={e => setBody(e.target.value)} /></Field>
        <AppButton colorPrefix="p" type="submit">{send.isPending ? 'Отправляем…' : 'Отправить с PDF'}</AppButton>
      </fieldset>
      {send.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(send.error, 'Не удалось отправить письмо')}</p>}
      {send.data && <p role="status" className="text-sm">{MAIL_STATUS[send.data.status] || send.data.status}</p>}
    </form>
  </DialogContent></Dialog>
}

export function StudentActsPanel({ studentId, financialContractId }: { studentId: string; financialContractId?: string }) {
  const { can } = useAuth()
  const cache = useQueryClient()
  const [editor, setEditor] = useState<{ initial: ActRecord | null } | null>(null)
  const [mailAct, setMailAct] = useState<ActRecord | null>(null)
  const [resolution, setResolution] = useState<{ act: string; attempt: string } | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolutionOutcome, setResolutionOutcome] = useState('sent')
  const [documentPreview, setDocumentPreview] = useState<string | null>(null)
  useEffect(() => () => { if (documentPreview) URL.revokeObjectURL(documentPreview) }, [documentPreview])
  const context = useQuery({ queryKey: ['acts', studentId, financialContractId], queryFn: () => financialContractId ? actsApi.financialContext(financialContractId) : actsApi.context(studentId), retry: false })
  const refresh = () => { cache.invalidateQueries({ queryKey: ['acts', studentId] }); cache.invalidateQueries({ queryKey: ['acts-registry'] }); cache.invalidateQueries({ queryKey: ['portal-acts'] }); cache.invalidateQueries({ queryKey: ['finance'] }) }
  const action = useMutation({ mutationFn: async ({ type, act }: { type: string; act: ActRecord }) => {
    if (type === 'share') { await actsApi.share(act.id); refresh() }
    else downloadBlob(await actsApi.pdf(act.id), act.file_name || 'Акт.pdf')
  }, retry: false })
  const contract = useMutation({ mutationFn: async ({ id, view = false }: { id: string; view?: boolean }) => {
    const blob = await actsApi.contractPdf(studentId, id)
    if (view) setDocumentPreview(URL.createObjectURL(blob))
    else downloadBlob(blob, `Договор-${context.data?.student_name || ''}.pdf`)
  }, retry: false })
  const assign = useMutation({ mutationFn: ({ id, value }: { id: string; value: string }) => trustmeApi.assignFinancial(studentId, id, value || null), onSuccess: refresh, retry: false })
  const resolve = useMutation({ mutationFn: () => actsApi.resolveMail(resolution!.act, resolution!.attempt, resolutionOutcome, resolutionNote.trim()),
    onSuccess: () => { refresh(); setResolution(null); setResolutionNote('') }, retry: false })
  const manage = can('acts', 'manage')
  if (context.isPending) return <p role="status" className="text-sm text-p-muted">Загружаем договоры и акты…</p>
  if (context.error || !context.data) return <div role="alert" className={box}><p>{getErrorMessage(context.error, 'Не удалось загрузить документы')}</p><button className="mt-2 underline" onClick={() => context.refetch()}>Повторить</button></div>
  const data = context.data
  return <div className="space-y-6">
    <div className="space-y-3"><h3 className="font-semibold text-p-text">Договоры студента</h3>
      {!data.contracts.length && <p className="text-sm text-p-muted">Договор ещё не привязан. Для создания акта выберите проверенный договор TrustMe.</p>}
      {[...data.contracts, ...(data.unassigned_contracts || [])].map(c => <div key={c.id} className={box}>
        <p className="font-semibold break-words">{c.name}</p>
        {financialContractId && !c.financial_contract_id && <p className="text-sm text-amber-700">Нужно сопоставить с финансовым договором</p>}
        {financialContractId && can('contracts', 'manage') && <Field label="Финансовый договор"><select className={control} value={c.financial_contract_id || ''} disabled={assign.isPending} onChange={e => assign.mutate({ id: c.id, value: e.target.value })}>
          <option value="">Не сопоставлен</option>{data.financial_contracts?.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select></Field>}
        <p className="mt-1 text-xs text-p-muted">№ записи TrustMe: {c.number || '—'} · {c.status === 3 ? 'Подписан при привязке' : `Статус при привязке: ${c.status}`}</p>
        <p className="my-2 text-sm text-p-muted">{c.signers.filter(s => !s.is_company).map(s => s.name).filter(Boolean).join(', ')}</p>
        <AppButton colorPrefix="p" disabled={contract.isPending} onClick={() => contract.mutate({ id: c.id })}>Скачать договор</AppButton>
        <AppButton colorPrefix="p" disabled={contract.isPending} onClick={() => contract.mutate({ id: c.id, view: true })}>Просмотреть PDF</AppButton>
      </div>)}
      {!financialContractId && manage && can('contracts', 'manage') && <details className={box}><summary className="cursor-pointer text-sm font-medium">Найти или изменить договор TrustMe</summary><div className="mt-4"><StudentTrustMePanel studentId={studentId} studentName={data.student_name} canManage onChanged={refresh} /></div></details>}
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-p-text">Акты оказанных услуг</h3>
        {manage && <AppButton colorPrefix="p" disabled={!data.contracts.length} onClick={() => setEditor({ initial: null })}>Создать акт</AppButton>}</div>
      {!data.acts.length && <p className="text-sm text-p-muted">Акты ещё не созданы.</p>}
      {data.acts.map(act => <div key={act.id} className={`${box} space-y-3`}>
        <div><p className="font-semibold break-words">{act.file_name || `${act.student_name} — ${ACT_TEMPLATES[act.template]}`}</p><p className="mt-1 text-xs text-p-muted">{act.status === 'draft' ? 'Черновик' : 'PDF сформирован'} · {act.act_date} · {act.snapshot.period_start} — {act.snapshot.period_end}{act.supersedes_id ? ' · Новая версия' : ''}{act.author_name ? ` · Автор: ${act.author_name}` : ''}</p></div>
        <div className="flex flex-wrap gap-2">
          {act.status === 'ready' && <AppButton colorPrefix="p" disabled={action.isPending} onClick={() => action.mutate({ type: 'download', act })}>Скачать акт</AppButton>}
          {manage && <AppButton colorPrefix="p" onClick={() => setEditor({ initial: act })}>{act.status === 'draft' ? 'Дополнить черновик' : 'Создать новую версию'}</AppButton>}
          {manage && act.status === 'ready' && !act.shared && <AppButton colorPrefix="p" disabled={action.isPending} onClick={() => action.mutate({ type: 'share', act })}>Открыть студенту</AppButton>}
          {act.shared && <span className="self-center text-xs text-p-muted">Доступен студенту в документах</span>}
          {manage && can('acts_mail', 'manage') && act.status === 'ready' && <AppButton colorPrefix="p" disabled={!data.mail_configured || act.mail.some(m => ['sending', 'unknown'].includes(m.status))} onClick={() => setMailAct(act)}>Отправить по почте</AppButton>}
        </div>
        {!!act.mail.length && <ul className="space-y-1 text-xs text-p-muted">{act.mail.map(m => <li key={m.id}>{m.created_at.slice(0, 16).replace('T', ' ')} · {m.recipient} · {MAIL_STATUS[m.status] || m.status}
          {manage && can('acts_mail', 'manage') && ['unknown', 'sending'].includes(m.status) && <button className="ml-2 underline" onClick={() => { resolve.reset(); setResolution({ act: act.id, attempt: m.id }) }}>Уточнить результат</button>}
        </li>)}</ul>}
      </div>)}
      {manage && !data.mail_configured && <p className="text-xs text-p-muted">Отправка станет доступна после подключения корпоративной почты на сервере.</p>}
    </div>
    {assign.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(assign.error)}</p>}
    {documentPreview && <Dialog open onOpenChange={open => { if (!open) setDocumentPreview(null) }}><DialogContent className="max-w-5xl"><DialogHeader><DialogTitle>Договор TrustMe</DialogTitle><DialogDescription>PDF договора</DialogDescription></DialogHeader><iframe title="Договор TrustMe PDF" src={documentPreview} className="h-[75vh] w-full" /></DialogContent></Dialog>}
    {(action.error || contract.error) && <p role="alert" className="text-sm text-red-700">{getErrorMessage(action.error || contract.error, 'Не удалось выполнить действие')}</p>}
    {editor && <ActEditor studentId={studentId} context={data} initial={editor.initial} onClose={() => setEditor(null)} onSaved={refresh} />}
    {mailAct && <MailEditor act={mailAct} recipients={data.recipient_suggestions} onClose={() => setMailAct(null)} onSent={refresh} />}
    {resolution && <Dialog open onOpenChange={open => { if (!open && !resolve.isPending) setResolution(null) }}><DialogContent>
      <DialogHeader><DialogTitle>Уточнить результат отправки</DialogTitle><DialogDescription>Проверьте отправленное письмо в корпоративном ящике. Повторная отправка станет доступна, если вы подтвердите, что письмо не было отправлено.</DialogDescription></DialogHeader>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!resolve.isPending) resolve.mutate() }}>
        <Field label="Результат проверки"><select className={control} value={resolutionOutcome} onChange={e => setResolutionOutcome(e.target.value)}><option value="sent">Письмо отправлено</option><option value="not_sent">Письмо не отправлено</option></select></Field>
        <Field label="Как проверили"><textarea className={control} required minLength={10} maxLength={1000} value={resolutionNote} onChange={e => setResolutionNote(e.target.value)} /></Field>
        <AppButton colorPrefix="p" type="submit" disabled={resolve.isPending}>Сохранить результат проверки</AppButton>
        {resolve.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(resolve.error)}</p>}
      </form>
    </DialogContent></Dialog>}
  </div>
}
