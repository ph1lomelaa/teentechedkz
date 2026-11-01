import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { FileText, RefreshCw, ChevronDown, AlertCircle } from 'lucide-react'
import { actsApi, ACT_TEMPLATES, type ActInput, type ActRecord, type ActTemplate, type ActContract } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'
import { ACT_CATALOG, REQUISITES, actToday, documentTitle } from './actTemplates'
import { neutralDisabled } from './contractPresentation'

const input = 'mt-1 block w-full min-w-0 border-b border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text outline-none focus:border-p-accent-dim focus:ring-2 focus:ring-p-accent/15'
export function ActPreparationDialog({ studentId, studentName, contract, template, initial, onClose, onSaved }: {
  studentId: string; studentName: string; contract: ActContract; template: ActTemplate; initial: ActRecord | null
  onClose: () => void; onSaved: () => void
}) {
  const catalog = ACT_CATALOG.find(t => t.id === template)
  const [draftId, setDraftId] = useState(initial?.status === 'draft' ? initial.id : null)
  const [form, setForm] = useState<ActInput>(() => initial ? {
    ...initial.snapshot, lines:initial.snapshot.lines.length ? initial.snapshot.lines : [{ name:catalog?.title || ACT_TEMPLATES[template], result:'', evidence:'', contract_source:'', quantity:'1', unit:'этап', unit_price:null }], contract_date: initial.snapshot.contract_date || '', act_date: initial.act_date || actToday(),
    period_start: initial.snapshot.period_start || '', period_end: initial.snapshot.period_end || '',
    verified: false, full_completion_confirmed: false,
    supersedes_id: initial.status === 'ready' ? initial.id : initial.supersedes_id,
  } : {
    contract_link_id: contract.id, supersedes_id: null, template, student_name: studentName, customer_name: '',
    customer_id: '', student_id_number: '', customer_email: '', executor_name: '', executor_representative: '',
    executor_basis: '', executor_requisites: '', contract_number: contract.legal_number || '', contract_date: contract.contract_date || '',
    act_date: actToday(), city: '', period_start: actToday().slice(0, 8) + '01', period_end: actToday(), calls_count: null,
    include_amount: false, currency: 'KZT', lines: template === 'stages' ? [] : [{ name: catalog?.title || ACT_TEMPLATES[template], result: '', evidence: '',
      contract_source: '', quantity: '1', unit: 'этап', unit_price: null }], verified: false, full_completion_confirmed: false,
  })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [message, setMessage] = useState('')
  const [mobilePreview, setMobilePreview] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const dirtyFields = useRef(new Set<string>())
  const applied = useRef(false)
  const profile = useQuery({ queryKey: ['contract-requisites', studentId, contract.id], queryFn: () => actsApi.inspect(studentId, contract.id), staleTime: 0, retry: false })
  const refreshProfile = useMutation({ mutationFn: () => actsApi.inspect(studentId, contract.id, true), onSuccess: () => { applied.current = false; profile.refetch() }, retry: false })
  useEffect(() => {
    if (!profile.data || applied.current) return
    applied.current = true
    const data = profile.data
    setForm(old => {
      const next = { ...old }
      for (const [key] of REQUISITES) {
        const found = data.fields[key]
        // An existing draft remains the authority for previously edited values.
        if (found && !dirtyFields.current.has(key) && (!initial || !old[key])) Object.assign(next, { [key]: found })
      }
      const reference = data.service_hints[template]?.reference || (next.contract_number ? `Договор №${next.contract_number}` : '')
      next.lines = next.lines.map(line => ({ ...line, contract_source: line.contract_source || reference }))
      return next
    })
  }, [profile.data, initial, template])
  const missing = REQUISITES.filter(([key, , required]) => required && (!String(form[key] || '').trim() || (key === 'student_name' && form.student_name.trim().split(/\s+/).length < 2)))
  const missingInputs = REQUISITES.filter(([key, , required]) => required && !profile.data?.fields[key] && !initial?.snapshot[key])
  const validPeriod = !!form.period_start && !!form.period_end && !!form.act_date && form.period_start <= form.period_end && form.period_end <= form.act_date && (!form.contract_date || form.contract_date <= form.period_end)
  const complete = !missing.length && validPeriod && form.lines.length > 0 && form.lines.every(l => l.name.trim().length >= 3 && l.result.trim().length >= 3 && l.contract_source.trim().length >= 2 && Number(l.quantity) > 0 && (!form.include_amount || (l.unit_price !== null && Number(l.unit_price) >= 0)))
  const currentStatus = profile.data?.status ?? contract.status
  const active = currentStatus === 3
  function change<K extends keyof ActInput>(key: K, value: ActInput[K]) {
    dirtyFields.current.add(key); setForm(old => ({ ...old, [key]: value, verified: key === 'verified' ? Boolean(value) : false,
      ...(key === 'contract_number' ? { lines:old.lines.map(line => ({ ...line, contract_source:!line.contract_source || line.contract_source.startsWith('Договор №') ? `Договор №${value}` : line.contract_source })) } : {}),
    })); setMessage('')
  }
  function lineChange(index: number, key: keyof ActInput['lines'][number], value: string | null) {
    change('lines', form.lines.map((line, i) => i === index ? { ...line, [key]: value } : line))
  }
  // Preview only complete data; cancellation prevents an older request replacing a newer preview.
  useEffect(() => {
    setPreviewUrl(null); setPreviewError('')
    if (!complete || !active) return
    let cancelled = false
    let url: string | null = null
    const timer = setTimeout(async () => {
      try {
        const blob = await actsApi.preview(studentId, form)
        if (!cancelled) { url = URL.createObjectURL(blob); setPreviewUrl(url) }
      } catch (error) { if (!cancelled) setPreviewError(getErrorMessage(error, 'Предпросмотр недоступен')) }
    }, 650)
    return () => { cancelled = true; clearTimeout(timer); if (url) URL.revokeObjectURL(url) }
  }, [studentId, form, complete, active])
  const save = useMutation({ mutationFn: async (generate: boolean) => {
    const fields = Object.fromEntries(REQUISITES.filter(([key]) => dirtyFields.current.has(key)).map(([key]) => [key, String(form[key] || '')]))
    if (Object.keys(fields).length) await actsApi.saveProfile(studentId, contract.id, fields)
    const record = draftId ? await actsApi.update(draftId, form) : await actsApi.create(studentId, form)
    setDraftId(record.id); onSaved()
    if (generate) { await actsApi.generate(record.id); onSaved(); onClose() }
    else setMessage('Черновик сохранён. Можно продолжить позже.')
  }, retry: false })
  const meetings = useMutation({ mutationFn: () => actsApi.context(studentId, { period_start: form.period_start, period_end: form.period_end }),
    onSuccess: data => { change('calls_count', data.completed_meetings); setMessage('Подставлены завершённые встречи. Проверьте, какие относятся к этому акту.') }, retry: false })
  const stages = ACT_CATALOG.filter(t => t.id !== 'stages')
  const stageOptions = template === 'stages' ? stages : catalog ? [catalog] : []
  const creationReason = !active ? 'Нужен подписанный действующий договор'
    : profile.isFetching ? 'Читаем данные договора'
    : !complete ? 'Дополните реквизиты, период и выполненные услуги'
    : !form.verified ? 'Подтвердите проверку реквизитов и выполнение услуг' : ''
  const busy = save.isPending
  const error = save.error || profile.error || refreshProfile.error || meetings.error
  const requisites = (onlyMissing: boolean) => REQUISITES.filter(([key]) => !onlyMissing || missingInputs.some(([missingKey]) => missingKey === key)).map(([key, label, required]) => <label key={key} className="block min-w-0 text-sm text-p-text">
    {label}{required && <span className="text-p-muted"> *</span>}
    <input className={input} type={key === 'contract_date' ? 'date' : key === 'customer_email' ? 'email' : 'text'} maxLength={key === 'executor_requisites' ? 1500 : key === 'executor_name' ? 500 : key === 'customer_id' || key === 'student_id_number' ? 30 : key === 'customer_email' ? 255 : key === 'contract_number' || key === 'city' ? 100 : 300} value={String(form[key] || '')} onChange={e => change(key, e.target.value)} />
    {profile.data?.sources[key] && <span className="mt-1 block text-xs text-p-muted">{dirtyFields.current.has(key) ? 'Изменено вами' : profile.data.sources[key].kind === 'manual' ? 'Дополнено сотрудником' : profile.data.sources[key].page ? `Из договора · стр. ${profile.data.sources[key].page}` : 'Из реквизитов TrustMe'}</span>}
    {!!profile.data?.conflicts[key]?.length && <span className="mt-1 block text-xs text-amber-700">В договоре найдены разные значения — проверьте PDF.</span>}
  </label>)
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="flex h-[94dvh] max-h-[94dvh] !w-[calc(100vw-1rem)] !max-w-[1240px] flex-col gap-0 overflow-hidden !p-0 sm:!w-[calc(100vw-3rem)]">
    <div className="shrink-0 border-b border-p-line bg-p-panel px-4 py-4 pr-12 sm:px-6 sm:pr-12">
      <DialogHeader><DialogTitle className="text-left">{catalog?.title || ACT_TEMPLATES[template]}</DialogTitle><DialogDescription className="truncate text-left">{studentName} · {documentTitle(contract.name)}</DialogDescription></DialogHeader>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-p-muted">{initial?.status === 'ready' ? 'Новая версия · исходный PDF сохранится' : 'Подготовка акта'}</span>
        <div className="flex flex-wrap gap-2"><AppButton colorPrefix="p" variant="subtle" size="sm" disabled={busy || !active || profile.isPending || refreshProfile.isPending} onClick={() => save.mutate(false)}>Сохранить черновик</AppButton><AppButton colorPrefix="p" size="sm" className={neutralDisabled} title={creationReason || undefined} disabled={busy || !active || !complete || !form.verified || profile.isFetching || refreshProfile.isPending || (template === 'final' && !form.full_completion_confirmed)} onClick={() => save.mutate(true)}>{busy ? save.variables ? 'Создаём PDF…' : 'Сохраняем…' : 'Создать PDF'}</AppButton></div>
      </div>
      {creationReason && <p className="mt-2 text-xs text-p-muted">{creationReason}</p>}
    </div>
    <div className="flex shrink-0 border-b border-p-line lg:hidden"><button className={`flex-1 p-3 text-sm ${!mobilePreview ? 'border-b-2 border-p-accent font-semibold' : 'text-p-muted'}`} onClick={() => setMobilePreview(false)}>Данные акта</button><button className={`flex-1 p-3 text-sm ${mobilePreview ? 'border-b-2 border-p-accent font-semibold' : 'text-p-muted'}`} onClick={() => setMobilePreview(true)}>Предпросмотр</button></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className={`${mobilePreview ? 'hidden lg:block' : ''} min-h-0 overflow-y-auto p-4 sm:p-6`}>
        <fieldset disabled={busy} className="min-w-0 space-y-6 disabled:opacity-60">
          {profile.isPending && <p role="status" className="rounded-lg bg-p-bg p-3 text-sm text-p-muted">Заполняем реквизиты из договора…</p>}
          {!active && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Договор отозван или не подписан. Создание нового акта недоступно.</p>}
          {error && <div role="alert" className="rounded-lg border border-red-200 p-3 text-sm text-red-700">{getErrorMessage(error, 'Не удалось выполнить действие')}{profile.error && <span className="mt-2 block text-xs">Можно повторить чтение или заполнить реквизиты вручную по PDF.</span>}{profile.error && <button className="ml-2 underline" onClick={() => profile.refetch()}>Повторить чтение договора</button>}</div>}
          {message && <p role="status" className="text-sm text-p-muted">{message}</p>}
          {!!missingInputs.length && !profile.isPending && !detailsOpen && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/30 p-4"><h3 className="flex items-center gap-2 text-sm font-semibold"><AlertCircle size={16} />Дополните реквизиты</h3><p className="text-xs text-p-muted">Эти данные не удалось однозначно получить. Они сохранятся для следующих актов.</p><div className="grid gap-4 sm:grid-cols-2">{requisites(true)}</div></section>}
          <details open={detailsOpen} onToggle={e => setDetailsOpen(e.currentTarget.open)} className="border-b border-p-line">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-medium"><span>Данные из договора <span className="ml-1 text-xs font-normal text-p-muted">{REQUISITES.filter(([key]) => form[key]).length} заполнено</span></span><ChevronDown size={16} /></summary>
            <div className="space-y-4 border-t border-p-line p-4"><div className="grid gap-4 sm:grid-cols-2">{requisites(false)}</div><AppButton variant="subtle" size="sm" colorPrefix="p" disabled={refreshProfile.isPending} onClick={() => refreshProfile.mutate()}><RefreshCw size={14} /> Обновить из PDF</AppButton></div>
          </details>
          <section className="space-y-3"><h3 className="text-sm font-semibold">Период оказания услуг</h3><div className="grid grid-cols-2 gap-3">{([['period_start','С'],['period_end','По'],['act_date','Дата акта']] as const).map(([key,label]) => <label key={key} className="min-w-0 text-sm">{label}<input className={input} type="date" value={form[key] || ''} onChange={e => change(key, e.target.value)} /></label>)}</div>{form.period_start && form.period_end && !validPeriod && <p className="text-xs text-red-700">Проверьте порядок дат: окончание периода должно быть не позже даты акта.</p>}</section>
          <section className="space-y-3"><h3 className="text-sm font-semibold">Что фактически выполнено</h3><p className="text-xs text-p-muted">Отметьте оказанные услуги. Формулировки взяты из выбранного шаблона.</p>
            {template === 'stages' && <div className="space-y-2">{stages.map(stage => {
              const selected = form.lines.some(line => line.name === stage.title)
              return <label key={stage.id} className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 shrink-0" checked={selected} onChange={e => change('lines', e.target.checked ? [...form.lines, { name: stage.title, result: '', evidence: '', contract_source: profile.data?.service_hints[stage.id]?.reference || (form.contract_number ? `Договор №${form.contract_number}` : ''), quantity: '1', unit: 'этап', unit_price: null }] : form.lines.filter(line => line.name !== stage.title))} /><span>{stage.title}</span></label>
            })}</div>}
            {form.lines.map((line, index) => {
              const options = template === 'stages' ? stageOptions.find(stage => stage.title === line.name)?.services : catalog?.services
              const selected = new Set(line.result.split('\n'))
              return <div key={index} className="space-y-1">{template === 'stages' && <h4 className="pt-3 text-sm font-medium">{line.name}</h4>}{options?.map(service => <label key={service} className="flex cursor-pointer items-start gap-3 py-2 text-sm leading-relaxed"><input className="mt-1 shrink-0 accent-[#d6b500]" type="checkbox" checked={selected.has(service)} onChange={e => { const values = new Set(selected); if (e.target.checked) values.add(service); else values.delete(service); lineChange(index, 'result', [...values].join('\n')) }} /><span>{service}</span></label>)}</div>
            })}
            <details className="border-b border-p-line"><summary className="cursor-pointer p-3 text-sm text-p-muted">Уточнить описание и основание{form.lines.length > 1 ? ` · ${form.lines.length} услуги` : ''}</summary><div className="space-y-4 border-t border-p-line p-3">{form.lines.map((line, i) => <div key={i} className="space-y-3">{form.lines.length > 1 && <p className="text-sm font-semibold">Услуга {i+1}</p>}<label className="block text-sm">Название услуги<input className={input} value={line.name} maxLength={300} onChange={e => lineChange(i,'name',e.target.value)} /></label><label className="block text-sm">Что выполнено<textarea className={input} rows={4} value={line.result} maxLength={2000} onChange={e => lineChange(i,'result',e.target.value)} /></label><label className="block text-sm">Основание в договоре<input className={input} value={line.contract_source} maxLength={300} onChange={e => lineChange(i,'contract_source',e.target.value)} /></label><label className="block text-sm">Материалы или ссылка, необязательно<input className={input} value={line.evidence} maxLength={1500} onChange={e => lineChange(i,'evidence',e.target.value)} /></label>{form.lines.length > 1 && <div className="grid grid-cols-2 gap-3"><label className="text-sm">Количество<input className={input} type="number" min="0.01" step="0.01" value={line.quantity} onChange={e => lineChange(i,'quantity',e.target.value)} /></label><label className="text-sm">Единица<input className={input} value={line.unit} onChange={e => lineChange(i,'unit',e.target.value)} /></label></div>}</div>)}</div></details>
          </section>
          {(template === 'ielts' || template === 'stages') && <section className="space-y-3"><label className="block text-sm">Количество звонков / встреч, необязательно<input className={input} type="number" min="0" max="10000" value={form.calls_count ?? ''} onChange={e => change('calls_count',e.target.value ? Number(e.target.value) : null)} /></label><AppButton colorPrefix="p" variant="subtle" size="sm" disabled={!validPeriod || meetings.isPending} onClick={() => meetings.mutate()}>Подставить завершённые встречи</AppButton></section>}
          <section className="space-y-3 border-b border-p-line p-4"><label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5" checked={form.include_amount} onChange={e => { const hint = profile.data?.service_hints[template]?.confirmed_price; setForm(old => ({ ...old, verified: false, include_amount:e.target.checked, currency:hint?.currency || old.currency, lines:old.lines.map(line => ({ ...line, unit_price:line.unit_price || (old.lines.length===1 ? hint?.amount || null : null) })) })) }} />Указать стоимость оказанных услуг</label>{form.include_amount && <><p className="text-xs text-p-muted">Укажите стоимость именно этих услуг за выбранный период. Общая сумма договора сюда не переносится.</p><label className="block text-sm">Валюта<select className={input} value={form.currency} onChange={e => change('currency',e.target.value as ActInput['currency'])}>{['KZT','RUB','USD','EUR'].map(c => <option key={c}>{c}</option>)}</select></label>{form.lines.map((line,i) => <label key={i} className="block text-sm">{form.lines.length===1 ? 'Стоимость этапа' : `Цена за единицу · услуга ${i+1}`}<input className={input} type="number" min="0" step="0.01" value={line.unit_price ?? ''} onChange={e => lineChange(i,'unit_price',e.target.value || null)} /></label>)}</>}</section>
          <label className="flex items-start gap-3 rounded-xl bg-p-bg p-4 text-sm leading-relaxed"><input type="checkbox" checked={form.verified} className="mt-1 shrink-0" onChange={e => change('verified',e.target.checked)} /><span>Проверены реквизиты. Выбранные услуги предусмотрены договором и фактически выполнены; указанная стоимость соответствует договору.</span></label>
          {template === 'final' && <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.full_completion_confirmed} onChange={e => change('full_completion_confirmed',e.target.checked)} />Подтверждаю исполнение всего договора.</label>}
        </fieldset>
      </div>
      <aside className={`${!mobilePreview ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col border-p-line bg-p-bg p-3 lg:border-l sm:p-5`}>
        <div className="mb-3 flex items-center justify-between text-xs text-p-muted"><span>Предпросмотр PDF</span><span>Обновляется автоматически</span></div>
        {previewUrl ? <iframe title="Предпросмотр акта PDF" src={previewUrl} className="min-h-0 w-full flex-1 border-b border-p-line bg-white" /> : <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-p-line p-6 text-center"><FileText className="mb-4 text-p-muted" size={32} /><p className="text-sm font-medium">{complete && active ? 'Готовим предпросмотр…' : 'Здесь появится ваш акт'}</p><p className="mt-2 max-w-xs text-xs leading-relaxed text-p-muted">{previewError || (missing.length ? 'Дополните реквизиты и отметьте выполненные услуги.' : 'Укажите период и отметьте выполненные услуги — документ появится автоматически.')}</p></div>}
      </aside>
    </div>
  </DialogContent></Dialog>
}
