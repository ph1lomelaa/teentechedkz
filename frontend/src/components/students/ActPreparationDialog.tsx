import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, X } from 'lucide-react'
import { actsApi, type ActInput, type ActRecord, type ActContract, type ContractService } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { REQUISITES, actToday, displayDate, documentTitle, inferTemplate } from './actTemplates'
import { neutralDisabled, documentLink } from './contractPresentation'

const input = 'mt-1 block w-full min-w-0 rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text'
const check = 'mt-1 h-4 w-4 shrink-0'
const CURRENCIES = ['KZT', 'RUB', 'USD', 'EUR'] as const
const money = (value: string) => Number(value).toLocaleString('ru-RU').replace(/\s/g, ' ')
export function ActPreparationDialog({ studentId, studentName, contract, initial, previousActs = [], onClose, onSaved }: {
  studentId: string; studentName: string; contract: ActContract; initial: ActRecord | null; previousActs?: ActRecord[]
  onClose: () => void; onSaved: (actId?: string) => void
}) {
  const [draftId, setDraftId] = useState(initial?.status === 'draft' ? initial.id : null)
  const [form, setForm] = useState<ActInput>(() => initial ? { ...initial.snapshot, verified:false, full_completion_confirmed:['admission', 'final'].includes(initial.snapshot.template),
    company_signature:false, calls_count:null, contract_total:initial.snapshot.contract_total ?? null, supersedes_id:initial.status === 'ready' ? initial.id : initial.supersedes_id,
  } : {
    contract_link_id:contract.id, supersedes_id:null, template:'stages', student_name:'', customer_name:'', customer_id:'', student_id_number:'', customer_email:'',
    executor_name:'', executor_representative:'', executor_basis:'', executor_requisites:'', contract_number:contract.legal_number || '', contract_date:contract.contract_date || '',
    city:'', act_date:actToday(), period_start:'', period_end:actToday(), calls_count:null, include_amount:false, contract_total:null, currency:'KZT', lines:[], verified:false, full_completion_confirmed:false, company_signature:false, application_ids:[],
  })
  const dirty = useRef(new Set<string>())
  const applied = useRef(false)
  const [finalAct, setFinalAct] = useState(['admission', 'final'].includes(initial?.snapshot.template || ''))
  const [step, setStep] = useState<'services' | 'details'>(initial?.snapshot.lines.length && initial.snapshot.lines.every(line => line.contract_service_id) ? 'details' : 'services')
  const [mobilePreview, setMobilePreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [message, setMessage] = useState('')
  const [quote, setQuote] = useState('')
  const [quotePage, setQuotePage] = useState('1')
  const profile = useQuery({ queryKey:['contract-requisites',studentId,contract.id], queryFn:() => actsApi.inspect(studentId,contract.id), staleTime:0, retry:false })
  useEffect(() => {
    if (!profile.data || applied.current) return
    applied.current = true
    setForm(old => {
      const next = { ...old }
      for (const [key] of REQUISITES) if (!dirty.current.has(key) && profile.data.fields[key] && (!initial || !old[key])) Object.assign(next,{[key]:profile.data.fields[key]})
      // Подпись и печать по умолчанию, если сервер подтвердил исполнителя договора.
      if (!initial && profile.data.company_signature_available) next.company_signature = true
      return next
    })
  }, [profile.data,initial])
  function change<K extends keyof ActInput>(key: K, value: ActInput[K]) {
    dirty.current.add(key); setForm(old => ({ ...old,[key]:value,verified:key === 'verified' ? Boolean(value) : false })); setMessage('')
  }
  const services = profile.data?.services || []
  const fingerprint = profile.data?.fingerprint
  const superseded = new Set(previousActs.map(a => a.supersedes_id).filter(Boolean))
  const ready = previousActs.filter(a => a.status === 'ready' && a.snapshot.contract_link_id === contract.id && a.id !== form.supersedes_id && !superseded.has(a.id))
  const usedIn = new Map(ready.flatMap(a => a.snapshot.lines.map(l => [l.contract_service_id, a] as const)).filter(([id]) => id))
  const legacy = form.lines.some(l => !services.some(s => s.id === l.contract_service_id && l.source_fingerprint === fingerprint && l.result === s.text && l.name === s.name && l.contract_source === s.reference))
  const categoriesOf = (lines: ActInput['lines']) => lines.map(l => services.find(s => s.id === l.contract_service_id)?.category || '')
  function select(service: ContractService, selected: boolean) {
    const existing = form.lines.filter(l => services.some(s => s.id === l.contract_service_id && l.source_fingerprint === fingerprint && l.result === s.text && l.name === s.name && l.contract_source === s.reference))
    const lines = selected ? [...existing,{contract_service_id:service.id,source_fingerprint:fingerprint,name:service.name,result:service.text,evidence:'',contract_source:service.reference,quantity:'1',unit:'услуга',unit_price:null}] : existing.filter(l => l.contract_service_id !== service.id)
    setForm(old => ({...old,lines,template:inferTemplate(categoriesOf(lines),finalAct),verified:false}))
  }
  function toggleFinal(value: boolean) {
    setFinalAct(value)
    setForm(old => ({...old,template:inferTemplate(categoriesOf(old.lines),value),full_completion_confirmed:value,application_ids:[],verified:false}))
  }
  // Сумма: цены отмеченных услуг из договора, а если акт закрывает весь договор —
  // сумма из «Финансов». Частичному акту общую сумму договора не подставляем.
  const pricedLines = form.lines.map(line => services.find(s => s.id === line.contract_service_id)?.confirmed_price)
  const servicePrice = pricedLines.length && pricedLines.every(Boolean) && new Set(pricedLines.map(p => p!.currency)).size === 1
    ? { amount:String(pricedLines.reduce((sum, p) => sum + Number(p!.amount), 0)), currency:pricedLines[0]!.currency } : null
  const remaining = services.filter(s => !usedIn.has(s.id))
  const coversContract = finalAct || (!!remaining.length && remaining.every(s => form.lines.some(l => l.contract_service_id === s.id)))
  const financeCurrency = CURRENCIES.find(c => c === profile.data?.contract_currency) || 'KZT'
  const financePrice = profile.data?.contract_amount ? { amount:profile.data.contract_amount, currency:financeCurrency } : null
  const suggested = servicePrice || (coversContract ? financePrice : null)
  const suggestedKey = suggested ? `${suggested.amount}:${suggested.currency}` : ''
  useEffect(() => {
    if (!suggested || dirty.current.has('contract_total')) return
    setForm(old => ({...old,include_amount:true,contract_total:suggested.amount,currency:suggested.currency,verified:false}))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- only a changed suggestion refills the untouched field
  }, [suggestedKey])
  const missing = REQUISITES.filter(([key,,required]) => required && !String(form[key] || '').trim())
  const errors: Partial<Record<'period_start' | 'period_end' | 'act_date', string>> = {}
  if (form.period_start && form.period_end && form.period_end < form.period_start) errors.period_end = 'Окончание раньше начала периода'
  else if (form.period_end && form.contract_date && form.period_end < form.contract_date) errors.period_end = `Период должен заканчиваться не раньше даты договора (${displayDate(form.contract_date)})`
  if (form.act_date && form.period_end && form.act_date < form.period_end) errors.act_date = 'Дата акта не может быть раньше окончания периода'
  const validPeriod = !!form.period_start && !!form.period_end && !!form.act_date && !!form.contract_date && !Object.keys(errors).length
  const amountValid = !form.include_amount || Number(form.contract_total) > 0
  const milestone = ['applications','offer','admission','final'].includes(form.template)
  const final = ['admission','final'].includes(form.template)
  const applications = (profile.data?.applications || []).filter(a => final ? a.status === 'enrolled' : (form.template === 'applications' ? ['submitted','offer_received','enrolled'] : ['offer_received','enrolled']).includes(a.status))
  const complete = !missing.length && validPeriod && amountValid && !!form.lines.length && !legacy
  const active = (profile.data?.status ?? contract.status) === 3
  const readyToGenerate = complete && active && form.verified && (!final || form.full_completion_confirmed) && !profile.isFetching
  const checklist = [
    ['Услуги из договора', !!form.lines.length && !legacy],
    ['Реквизиты договора', !missing.length],
    ['Период и дата акта', validPeriod],
    ...(form.include_amount ? [['Стоимость', amountValid] as const] : []),
  ] as const
  const reason = !active ? 'Нужен подписанный договор' : profile.isFetching ? 'Читаем договор' : legacy ? 'Повторно выберите пункты из договора для старого черновика'
    : !complete ? 'Заполните отмеченные пункты' : !form.verified ? 'Подтвердите выполнение работ галочкой внизу' : ''
  useEffect(() => {
    setPreviewUrl(null); setPreviewError('')
    if (step !== 'details' || !complete || !active) return
    let cancelled = false; let url: string | null = null
    const timer = setTimeout(async () => {
      try { const blob = await actsApi.preview(studentId,form); if (!cancelled) { url = URL.createObjectURL(blob); setPreviewUrl(url) } }
      catch (error) { if (!cancelled) setPreviewError(getErrorMessage(error)) }
    },650)
    return () => { cancelled = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  },[studentId,form,complete,active,step])
  const save = useMutation({ mutationFn:async (generate: boolean) => {
    const fields = Object.fromEntries(REQUISITES.filter(([key]) => dirty.current.has(key)).map(([key]) => [key,String(form[key] || '')]))
    if (Object.keys(fields).length) await actsApi.saveProfile(studentId,contract.id,fields)
    const body = { ...form, contract_total:form.include_amount ? form.contract_total : null, lines:form.lines.map(l => ({ ...l, unit_price:null })) }
    const record = draftId ? await actsApi.update(draftId,body) : await actsApi.create(studentId,body)
    setDraftId(record.id); onSaved()
    if (generate) { await actsApi.generate(record.id); onSaved(record.id); onClose() } else setMessage('Черновик сохранён')
  },retry:false })
  const quoteMutation = useMutation({ mutationFn:() => actsApi.addServiceQuote(studentId,contract.id,{page:Number(quotePage),text:quote,category:'other'}),
    onSuccess:async () => { setQuote(''); await profile.refetch() },retry:false })
  const dateField = (key: 'period_start' | 'period_end' | 'act_date', label: string) => <label key={key} className="min-w-0 text-xs text-p-muted">{label}<input className={`${input} ${errors[key] ? '!border-red-400' : ''}`} type="date" aria-invalid={!!errors[key]} value={form[key] || ''} onChange={e => change(key,e.target.value)} />{errors[key] && <span role="alert" className="mt-1 block text-red-700">{errors[key]}</span>}</label>
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose() }}><DialogContent className={`flex h-[94dvh] max-h-[94dvh] !w-[calc(100vw-1rem)] ${step === 'services' ? '!max-w-[800px]' : '!max-w-[1240px]'} flex-col gap-0 overflow-hidden !p-0 sm:!w-[calc(100vw-3rem)]`}>
    <div className="shrink-0 border-b border-p-line bg-p-panel px-4 py-4 pr-12 sm:px-6"><DialogHeader><DialogTitle>{step === 'services' ? 'Какие услуги выполнены?' : 'Проверьте и создайте акт'}</DialogTitle><DialogDescription>{studentName} · {documentTitle(contract.name)}</DialogDescription></DialogHeader>
      <p className="mt-3 text-xs text-p-muted">Шаг {step === 'services' ? '1' : '2'} из 2 · {step === 'services' ? 'Отметьте выполненные услуги — они войдут в один акт' : 'Реквизиты подставлены из договора. Проверьте период и стоимость'}</p>
    </div>
    {step === 'services' ? <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {profile.isPending && <p role="status" className="mb-4 text-sm text-p-muted">Читаем договор и приложение…</p>}
        {profile.error && <p role="alert" className="mb-4 text-sm text-red-700">Не удалось прочитать договор. <button className="underline" onClick={() => profile.refetch()}>Повторить чтение договора</button></p>}
        {quoteMutation.error && <p role="alert" className="mb-3 text-sm text-red-700">{getErrorMessage(quoteMutation.error)}</p>}
      <section className="space-y-3"><h3 className="text-sm font-semibold">Услуги из договора</h3>
        {legacy && <p role="alert" className="text-sm text-amber-800">В старом черновике есть описания без подтверждённого источника. Повторно выберите услуги ниже; текст старого PDF сохранён.</p>}
        {!profile.isPending && !services.length && <p className="text-sm text-p-muted">Услуги не распознаны. Добавьте точную цитату из договора ниже.</p>}
        {services.map(service => { const done = usedIn.get(service.id); return <div key={service.id} className={`border-b border-p-line py-3 ${done ? '-mx-2 rounded-lg border-transparent bg-emerald-500/10 px-2 ring-1 ring-inset ring-emerald-500/30' : ''}`}><label className="flex items-start gap-3 text-sm">{done ? <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"><Check size={13} /></span> : <input type="checkbox" className={check} checked={form.lines.some(l => l.contract_service_id === service.id)} onChange={e => select(service,e.target.checked)} />}<span className="min-w-0"><span className="font-semibold">{service.name}</span><span className="mt-1 block text-xs text-p-muted">{service.reference}</span>{done && <span className="mt-1 block text-xs font-medium text-emerald-500">Уже оформлено: акт от {displayDate(done.snapshot.act_date)}</span>}</span></label><details className="ml-7 mt-2"><summary className="cursor-pointer text-xs text-p-muted">Описание из договора</summary><p className="mt-2 whitespace-pre-line text-xs leading-relaxed">{service.text}</p>{service.confirmed_price && <p className="mt-2 text-xs">Стоимость по договору: {money(service.confirmed_price.amount)} {service.confirmed_price.currency}</p>}</details></div> })}
        <details className="border-b border-p-line py-3"><summary className="cursor-pointer text-xs text-p-muted">Нужной услуги нет в списке</summary><div className="mt-3 space-y-3"><p className="text-xs text-p-muted">Вставьте точную цитату услуги из PDF договора — сервер проверит, что она есть на указанной странице.</p><label className="block text-xs">Страница<input type="number" min={1} max={80} className={input} value={quotePage} onChange={e => setQuotePage(e.target.value)} /></label><label className="block text-xs">Точная цитата услуги<textarea className={input} rows={4} maxLength={1800} value={quote} onChange={e => setQuote(e.target.value)} /></label><AppButton colorPrefix="p" variant="subtle" size="sm" disabled={quote.trim().length < 12 || quoteMutation.isPending} onClick={() => quoteMutation.mutate()}>Проверить и добавить</AppButton></div></details>
      </section>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-p-line px-4 py-4 sm:px-6"><span className="text-sm text-p-muted">Выбрано услуг: {legacy ? 0 : form.lines.length}</span><AppButton colorPrefix="p" className={neutralDisabled} disabled={!form.lines.length || legacy || !active || profile.isFetching || !!profile.error} onClick={() => { setMobilePreview(false); setStep('details') }}>Далее</AppButton></div>
    </> : <>
    <div className="flex shrink-0 border-b border-p-line lg:hidden"><button className={`flex-1 p-3 text-sm ${mobilePreview ? '' : 'font-semibold'}`} onClick={() => setMobilePreview(false)}>Данные акта</button><button className={`flex-1 p-3 text-sm ${mobilePreview ? 'font-semibold' : ''}`} onClick={() => setMobilePreview(true)}>Предпросмотр</button></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-2"><div className={`${mobilePreview ? 'hidden lg:block' : ''} min-h-0 overflow-y-auto p-4 sm:p-6`}><fieldset disabled={save.isPending} className="min-w-0 space-y-5">
      {profile.isPending && <p role="status">Читаем договор и приложение…</p>}
      {profile.error && <p role="alert" className="text-sm text-red-700">Не удалось прочитать договор. Создание PDF требует подтверждённых источников. <button className="underline" onClick={() => profile.refetch()}>Повторить чтение договора</button></p>}
      <section className="space-y-2 border-b border-p-line pb-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Выбранные услуги · {form.lines.length}</h3><button type="button" className={documentLink} onClick={() => setStep('services')}>Изменить услуги</button></div><ul className="space-y-1 text-sm">{form.lines.map(line => <li key={line.contract_service_id || line.name}>{line.name}</li>)}</ul></section>
      <section><h3 className="text-sm font-semibold">Период оказания услуг</h3><div className="mt-2 grid grid-cols-2 gap-3">{dateField('period_start','С')}{dateField('period_end','По')}{dateField('act_date','Дата акта')}</div></section>
      <section className="space-y-2"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className={check} checked={form.include_amount} onChange={e => { dirty.current.add('contract_total'); setForm(old => ({...old,include_amount:e.target.checked,verified:false})) }} />Указать стоимость в акте</label>
        {form.include_amount ? <div className="ml-6"><label className="block text-xs text-p-muted">Общая стоимость оказанных услуг<div className="mt-1 flex items-center gap-2"><input className={`${input} !mt-0`} inputMode="decimal" value={form.contract_total || ''} onChange={e => { dirty.current.add('contract_total'); setForm(old => ({...old,contract_total:e.target.value.replace(/[^\d.,]/g,'').replace(',','.') || null,verified:false})) }} /><select aria-label="Валюта" className={`${input} !mt-0 !w-24`} value={form.currency} onChange={e => change('currency',e.target.value as ActInput['currency'])}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></div></label>
          <p className="mt-1 text-xs text-p-muted">{servicePrice ? 'Сумма цен выбранных услуг из договора.' : coversContract && financePrice ? 'Сумма договора из раздела «Финансы». Сверьте с договором.' : financePrice ? `Сумма всего договора в «Финансах»: ${money(financePrice.amount)} ${financePrice.currency}. Укажите стоимость выбранных услуг по договору.` : 'Укажите сумму по договору.'}</p></div>
          : <p className="ml-6 text-xs text-p-muted">В акте будет: «Стоимость и порядок расчётов определяются условиями Договора».</p>}
      </section>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className={check} checked={finalAct} onChange={e => toggleFinal(e.target.checked)} /><span>Итоговый акт: договор исполнен полностью<span className="mt-1 block text-xs text-p-muted">В акт добавится фраза о полном исполнении обязательств по договору.</span></span></label>
      {milestone && !!applications.length && <section className="space-y-2"><h3 className="text-sm font-semibold">Результат <span className="font-normal text-p-muted">· необязательно</span></h3><p className="text-xs text-p-muted">Отмеченные заявки будут перечислены в акте.</p>{applications.map(a => <label key={a.id} className="flex items-start gap-2 text-sm"><input className={check} type="checkbox" checked={form.application_ids?.includes(a.id) || false} onChange={e => change('application_ids',e.target.checked ? [...(form.application_ids || []),a.id] : form.application_ids?.filter(id => id !== a.id))} />{a.university || 'Университет не указан'}{a.program ? ` · ${a.program}` : ''} · {a.status === 'enrolled' ? 'Зачисление' : a.status === 'offer_received' ? 'Оффер' : 'Подано'}</label>)}</section>}
      <details open={!!missing.length} className="border-y border-p-line"><summary className="cursor-pointer py-3 text-sm font-medium">{missing.length ? `Реквизиты из договора · дополните ${missing.length}` : 'Реквизиты из договора ✓'}</summary><div className="grid gap-3 pb-4 sm:grid-cols-2">{REQUISITES.map(([key,label,required]) => <label key={key} className="min-w-0 text-xs text-p-muted">{label}{required ? ' *' : ''}<input className={input} type={key === 'contract_date' ? 'date' : 'text'} value={String(form[key] || '')} onChange={e => change(key,e.target.value)} /><span className="mt-1 block">{profile.data?.sources[key]?.page ? `Из договора · стр. ${profile.data.sources[key].page}` : 'Проверьте по оригиналу договора'}</span></label>)}</div></details>
      <label className="flex items-start gap-2 text-sm"><input className={check} type="checkbox" checked={form.company_signature || false} disabled={!profile.data?.company_signature_available} onChange={e => change('company_signature',e.target.checked)} /><span>Подпись и печать исполнителя{!profile.data?.company_signature_available && <span className="mt-1 block text-xs text-p-muted">Не подтверждено соответствие исполнителю этого договора</span>}</span></label>
      <label className="flex items-start gap-2 rounded-lg bg-p-bg p-3 text-sm"><input type="checkbox" className={check} checked={form.verified} onChange={e => change('verified',e.target.checked)} />Проверено: работы выполнены, период и реквизиты верны.</label>
    </fieldset></div><aside className={`${mobilePreview ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col border-p-line bg-p-bg p-3 lg:border-l`}><p className="mb-2 text-xs text-p-muted">Предпросмотр PDF · обновляется автоматически</p>{previewUrl ? <iframe title="Предпросмотр акта PDF" src={previewUrl} className="min-h-0 w-full flex-1 border-0 bg-white" />
      : <div className="flex flex-1 items-center justify-center p-5"><div className="w-full max-w-xs space-y-3 text-sm">{previewError ? <p role="alert" className="text-red-700">{previewError}</p> : complete && active ? <p className="text-center text-p-muted">Готовим предпросмотр…</p> : <><p className="text-p-muted">Для предпросмотра осталось:</p><ul className="space-y-2">{checklist.map(([label, ok]) => <li key={label} className={`flex items-center gap-2 ${ok ? 'text-p-muted' : 'font-medium text-p-text'}`}>{ok ? <Check size={16} className="text-emerald-700" /> : <X size={16} className="text-red-600" />}{label}</li>)}</ul></>}</div></div>}</aside></div>
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-p-line px-4 py-3 sm:px-6">
      {(save.error || quoteMutation.error) && <p role="alert" className="mr-auto text-sm text-red-700">{getErrorMessage(save.error || quoteMutation.error)}</p>}
      {message && <p role="status" className="mr-auto text-sm">{message}</p>}
      {!save.error && !message && reason && <p className="mr-auto text-xs text-p-muted">{reason}</p>}
      <button type="button" className={documentLink} disabled={save.isPending || !active} onClick={() => save.mutate(false)}>Сохранить черновик</button>
      <AppButton colorPrefix="p" className={neutralDisabled} title={reason || undefined} disabled={save.isPending || !readyToGenerate} onClick={() => save.mutate(true)}>{save.isPending ? 'Сохраняем…' : 'Создать акт'}</AppButton>
    </div></>}
  </DialogContent></Dialog>
}
