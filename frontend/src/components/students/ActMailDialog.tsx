import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { actsApi, type ActRecord } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'

export const MAIL_STATUS: Record<string, string> = { sending: 'Отправка выполняется', sent: 'Принято почтовым сервером', confirmed_sent: 'Отправка подтверждена сотрудником', failed: 'Не отправлено', unknown: 'Результат неизвестен — проверьте почту' }
const input = 'mt-1 block w-full rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm'
export function ActMailDialog({ act, recipients, onClose, onSent }: { act: ActRecord; recipients: string[]; onClose: () => void; onSent: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const [recipient, setRecipient] = useState(recipients[0] || '')
  const [subject, setSubject] = useState(`Акт оказанных услуг — ${act.student_name}`)
  const [body, setBody] = useState(`Здравствуйте!\n\nНаправляем акт оказанных услуг от ${act.act_date}. Документ приложен к письму.\n\nС уважением,\nTeenTechEd`)
  const send = useMutation({ mutationFn: () => actsApi.send(act.id, { request_id: requestId, recipient, subject, body }), onSuccess: onSent, retry: false })
  return <Dialog open onOpenChange={open => { if (!open && !send.isPending) onClose() }}><DialogContent>
    <DialogHeader><DialogTitle>Отправить акт</DialogTitle><DialogDescription className="break-words">Вложение: {act.file_name}</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!send.isPending && !send.data) send.mutate() }}>
      <fieldset disabled={send.isPending || !!send.data} className="space-y-4">
        <label className="block text-sm">Получатель<input className={input} type="email" required value={recipient} list="act-recipients" onChange={e => setRecipient(e.target.value)} /><datalist id="act-recipients">{recipients.map(email => <option key={email}>{email}</option>)}</datalist></label>
        <label className="block text-sm">Тема<input className={input} required maxLength={300} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="block text-sm">Текст письма<textarea className={input} required maxLength={10000} rows={6} value={body} onChange={e => setBody(e.target.value)} /></label>
        <div className="flex justify-end"><AppButton colorPrefix="p" variant="subtle" type="submit">{send.isPending ? 'Отправляем…' : 'Отправить с PDF'}</AppButton></div>
      </fieldset>
      {send.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(send.error, 'Не удалось отправить письмо')}</p>}
      {send.data && <p role="status" className="text-sm">{MAIL_STATUS[send.data.status] || send.data.status}</p>}
    </form>
  </DialogContent></Dialog>
}
