import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, financeKeys, type FinanceChange, type PaymentMethod, type ScheduleItem, type ScheduleKind } from '@/api/finance'
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
    setAmount(formatAmountInput(String(Math.round(Number.parseFloat(item.left)))))
    setPaidAt(localIso())
    setMethod('kaspi')
    setNote('')
    setFile(null)
  }, [item])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || !paidAt || paidAt > localIso()

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
        title: result.state === 'paid' ? 'Оплата сохранена' : 'Частичная оплата сохранена',
        description: receiptFailed ? 'Чек не загрузился. Прикрепите его в разделе «Проверка».' : `${result.student_name} · ${money(value)}`,
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
            {pay.isPending ? 'Сохранение…' : 'Сохранить оплату'}
          </FinButton>
        </>
      }
    >
      <form id="fin-pay" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) pay.mutate() }}>
        <FinField label="Сумма, ₸" required htmlFor="fin-pay-amount"
          hint={item && value > 0 && value < left ? `Частичная оплата: останется ${money(left - value)}` : undefined}>
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
  const [kind, setKind] = useState<ScheduleKind>('main')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(localIso())
  const [note, setNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(item?.kind ?? 'main')
    setLabel(item?.label ?? '')
    const preset = item ? Number.parseFloat(item.amount) : presetAmount
    setAmount(preset ? formatAmountInput(String(Math.round(preset))) : '')
    setDueDate(item?.due_date ?? localIso())
    setNote(item?.note ?? '')
    setConfirmDelete(false)
  }, [open, item, presetAmount])

  const value = parseAmountInput(amount)
  const invalid = value <= 0 || !dueDate
  const payload = () => ({ kind, label: label.trim() || null, amount: String(value), due_date: dueDate, note: note.trim() || null })

  const save = useMutation({
    mutationFn: () => (item ? financeApi.updateItem(item.id, payload()) : financeApi.createItem({ contract_id: contractId, ...payload() })),
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
      <form id="fin-schedule" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate() }}>
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
