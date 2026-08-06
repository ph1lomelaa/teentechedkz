import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FilePlus2, Send } from 'lucide-react'
import { contractAddendaApi, ContractAddendum } from '@/api/contractAddenda'
import { AppButton } from '@/components/ui'
import { toast } from '@/hooks/use-toast'

const STATUS_LABELS: Record<ContractAddendum['status'], string> = {
  draft: 'Черновик', sent_to_customer: 'Ожидает заказчика', customer_signed: 'Подписано заказчиком',
  company_signed: 'Подписано компанией', active: 'Действует', renewal_due: 'К возобновлению',
  completed: 'Завершено', cancelled: 'Отменено',
}

export const ContractAddendaSection: React.FC<{ studentId: string; contractId: string; canEdit: boolean }> = ({ studentId, contractId, canEdit }) => {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')
  const [reason, setReason] = useState('')
  const [resumeDate, setResumeDate] = useState('')
  const queryKey = ['contract-addenda', studentId]
  const { data = [] } = useQuery({ queryKey, queryFn: () => contractAddendaApi.listByStudent(studentId) })
  const invalidate = () => queryClient.invalidateQueries({ queryKey })
  const mutation = useMutation({
    mutationFn: () => contractAddendaApi.create({ contract_id: contractId, student_id: studentId, number, reason, resume_date: resumeDate || null }),
    onSuccess: () => { invalidate(); setOpen(false); setNumber(''); setReason(''); setResumeDate(''); toast({ title: 'Соглашение создано' }) },
    onError: () => toast({ title: 'Не удалось создать соглашение', variant: 'destructive' }),
  })
  const action = useMutation({
    mutationFn: ({ id, type }: { id: string; type: 'send' | 'signCustomer' | 'signCompany' }) => type === 'send' ? contractAddendaApi.send(id) : type === 'signCustomer' ? contractAddendaApi.signCustomer(id) : contractAddendaApi.signCompany(id),
    onSuccess: invalidate,
    onError: () => toast({ title: 'Действие недоступно для текущего статуса', variant: 'destructive' }),
  })

  return (
    <div className="mt-4 border-t border-p-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-p-text">Дополнительные соглашения</h4>
          <p className="mt-1 text-xs text-p-muted">Перенос, возобновление и контрольные точки договора</p>
        </div>
        {canEdit && <AppButton colorPrefix="p" onClick={() => setOpen((value) => !value)}><FilePlus2 className="h-4 w-4" /> Добавить</AppButton>}
      </div>
      {open && canEdit && (
        <div className="mt-3 grid gap-2 rounded-card border border-p-line bg-p-bg p-3 sm:grid-cols-3">
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Номер" className="h-9 rounded-ctl border border-p-line bg-white px-2 text-sm" />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина переноса" className="h-9 rounded-ctl border border-p-line bg-white px-2 text-sm sm:col-span-2" />
          <label className="text-xs text-p-muted">Дата возобновления<input type="date" value={resumeDate} onChange={(e) => setResumeDate(e.target.value)} className="mt-1 h-9 w-full rounded-ctl border border-p-line bg-white px-2 text-sm text-p-text" /></label>
          <div className="flex items-end sm:col-span-2"><AppButton colorPrefix="p" disabled={!number.trim() || !reason.trim() || mutation.isPending} onClick={() => mutation.mutate()}>Создать черновик</AppButton></div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {data.length === 0 ? <p className="text-sm text-p-muted">Соглашений пока нет.</p> : data.map((item) => (
          <div key={item.id} className="rounded-card border border-p-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><span className="font-semibold text-p-text">№ {item.number}</span><span className="ml-2 text-xs text-p-muted">{STATUS_LABELS[item.status]}</span><p className="mt-1 text-sm text-p-muted">{item.reason}</p></div>
              <div className="flex gap-2">
                {canEdit && item.status === 'draft' && <AppButton colorPrefix="p" onClick={() => action.mutate({ id: item.id, type: 'send' })}><Send className="h-4 w-4" /></AppButton>}
                {canEdit && item.status === 'sent_to_customer' && <AppButton colorPrefix="p" onClick={() => action.mutate({ id: item.id, type: 'signCustomer' })}><Check className="h-4 w-4" /> Заказчик</AppButton>}
                {canEdit && item.status === 'customer_signed' && <AppButton colorPrefix="p" onClick={() => action.mutate({ id: item.id, type: 'signCompany' })}><Check className="h-4 w-4" /> Компания</AppButton>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
