import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { trustmeApi, type ContractDetails, type TrustMeCandidate } from '@/api/trustme'
import { actsApi } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { getErrorMessage } from '@/lib/errorMessage'
import { documentLink, neutralDisabled } from './contractPresentation'

const input = 'mt-1 block w-full min-w-0 rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm text-p-text'
export function ContractDetailsEditor({ studentId, contract, onSaved, onClose }: {
  studentId: string; contract: TrustMeCandidate & { id: string }; onSaved: () => void; onClose: () => void
}) {
  const [form, setForm] = useState<ContractDetails>({ name: contract.name, contract_number: contract.legal_number || '', contract_date: contract.contract_date || null,
    signed_date: contract.signed_date || null, customer_name: contract.customer_name || '', student_name: contract.student_name || '', signed_confirmed: contract.status === 3 })
  const dirty = useRef(new Set<string>())
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const inspection = useQuery({ queryKey: ['contract-details', studentId, contract.id], queryFn: () => trustmeApi.inspect(studentId, contract.id), retry: false, staleTime: 0 })
  useEffect(() => {
    if (!inspection.data) return
    const data = inspection.data
    setForm(old => {
      const next = { ...old }
      for (const key of ['contract_number', 'contract_date', 'customer_name', 'student_name'] as const) {
        if (!dirty.current.has(key) && data.fields[key]) next[key] = data.fields[key]!
      }
      if ((data.signed_date_source === 'trustme' || !dirty.current.has('signed_date')) && data.signed_date) next.signed_date = data.signed_date
      return next
    })
  }, [inspection.data])
  function change<K extends keyof ContractDetails>(key: K, value: ContractDetails[K]) { dirty.current.add(key); setForm(old => ({ ...old, [key]: value })) }
  const save = useMutation({ mutationFn: () => trustmeApi.details(studentId, contract.id, form), onSuccess: () => { onSaved(); onClose() }, retry: false })
  const pdf = useMutation({ mutationFn: async () => { const blob = await actsApi.contractPdf(studentId, contract.id); setPreview(URL.createObjectURL(blob)) }, retry: false })
  const lockedDate = contract.signed_date_source === 'trustme' || inspection.data?.signed_date_source === 'trustme'
  return <section aria-label="Реквизиты договора" className="space-y-4 border-t border-p-line py-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Проверить реквизиты договора</h3><button className={documentLink} onClick={onClose}>Закрыть</button></div>
    {inspection.isFetching && <p role="status" className="text-sm text-p-muted">Читаем договор. Для сканов распознавание может занять около минуты…</p>}
    {inspection.error && <p role="alert" className="text-sm text-amber-800">Не удалось прочитать договор автоматически. Откройте PDF и заполните данные вручную. <button className="underline" onClick={() => inspection.refetch()}>Повторить</button></p>}
    {inspection.data?.pages.some(page => page.ocr_skipped) && <p className="text-sm text-amber-800">Часть страниц не удалось распознать. Проверьте реквизиты по оригиналу PDF и дополните пустые поля.</p>}
    {!!Object.keys(inspection.data?.conflicts || {}).length && <p className="text-sm text-amber-800">В документе есть противоречивые реквизиты. Проверьте их по PDF.</p>}
    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
      <label className="text-xs text-p-muted sm:col-span-2">Название<input className={input} value={form.name} maxLength={500} onChange={e => change('name', e.target.value)} /></label>
      <label className="text-xs text-p-muted">Номер договора<input className={input} value={form.contract_number} maxLength={100} onChange={e => change('contract_number', e.target.value)} /></label>
      <label className="text-xs text-p-muted">Дата договора<input type="date" className={input} value={form.contract_date || ''} onChange={e => change('contract_date', e.target.value || null)} /><span className="mt-1 block">Дата, указанная в тексте договора</span></label>
      <label className="text-xs text-p-muted">Дата подписания<input type="date" className={input} value={form.signed_date || ''} disabled={lockedDate} onChange={e => change('signed_date', e.target.value || null)} /><span className="mt-1 block">{lockedDate ? 'Подтверждена TrustMe' : inspection.data?.signed_date_source === 'pdf' ? 'Найдена в тексте PDF — проверьте по оригиналу' : 'Укажите по подтверждению подписания; не подставляйте дату загрузки'}</span></label>
      <label className="text-xs text-p-muted">Подписант / заказчик<input className={input} value={form.customer_name} maxLength={300} onChange={e => change('customer_name', e.target.value)} /></label>
      <label className="text-xs text-p-muted">Студент в договоре<input className={input} value={form.student_name} maxLength={300} onChange={e => change('student_name', e.target.value)} /></label>
    </div>
    {contract.source === 'manual' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={form.signed_confirmed} onChange={e => change('signed_confirmed', e.target.checked)} />Проверено по документу: договор подписан обеими сторонами</label>}
    <div className="flex flex-wrap justify-end gap-3"><button className={documentLink} disabled={pdf.isPending} onClick={() => pdf.mutate()}>Открыть PDF</button><AppButton colorPrefix="p" variant="subtle" size="sm" className={neutralDisabled} disabled={save.isPending || inspection.isFetching || !form.name.trim()} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняем…' : 'Сохранить реквизиты'}</AppButton></div>
    {(save.error || pdf.error) && <p role="alert" className="text-sm text-red-700">{getErrorMessage(save.error || pdf.error)}</p>}
    {preview && <iframe title="Оригинал договора" src={preview} className="h-[65dvh] w-full border border-p-line" />}
  </section>
}
