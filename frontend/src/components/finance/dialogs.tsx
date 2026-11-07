import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, financeKeys, type ReceivedPayment, type FinanceChange, type PaymentMethod, type ScheduleItem, type ScheduleKind } from '@/api/finance'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { FileDrop, FinButton, FinField, FinInput, FinModal, FinSelect, MoneyInput } from './ui'
import { KIND_LABELS, METHOD_LABELS, date, formatAmountInput, localIso, money, parseAmountInput, paymentTitle } from './format'

function useInvalidateFinance() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: financeKeys.all })
}

const METHODS: PaymentMethod[] = ['kaspi', 'bank', 'cash']

/** «Отметить оплату». Сумма по умолчанию — остаток платежа; меньшая сумма —
 * частичная оплата, платёж остаётся открытым на разницу. */
export function PayDialog({ item, onClose }: { item: ScheduleItem | null; onClose: () => void }) {
  const invalidate = useInvalidateFinance()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(localIso())
  const [method, setMethod] = useState<PaymentMethod>('kaspi')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)

  useEffect(() => {
    if (!item) return
    setAmount(formatAmountInput(item.left))
    setPaidAt(localIso())
    setMethod('kaspi')
    setNote('')
    setFile(null)
  }, [item])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || (item ? value > Number(item.left) : true) || !paidAt || paidAt > localIso()

  const pay = useMutation({
    mutationFn: async () => {
      if (!item) throw new Error('Не выбран платёж')
      const result = await financeApi.pay(item.id, { amount: String(value), paid_at: paidAt, method, note: note.trim() || null })
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
      return { result, receiptFailed }
    },
    onSuccess: ({ result, receiptFailed }) => {
      invalidate()
      toast({
        title: result.state === 'paid' ? 'Отмечено' : 'Отмечена частичная оплата',
        description: receiptFailed ? 'Чек не загрузился. Прикрепите его в разделе «Проверка».' : `${result.student_name} · ${money(value, item?.currency)}`,
        variant: receiptFailed ? 'destructive' : undefined,
      })
      onClose()
    },
    onError: (err) => toast({ title: 'Оплата не сохранена', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const left = item ? Number.parseFloat(item.left) : 0
  return (
    <FinModal
      open={!!item}
      onClose={onClose}
      title="Отметить оплату"
      context={item ? `${item.student_name} · ${paymentTitle(item)} · срок ${date(item.due_date)}` : undefined}
      footer={
        <>
          <FinButton onClick={onClose}>Отмена</FinButton>
          <FinButton variant="primary" type="submit" form="fin-pay" disabled={invalid || pay.isPending}>
            {pay.isPending ? 'Сохранение…' : 'Отметить'}
          </FinButton>
        </>
      }
    >
      <p className="mb-4 text-sm text-p-muted">Отметка видна только в разделе «Финансы»: остаток договора и Notion не меняются, ученику ничего не отправляется.</p>
      <form id="fin-pay" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid && !pay.isPending) pay.mutate() }}>
        <FinField label={`Сумма, ${item?.currency ?? 'KZT'}`} required htmlFor="fin-pay-amount"
          hint={item && value > 0 && value < left ? `Частичная оплата: останется ${money(left - value, item?.currency)}` : undefined}>
          <MoneyInput id="fin-pay-amount" value={amount} onChange={setAmount} required />
        </FinField>
        <FinField label="Дата оплаты" required htmlFor="fin-pay-date">
          <FinInput id="fin-pay-date" type="date" max={localIso()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
        </FinField>
        <FinField label="Способ" htmlFor="fin-pay-method" wide>
          <FinSelect id="fin-pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </FinSelect>
        </FinField>
        <FinField label="Чек или квитанция" wide htmlFor="fin-pay-file">
          <FileDrop id="fin-pay-file" file={file} onFile={setFile} />
        </FinField>
        <FinField label="Комментарий" wide htmlFor="fin-pay-note">
          <FinInput id="fin-pay-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Например: оплатил отец, перевод с карты" />
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
  onClose,
}: {
  open: boolean
  contractId: string
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

  useEffect(() => {
    if (!open) return
    creation.current = null
    setKind(item?.kind ?? 'main')
    setLabel(item?.label ?? '')
    const preset = item ? Number.parseFloat(item.amount) : presetAmount
    setAmount(preset ? formatAmountInput(String(preset)) : '')
    setDueDate(item?.due_date ?? localIso())
    setNote(item?.note ?? '')
    setConfirmDelete(false)
  }, [open, item, presetAmount])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || !dueDate
  const payload = () => ({ kind, label: label.trim() || null, amount: String(value), due_date: dueDate, note: note.trim() || null })

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
  const remove = useMutation({
    mutationFn: () => financeApi.deleteItem(item!.id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Платёж убран из графика' })
      onClose()
    },
    onError: (err) => toast({ title: 'Платёж не убран', description: getErrorMessage(err), variant: 'destructive' }),
  })
  const canDelete = !!item && Number.parseFloat(item.paid) === 0

  return (
    <FinModal
      open={open}
      onClose={onClose}
      title="Платёж по графику"
      context={item ? `${item.student_name} · ${paymentTitle(item)}` : 'Новый платёж в графике договора'}
      danger={canDelete && (confirmDelete ? (
        <span className="flex items-center gap-2 text-[13px] text-p-muted">
          Убрать платёж?
          <FinButton size="sm" variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Да, убрать</FinButton>
          <FinButton size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Нет</FinButton>
        </span>
      ) : (
        <FinButton variant="danger" onClick={() => setConfirmDelete(true)}>Убрать из графика</FinButton>
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
        <FinField label="Срок оплаты" required htmlFor="fin-s-due">
          <FinInput id="fin-s-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
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
  const candidates = items.filter(i => i.currency === payment?.currency && Number(i.left) >= Number(payment?.amount))
  const save = useMutation({ mutationFn: () => financeApi.allocatePayment(payment!.id, itemId), onSuccess: () => { invalidate(); onClose(); toast({ title: 'Оплата привязана к графику' }) }, onError: e => toast({ title: 'Не удалось привязать', description: getErrorMessage(e), variant: 'destructive' }) })
  return <FinModal open={!!payment} onClose={onClose} title="Привязать полученную оплату" footer={<><FinButton onClick={onClose}>Отмена</FinButton><FinButton variant="primary" disabled={!itemId || save.isPending} onClick={() => save.mutate()}>Привязать</FinButton></>}>
    <p className="mb-4 text-sm">Оплата уже учтена в остатке договора. Привязка закроет соответствующую часть графика и не спишет сумму повторно.</p>
    <FinSelect aria-label="Платёж графика" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Выберите строку графика</option>{candidates.map(i => <option key={i.id} value={i.id}>{paymentTitle(i)} · {date(i.due_date)} · {money(i.left, i.currency)}</option>)}</FinSelect>
    {!candidates.length && <p className="mt-3 text-sm">Нет строки графика с достаточным неоплаченным остатком в этой валюте.</p>}
  </FinModal>
}
