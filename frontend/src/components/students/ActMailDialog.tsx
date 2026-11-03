import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { actsApi, type ActRecord } from '@/api/acts'
import { AppButton } from '@/components/ui'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/primitives/dialog'
import { getErrorMessage } from '@/lib/errorMessage'

export const MAIL_STATUS: Record<string, string> = { sending: 'Отправка выполняется', sent: 'Принято почтовым сервером', confirmed_sent: 'Отправка подтверждена сотрудником', failed: 'Не отправлено', unknown: 'Результат неизвестен — проверьте почту' }
const input = 'mt-1 block w-full rounded-lg border border-p-line bg-p-panel px-3 py-2.5 text-sm'
export function ActMailDialog({ act, recipients, onClose, onSent }: { act: ActRecord; recipients: string[]; onClose: () => void; onSent: () => void }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const contractEmail = act.snapshot.customer_email?.trim() || ''
  const [recipient, setRecipient] = useState(contractEmail || recipients[0] || '')
  const [subject, setSubject] = useState(`Акт оказанных услуг — ${act.student_name}`)
  const [body, setBody] = useState(`Здравствуйте!\n\nХочу искренне поблагодарить вас за доверие и за то, что вы прошли этот путь вместе с нами\nДля нас это было не просто сотрудничество, а важная часть нашей миссии — помогать вам двигаться к вашим целям и мечтам.\n\nВо вложении направляю акты выполненных работ.\n\nТакже нам очень важно ваше мнение — оно помогает нам становиться лучше для вас и других студентов\nБуду признательна, если вы заполните короткие формы:\n\nОбратная связь:\nhttps://forms.gle/KadF6tTVjJr76qke7\n\nРеферальная программа (получайте бонусы за рекомендации):\nhttps://forms.gle/DaMPrhCkkcBFcszC9\n\nИ в качестве благодарности подготовили для вас подарок\n— курс по стажировкам\n— гайды по написанию мотивационных и рекомендательных писем\n— и все необходимые материалы для поступления\n\nДоступ здесь:\nhttps://drive.google.com/drive/folders/1Sq_JclXeuCqebMqkXKYmvQsYgb6bIVhk?usp=sharing\n\nЖелаю вам больших успехов, уверенности в своих шагах и реализации всех ваших планов\nПусть впереди будет еще больше возможностей, сильных решений и счастливых результатов!\n\nС теплом и благодарностью,\nКоманда TeenTechEd`)
  const send = useMutation({ mutationFn: () => actsApi.send(act.id, { request_id: requestId, recipient, subject, body }), onSuccess: onSent, retry: false })
  const [mobilePreview, setMobilePreview] = useState(false)
  // То же PDF, что уйдёт вложением: сохранённый файл акта.
  const attachment = useQuery({ queryKey: ['act-mail-preview', act.id], queryFn: () => actsApi.pdf(act.id), staleTime: Infinity, retry: false })
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!attachment.data) return
    const url = URL.createObjectURL(attachment.data); setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment.data])
  return <Dialog open onOpenChange={open => { if (!open && !send.isPending) onClose() }}><DialogContent className="flex h-[94dvh] max-h-[94dvh] !w-[calc(100vw-1rem)] !max-w-[1240px] flex-col gap-0 overflow-hidden !p-0 sm:!w-[calc(100vw-3rem)]">
    <div className="shrink-0 border-b border-p-line px-4 py-4 pr-12 sm:px-6"><DialogHeader><DialogTitle>Отправить акт</DialogTitle><DialogDescription className="break-words">Вложение: {act.file_name}</DialogDescription></DialogHeader></div>
    <div className="flex shrink-0 border-b border-p-line lg:hidden"><button type="button" className={`flex-1 p-3 text-sm ${mobilePreview ? '' : 'font-semibold'}`} onClick={() => setMobilePreview(false)}>Письмо</button><button type="button" className={`flex-1 p-3 text-sm ${mobilePreview ? 'font-semibold' : ''}`} onClick={() => setMobilePreview(true)}>Предпросмотр</button></div>
    <div className="grid min-h-0 flex-1 lg:grid-cols-2">
    <form className={`${mobilePreview ? 'hidden lg:block' : ''} min-h-0 space-y-4 overflow-y-auto p-4 sm:p-6`} onSubmit={e => { e.preventDefault(); if (!send.isPending && !send.data) send.mutate() }}>
      <fieldset disabled={send.isPending || !!send.data} className="space-y-4">
        <label className="block text-sm">Получатель{contractEmail && <span className="ml-2 text-xs text-p-muted">Из договора: {contractEmail}</span>}<input className={input} type="email" required value={recipient} list="act-recipients" onChange={e => setRecipient(e.target.value)} /><datalist id="act-recipients">{recipients.map(email => <option key={email}>{email}</option>)}</datalist></label>
        <label className="block text-sm">Тема<input className={input} required maxLength={300} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="block text-sm">Текст письма<textarea className={input} required maxLength={10000} rows={15} value={body} onChange={e => setBody(e.target.value)} /></label>
        <div className="flex justify-end"><AppButton colorPrefix="p" variant="subtle" type="submit">{send.isPending ? 'Отправляем…' : 'Отправить с PDF'}</AppButton></div>
      </fieldset>
      {send.error && <p role="alert" className="text-sm text-red-700">{getErrorMessage(send.error, 'Не удалось отправить письмо')}</p>}
      {send.data && <p role="status" className="text-sm">{MAIL_STATUS[send.data.status] || send.data.status}</p>}
    </form>
    <aside className={`${mobilePreview ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col border-p-line bg-p-bg p-3 lg:border-l`}><p className="mb-2 text-xs text-p-muted">Предпросмотр вложения · {act.file_name}</p>
      {previewUrl ? <iframe title="Предпросмотр акта PDF" src={previewUrl} className="min-h-0 w-full flex-1 border-0 bg-white" />
        : <div className="flex flex-1 items-center justify-center p-5 text-sm">{attachment.error ? <p role="alert" className="text-red-700">{getErrorMessage(attachment.error, 'Не удалось открыть PDF акта')} <button type="button" className="underline" onClick={() => attachment.refetch()}>Повторить</button></p> : <p className="text-p-muted">Готовим предпросмотр…</p>}</div>}
    </aside></div>
  </DialogContent></Dialog>
}
