import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { financeApi, financeKeys, PAYER_LABELS, type AllocationPreview, type Payer, type PaymentPatch, type ReceivedPayment, type FinanceChange, type PaymentMethod, type ScheduleItem, type ScheduleKind } from '@/api/finance'
import { toast } from '@/hooks/use-toast'
import { getErrorCode, getErrorMessage } from '@/lib/errorMessage'
import { FileDrop, FinButton, FinField, FinInput, FinModal, FinSelect, MoneyInput } from './ui'
import { KIND_LABELS, METHOD_LABELS, date, formatAmountInput, localIso, money, num, parseAmountInput, paymentTitle } from './format'

function useInvalidateFinance() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: financeKeys.all })
}

const METHODS: PaymentMethod[] = ['kaspi', 'bank', 'cash']

/** Договор, по которому вносят оплату без выбранной строки графика. */
export interface PayContract { id: string; student_name: string; currency: string }

const PAYERS: Payer[] = ['student', 'parent', 'other']

/** Предпросмотр распределения: «Закроет: 1 из 3, частично 2 из 3; аванс X». */
function usePreview(contractId: string | undefined, value: number, itemId?: string | null, paymentId?: string | null) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = window.setTimeout(() => setDebounced(value), 300); return () => window.clearTimeout(t) }, [value])
  return useQuery({
    queryKey: ['finance', 'pay-preview', contractId, debounced, itemId, paymentId],
    queryFn: () => financeApi.previewPayment(contractId!, { amount: String(debounced), schedule_item_id: itemId, payment_id: paymentId }),
    enabled: !!contractId && debounced > 0,
    staleTime: 10_000,
  })
}

function PreviewLine({ preview, currency }: { preview?: AllocationPreview; currency?: string }) {
  if (!preview) return null
  const parts = preview.parts.map((p) => `${paymentTitle({ kind: p.kind, label: p.label })}${p.closes ? '' : ` частично, останется ${money(p.left_after, currency)}`}`)
  const advance = num(preview.advance)
  return (
    <div className="sm:col-span-2 rounded-[6px] border border-p-line px-3 py-2 text-[13px]">
      {parts.length > 0 ? <div>Закроет: {parts.join('; ')}</div> : <div>Неоплаченных платежей в графике нет.</div>}
      {advance > 0 && <div className="mt-1">Больше, чем ждём по графику: {money(advance, currency)} станет авансом клиента.</div>}
    </div>
  )
}

/** «Отметить оплату» по строке графика или по договору целиком. Сумма по
 * умолчанию — остаток платежа; меньшая — частичная оплата, большая ложится
 * на следующие платежи, а что не легло — аванс клиента. */
export function PayDialog({ item, contract, onClose }: { item: ScheduleItem | null; contract?: PayContract | null; onClose: () => void }) {
  const invalidate = useInvalidateFinance()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(localIso())
  const [method, setMethod] = useState<PaymentMethod>('kaspi')
  const [payer, setPayer] = useState<Payer | ''>('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [duplicate, setDuplicate] = useState(false)
  const open = !!item || !!contract
  const contractId = item?.contract_id ?? contract?.id
  const currency = item?.currency ?? contract?.currency
  const studentName = item?.student_name ?? contract?.student_name

  useEffect(() => {
    if (!open) return
    setAmount(item ? formatAmountInput(item.left) : '')
    setPaidAt(localIso())
    setMethod('kaspi')
    setPayer('')
    setNote('')
    setFile(null)
    setDuplicate(false)
  }, [open, item, contract])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || !paidAt || paidAt > localIso()
  const preview = usePreview(open ? contractId : undefined, value, item?.id)

  const pay = useMutation({
    mutationFn: async () => {
      const data = { amount: String(value), paid_at: paidAt, method, payer: payer || null, note: note.trim() || null, confirm_duplicate: duplicate }
      const result = item ? await financeApi.pay(item.id, data) : await financeApi.addPayment(contractId!, data)
      // Чек — после оплаты: платёж уже записан, и сбой загрузки не должен
      // выглядеть так, будто оплата не прошла.
      let receiptFailed = false
      if (file) {
        try {
          await financeApi.uploadReceipt(result.payment_id, file)
        } catch {
          receiptFailed = true
        }
      }
      return { advance: num(result.advance ?? '0'), receiptFailed }
    },
    onSuccess: ({ advance, receiptFailed }) => {
      invalidate()
      toast({
        title: 'Оплата внесена',
        description: receiptFailed ? 'Чек не загрузился. Прикрепите его в разделе «Проверка».'
          : `${studentName} · ${money(value, currency)}${advance > 0 ? ` · аванс ${money(advance, currency)}` : ''}`,
        variant: receiptFailed ? 'destructive' : undefined,
      })
      onClose()
    },
    onError: (err) => {
      if (getErrorCode(err) === 'DUPLICATE_PAYMENT') { setDuplicate(true); return }
      toast({ title: 'Оплата не сохранена', description: getErrorMessage(err), variant: 'destructive' })
    },
  })

  return (
    <FinModal
      open={open}
      onClose={onClose}
      title="Отметить оплату"
      context={item ? `${item.student_name} · ${paymentTitle(item)}${item.due_date ? ` · срок ${date(item.due_date)}` : ''}` : studentName}
      footer={
        <>
          <FinButton onClick={onClose}>Отмена</FinButton>
          <FinButton variant="primary" type="submit" form="fin-pay" disabled={invalid || pay.isPending}>
            {pay.isPending ? 'Сохранение…' : duplicate ? 'Всё равно добавить' : 'Сохранить оплату'}
          </FinButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-p-muted">Остаток в Notion обновляет менеджер.</p>
      {duplicate && (
        <p role="alert" className="mb-4 rounded-[6px] border border-p-line px-3 py-2 text-sm">
          Похоже, эта оплата уже внесена: по договору есть оплата {money(value, currency)} от {date(paidAt)}. Всё равно добавить?
        </p>
      )}
      <form id="fin-pay" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid && !pay.isPending) pay.mutate() }}>
        <FinField label={`Сумма, ${currency ?? 'KZT'}`} required htmlFor="fin-pay-amount">
          <MoneyInput id="fin-pay-amount" value={amount} onChange={(v) => { setAmount(v); setDuplicate(false) }} required />
        </FinField>
        <FinField label="Дата оплаты" required htmlFor="fin-pay-date">
          <FinInput id="fin-pay-date" type="date" max={localIso()} value={paidAt} onChange={(e) => { setPaidAt(e.target.value); setDuplicate(false) }} required />
        </FinField>
        <PreviewLine preview={value > 0 ? preview.data : undefined} currency={currency} />
        <FinField label="Способ" htmlFor="fin-pay-method">
          <FinSelect id="fin-pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Плательщик" htmlFor="fin-pay-payer">
          <FinSelect id="fin-pay-payer" value={payer} onChange={(e) => setPayer(e.target.value as Payer | '')}>
            <option value="">Не указан</option>
            {PAYERS.map((p) => <option key={p} value={p}>{PAYER_LABELS[p]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Чек или квитанция" wide htmlFor="fin-pay-file">
          <FileDrop id="fin-pay-file" file={file} onFile={setFile} />
        </FinField>
        <FinField label="Комментарий" wide htmlFor="fin-pay-note">
          <FinInput id="fin-pay-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Например: перевод с карты отца" />
        </FinField>
      </form>
    </FinModal>
  )
}

/** Исправить или отменить оплату. Причина обязательна, всё — в историю договора. */
export function PaymentEditDialog({ payment, onClose }: { payment: ReceivedPayment | null; onClose: () => void }) {
  const invalidate = useInvalidateFinance()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('kaspi')
  const [payer, setPayer] = useState<Payer | ''>('')
  const [reason, setReason] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!payment) return
    setAmount(formatAmountInput(payment.amount))
    setPaidAt(payment.paid_at ?? localIso())
    setMethod(payment.method ?? 'kaspi')
    setPayer(payment.payer ?? '')
    setReason('')
    setDuplicate(false)
    setCancelling(false)
  }, [payment])

  const value = parseAmountInput(amount)
  const noReason = reason.trim().length < 3
  const invalid = value <= 0 || !paidAt || paidAt > localIso() || noReason
  const amountChanged = !!payment && value !== num(payment.amount)
  const preview = usePreview(payment && amountChanged ? payment.contract_id : undefined, value, null, payment?.id)

  const save = useMutation({
    mutationFn: () => {
      const data: PaymentPatch = { reason: reason.trim(), confirm_duplicate: duplicate }
      if (amountChanged) data.amount = String(value)
      if (paidAt !== payment!.paid_at) data.paid_at = paidAt
      if (method !== payment!.method) data.method = method
      if ((payer || null) !== (payment!.payer ?? null)) data.payer = payer || null
      return financeApi.updatePayment(payment!.id, data)
    },
    onSuccess: () => { invalidate(); toast({ title: 'Оплата исправлена', description: 'Было и стало — в истории договора.' }); onClose() },
    onError: (err) => {
      if (getErrorCode(err) === 'DUPLICATE_PAYMENT') { setDuplicate(true); return }
      toast({ title: 'Оплата не исправлена', description: getErrorMessage(err), variant: 'destructive' })
    },
  })
  const cancel = useMutation({
    mutationFn: () => financeApi.cancelPayment(payment!.id, reason.trim()),
    onSuccess: () => { invalidate(); toast({ title: 'Оплата отменена', description: 'Она осталась в истории зачёркнутой.' }); onClose() },
    onError: (err) => toast({ title: 'Оплата не отменена', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <FinModal
      open={!!payment}
      onClose={onClose}
      title="Исправить оплату"
      context={payment ? `${payment.student_name} · ${money(payment.amount, payment.currency)} от ${date(payment.paid_at)}` : undefined}
      danger={cancelling ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-p-muted">
          Отменить оплату {payment && money(payment.amount, payment.currency)}?
          <FinButton size="sm" variant="danger" disabled={noReason || cancel.isPending} onClick={() => cancel.mutate()}>Да, отменить</FinButton>
          <FinButton size="sm" variant="ghost" onClick={() => setCancelling(false)}>Нет</FinButton>
        </span>
      ) : (
        <FinButton variant="danger" disabled={noReason} onClick={() => setCancelling(true)}>Отменить оплату</FinButton>
      )}
      footer={
        <>
          <FinButton onClick={onClose}>Закрыть</FinButton>
          <FinButton variant="primary" type="submit" form="fin-pay-edit" disabled={invalid || save.isPending}>
            {save.isPending ? 'Сохранение…' : duplicate ? 'Всё равно сохранить' : 'Сохранить'}
          </FinButton>
        </>
      }
    >
      {duplicate && (
        <p role="alert" className="mb-4 rounded-[6px] border border-p-line px-3 py-2 text-sm">
          Похоже, такая оплата уже внесена. Всё равно сохранить?
        </p>
      )}
      <form id="fin-pay-edit" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid && !save.isPending) save.mutate() }}>
        <FinField label={`Сумма, ${payment?.currency ?? 'KZT'}`} required htmlFor="fin-edit-amount">
          <MoneyInput id="fin-edit-amount" value={amount} onChange={(v) => { setAmount(v); setDuplicate(false) }} required />
        </FinField>
        <FinField label="Дата оплаты" required htmlFor="fin-edit-date">
          <FinInput id="fin-edit-date" type="date" max={localIso()} value={paidAt} onChange={(e) => { setPaidAt(e.target.value); setDuplicate(false) }} required />
        </FinField>
        {amountChanged && <PreviewLine preview={preview.data} currency={payment?.currency} />}
        <FinField label="Способ" htmlFor="fin-edit-method">
          <FinSelect id="fin-edit-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(['kaspi', 'bank', 'cash', 'other'] as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Плательщик" htmlFor="fin-edit-payer">
          <FinSelect id="fin-edit-payer" value={payer} onChange={(e) => setPayer(e.target.value as Payer | '')}>
            <option value="">Не указан</option>
            {PAYERS.map((p) => <option key={p} value={p}>{PAYER_LABELS[p]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Причина" required wide htmlFor="fin-edit-reason" hint="Нужна и для исправления, и для отмены. Видна в истории договора.">
          <FinInput id="fin-edit-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Например: опечатка в сумме" />
        </FinField>
      </form>
    </FinModal>
  )
}

/** «Платёж по графику»: добавить или изменить платёж договора. */
export function ScheduleItemDialog({
  open,
  contractId,
  item,
  undistributed,
  presetAmount,
  startCancel,
  onClose,
}: {
  open: boolean
  contractId: string
  /** Открыть сразу на отмене платежа (меню «…» → «Отменить платёж»). */
  startCancel?: boolean
  item?: ScheduleItem | null
  /** Сколько остатка не разложено по графику — подсказка под суммой. */
  undistributed?: number | null
  presetAmount?: number
  onClose: () => void
}) {
  const invalidate = useInvalidateFinance()
  const creation = useRef<{ fingerprint: string; key: string } | null>(null)
  const [kind, setKind] = useState<ScheduleKind>('main')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(localIso())
  const [note, setNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [afterOffer, setAfterOffer] = useState(false)

  useEffect(() => {
    if (!open) return
    creation.current = null
    setKind(item?.kind ?? 'main')
    setLabel(item?.label ?? '')
    const preset = item ? Number.parseFloat(item.amount) : presetAmount
    setAmount(preset ? formatAmountInput(String(preset)) : '')
    setDueDate(item?.due_date ?? localIso())
    setAfterOffer(!!item?.after_offer && !item?.due_date)
    setNote(item?.note ?? '')
    setConfirmDelete(!!startCancel)
    setCancelReason('')
  }, [open, item, presetAmount, startCancel])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || (!dueDate && !afterOffer)
  // «После оффера»: срока нет, он поставится сам при отметке оффера (дата оффера + 5 дней).
  const payload = () => ({ kind, label: label.trim() || null, amount: String(value), due_date: afterOffer ? null : dueDate,
    ...(item ? {} : { after_offer: afterOffer }), note: note.trim() || null })

  const save = useMutation({
    mutationFn: () => {
      const data = payload()
      if (item) return financeApi.updateItem(item.id, data)
      const fingerprint = JSON.stringify([contractId, data])
      if (creation.current?.fingerprint !== fingerprint) creation.current = { fingerprint, key: crypto.randomUUID() }
      return financeApi.createItem({ contract_id: contractId, ...data, operation_key: creation.current.key })
    },
    onSuccess: () => {
      invalidate()
      toast({ title: item ? 'Платёж изменён' : 'Платёж добавлен в график' })
      onClose()
    },
    onError: (err) => toast({ title: 'Платёж не сохранён', description: getErrorMessage(err), variant: 'destructive' }),
  })
  // Ничего не удаляем (решение 14.11): платёж отменяется с причиной и
  // остаётся в истории договора зачёркнутым.
  const remove = useMutation({
    mutationFn: () => financeApi.cancelItem(item!.id, cancelReason.trim()),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Платёж отменён', description: 'Он остался в графике договора зачёркнутым.' })
      onClose()
    },
    onError: (err) => toast({ title: 'Платёж не отменён', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const canDelete = !!item && item.state !== 'cancelled' && Number.parseFloat(item.paid) === 0

  return (
    <FinModal
      open={open}
      onClose={onClose}
      title="Платёж по графику"
      context={item ? `${item.student_name} · ${paymentTitle(item)}` : 'Новый платёж в графике договора'}
      danger={canDelete && (confirmDelete ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-p-muted">
          <FinInput aria-label="Причина отмены" value={cancelReason} maxLength={500} autoFocus
            onChange={(e) => setCancelReason(e.target.value)} placeholder="Причина отмены" className="w-56" />
          <FinButton size="sm" variant="danger" onClick={() => remove.mutate()}
            disabled={remove.isPending || cancelReason.trim().length < 3}>Отменить платёж</FinButton>
          <FinButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Назад</FinButton>
        </span>
      ) : (
        <FinButton variant="danger" onClick={() => setConfirmDelete(true)}>Отменить платёж</FinButton>
      ))}
      footer={
        <>
          <FinButton onClick={onClose}>Отмена</FinButton>
          <FinButton variant="primary" type="submit" form="fin-schedule" disabled={invalid || save.isPending}>
            {save.isPending ? 'Сохранение…' : 'Сохранить'}
          </FinButton>
        </>
      }
    >
      <form id="fin-schedule" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid && !save.isPending) save.mutate() }}>
        <FinField label="За что" htmlFor="fin-s-kind">
          <FinSelect id="fin-s-kind" value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
            {(Object.keys(KIND_LABELS) as ScheduleKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Название" htmlFor="fin-s-label">
          <FinInput id="fin-s-label" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} placeholder="Например: 1 из 3" />
        </FinField>
        <FinField label="Сумма, ₸" required htmlFor="fin-s-amount"
          hint={undistributed !== undefined && undistributed !== null ? `Нет в графике: ${money(undistributed)}` : undefined}>
          <MoneyInput id="fin-s-amount" value={amount} onChange={setAmount} required />
        </FinField>
        <FinField label="Срок оплаты" required={!afterOffer} htmlFor="fin-s-due"
          hint={afterOffer ? 'Срок поставится сам, когда отметят оффер: дата оффера + 5 дней.' : undefined}>
          {afterOffer
            ? <FinInput id="fin-s-due" value="После оффера" disabled />
            : <FinInput id="fin-s-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />}
          {!item && (
            <label className="mt-2 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={afterOffer} onChange={(e) => setAfterOffer(e.target.checked)} />
              После оффера
            </label>
          )}
        </FinField>
        <FinField label="Комментарий" wide htmlFor="fin-s-note">
          <FinInput id="fin-s-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </FinField>
      </form>
    </FinModal>
  )
}

/** Подтвердить правку из Notion. Для даты оплаты спрашиваем, переносить ли
 * платёж в графике, — сама правка договора к этому моменту уже сделана синком. */
export function ConfirmChangeDialog({ change, onClose }: { change: FinanceChange | null; onClose: () => void }) {
  const invalidate = useInvalidateFinance()
  const accept = useMutation({
    mutationFn: (move: boolean) => financeApi.acceptChange(change!.id, move),
    onSuccess: (res) => {
      invalidate()
      toast({ title: res.moved_item_id ? 'Подтверждено, платёж перенесён' : 'Подтверждено' })
      onClose()
    },
    onError: (err) => toast({ title: 'Не подтверждено', description: getErrorMessage(err), variant: 'destructive' }),
  })
  return (
    <FinModal
      open={!!change}
      onClose={onClose}
      title="Подтвердить изменение даты"
      context={change ? `${change.student_name} · ${change.field_label}: ${change.old_label} → ${change.new_label}` : undefined}
      footer={
        <>
          <FinButton onClick={onClose}>Отмена</FinButton>
          <FinButton onClick={() => accept.mutate(false)} disabled={accept.isPending}>Не переносить</FinButton>
          <FinButton variant="primary" onClick={() => accept.mutate(true)} disabled={accept.isPending}>Перенести платёж</FinButton>
        </>
      }
    >
      <p className="text-sm text-p-text">
        Перенести ближайший неоплаченный платёж в графике на {change?.new_label}?
      </p>
      <p className="mt-2 text-[13px] text-p-muted">Если не переносить, изменение будет отмечено как проверенное, а график останется прежним.</p>
    </FinModal>
  )
}

/** «Прикрепить»: выбрать файл и сразу загрузить чек к платежу. */
export function AttachReceiptButton({ paymentId, label = 'Прикрепить' }: { paymentId: string; label?: string }) {
  const invalidate = useInvalidateFinance()
  const input = useRef<HTMLInputElement>(null)
  const upload = useMutation({
    mutationFn: (file: File) => financeApi.uploadReceipt(paymentId, file),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Чек прикреплён' })
    },
    onError: (err) => toast({ title: 'Чек не прикреплён', description: getErrorMessage(err), variant: 'destructive' }),
  })
  return (
    <>
      <FinButton size="sm" onClick={() => input.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? 'Загрузка…' : label}
      </FinButton>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        className="sr-only"
        aria-label="Файл чека"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload.mutate(f)
          e.target.value = ''
        }}
      />
    </>
  )
}


export function AllocatePaymentDialog({ payment, items, onClose }: { payment: ReceivedPayment | null; items: ScheduleItem[]; onClose: () => void }) {
  const invalidate = useInvalidateFinance()
  const [itemId, setItemId] = useState('')
  useEffect(() => { setItemId('') }, [payment])
  // Аванс кладётся на платёж целиком или частично: сколько поместится.
  const candidates = items.filter(i => i.currency === payment?.currency && Number(i.left) > 0)
  const save = useMutation({ mutationFn: () => financeApi.allocatePayment(payment!.id, itemId), onSuccess: () => { invalidate(); onClose(); toast({ title: 'Аванс положен на платёж' }) }, onError: e => toast({ title: 'Не удалось привязать', description: getErrorMessage(e), variant: 'destructive' }) })
  return <FinModal open={!!payment} onClose={onClose} title="Положить аванс на платёж" footer={<><FinButton onClick={onClose}>Отмена</FinButton><FinButton variant="primary" disabled={!itemId || save.isPending} onClick={() => save.mutate()}>Положить</FinButton></>}>
    <p className="mb-4 text-sm">Аванс {payment && money(payment.advance ?? payment.amount, payment.currency)} закроет выбранный платёж графика целиком или частично. Сумма оплаты не меняется.</p>
    <FinSelect aria-label="Платёж графика" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Выберите строку графика</option>{candidates.map(i => <option key={i.id} value={i.id}>{paymentTitle(i)} · {i.due_date ? date(i.due_date) : 'после оффера'} · {money(i.left, i.currency)}</option>)}</FinSelect>
    {!candidates.length && <p className="mt-3 text-sm">В графике нет неоплаченных платежей.</p>}
  </FinModal>
}

type Template = 'equal' | 'prepay'

/** «Расписать график» шаблоном: «Равными частями на N месяцев» или
 * «Предоплата + остаток после оффера». Все строки создаются одной операцией. */
export function SchedulePlanDialog({ open, contractId, total, onClose, onManual }: {
  open: boolean
  contractId: string
  /** Сколько расписать: остаток вне графика или остаток договора. */
  total: number
  onClose: () => void
  onManual: () => void
}) {
  const invalidate = useInvalidateFinance()
  const key = useRef<string>('')
  const [template, setTemplate] = useState<Template>('equal')
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('3')
  const [first, setFirst] = useState(localIso())
  const [prepay, setPrepay] = useState('')
  useEffect(() => {
    if (!open) return
    key.current = crypto.randomUUID()
    setTemplate('equal')
    setAmount(total > 0 ? formatAmountInput(String(total)) : '')
    setMonths('3')
    setFirst(localIso())
    setPrepay('')
  }, [open, total])

  const value = parseAmountInput(amount)
  const n = Math.max(1, Math.min(36, Number.parseInt(months, 10) || 0))
  const pre = parseAmountInput(prepay)
  const rows = (() => {
    if (value <= 0) return []
    if (template === 'equal') {
      // Копейки — в последний платёж, чтобы сумма сошлась до тиына.
      const part = Math.floor((value / n) * 100) / 100
      const [y, m, d] = first.split('-').map(Number)
      return Array.from({ length: n }, (_, i) => {
        const due = new Date(y, m - 1 + i, Math.min(d, new Date(y, m + i, 0).getDate()))
        return { amount: String(i === n - 1 ? Math.round((value - part * (n - 1)) * 100) / 100 : part), due_date: localIso(due), label: `${i + 1} из ${n}` }
      })
    }
    if (pre <= 0 || pre >= value) return []
    return [
      { amount: String(pre), due_date: first, label: 'Предоплата' },
      { amount: String(Math.round((value - pre) * 100) / 100), after_offer: true, due_date: null, label: 'Остаток после оффера' },
    ]
  })()

  const save = useMutation({
    mutationFn: () => financeApi.planSchedule(contractId, { operation_key: key.current, rows }),
    onSuccess: (res) => { invalidate(); toast({ title: res.repeated ? 'График уже расписан' : `В график добавлено платежей: ${res.created}` }); onClose() },
    onError: (err) => toast({ title: 'График не сохранён', description: getErrorMessage(err), variant: 'destructive' }),
  })

  return (
    <FinModal open={open} onClose={onClose} title="Расписать график"
      footer={<>
        <FinButton onClick={onClose}>Отмена</FinButton>
        <FinButton variant="primary" disabled={!rows.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохранение…' : 'Добавить в график'}</FinButton>
      </>}>
      <div role="radiogroup" aria-label="Шаблон" className="mb-4 flex flex-wrap gap-2">
        {([['equal', 'Равными частями'], ['prepay', 'Предоплата + остаток после оффера']] as const).map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={template === v} onClick={() => setTemplate(v)}
            className={template === v ? 'h-8 rounded-lg border border-p-text px-3 text-[13px] font-semibold' : 'h-8 rounded-lg border border-p-line px-3 text-[13px] text-p-muted hover:text-p-text'}>
            {label}
          </button>
        ))}
        <button type="button" onClick={() => { onClose(); onManual() }} className="h-8 rounded-lg border border-p-line px-3 text-[13px] text-p-muted hover:text-p-text">Вручную</button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FinField label="Сумма к расписанию, ₸" required htmlFor="fin-plan-amount">
          <MoneyInput id="fin-plan-amount" value={amount} onChange={setAmount} required />
        </FinField>
        {template === 'equal' ? (
          <FinField label="Месяцев" required htmlFor="fin-plan-months">
            <FinInput id="fin-plan-months" type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} />
          </FinField>
        ) : (
          <FinField label="Предоплата, ₸" required htmlFor="fin-plan-prepay">
            <MoneyInput id="fin-plan-prepay" value={prepay} onChange={setPrepay} required />
          </FinField>
        )}
        <FinField label={template === 'equal' ? 'Первый платёж' : 'Срок предоплаты'} required htmlFor="fin-plan-first">
          <FinInput id="fin-plan-first" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
        </FinField>
      </div>
      {rows.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-p-line">
                <td className="py-2">{r.label}</td>
                <td className="py-2">{r.due_date ? date(r.due_date) : 'после оффера, срок поставится сам'}</td>
                <td className="py-2 text-right tabular-nums">{money(r.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {template === 'prepay' && value > 0 && pre >= value && <p className="mt-3 text-sm text-[var(--fin-bad)]">Предоплата должна быть меньше суммы.</p>}
    </FinModal>
  )
}
