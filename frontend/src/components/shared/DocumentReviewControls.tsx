import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, FileSignature, RotateCcw, Trash2 } from 'lucide-react'
import { documentsApi } from '@/api/documents'
import { type Document } from '@/types'
import { invalidateDocuments } from '@/lib/queryKeys'
import { getErrorMessage } from '@/lib/errorMessage'
import { formatDate } from '@/lib/utils'
import { toast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/primitives/dialog'
import { Button } from '@/components/ui/primitives/button'

export function DocumentWorkflowHelp() {
  return <details className="mb-3 rounded-xl border border-p-line bg-p-panel2 px-3 py-2 text-xs text-p-muted">
    <summary className="cursor-pointer font-semibold text-p-text">Проверка, видимость и подтверждение — что это?</summary>
    <div className="mt-2 space-y-2 leading-relaxed">
      <p><strong>Проверен</strong> — сотрудник проверил содержимое и нажал «Отметить проверенным». Документ перестаёт учитываться в «Нужна проверка».</p>
      <p><strong>Скрыть от студента</strong> — файл остаётся у команды, студент его не видит. Это не отметка проверки. Если ожидается подтверждение, скрытие отменит запрос.</p>
      <p><strong>Удалить</strong> — убрать файл у команды и студента. Для сохранения внутреннего файла используйте «Скрыть от студента».</p>
      <p><strong>Запросить подтверждение</strong> — открыть важный документ студенту и попросить подтвердить ознакомление. Студент просматривает файл, подтверждает ознакомление и указывает ФИО. Сохраняются ФИО и дата подтверждения.</p>
      <p>Простой просмотр файла и показ студенту не означают, что документ проверен сотрудником или подтверждён студентом.</p>
    </div>
  </details>
}

export function DocumentReviewControls({ doc, onChanged, allowDelete = false }: { doc: Document; onChanged: () => void; allowDelete?: boolean }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<'request' | 'revoke' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (operation: () => Promise<unknown>, title: string) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await operation()
      invalidateDocuments(qc, doc.student_id)
      onChanged()
      setDialog(null)
      toast({ title })
    } catch (failure) { setError(getErrorMessage(failure)) }
    finally { setBusy(false) }
  }
  const show = (next: typeof dialog) => { setError(''); setDialog(next) }
  const pending = doc.signature_status === 'pending'
  const signed = doc.signature_status === 'signed'
  return <div className="mt-2 space-y-2 text-xs text-p-text">
    <div className="flex flex-wrap items-center gap-2" aria-label={`Статусы: ${doc.file_name}`}>
      <span className={`rounded-full px-2 py-1 font-medium ${doc.is_verified ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-700'}`}>{doc.is_verified ? 'Проверен' : 'Нужна проверка'}</span>
      <span className="rounded-full bg-p-panel2 px-2 py-1 text-p-muted">{doc.visible_to_student ? 'Видит студент' : 'Скрыт от студента'}</span>
      {pending && <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-700">{doc.signature_viewed_at ? 'Ознакомление отмечено · ждём подтверждение' : 'Ожидаем подтверждение студента'}</span>}
      {signed && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-600">Подтверждено студентом{doc.signature_full_name ? ` · ${doc.signature_full_name}` : ''}{doc.signature_signed_at ? ` · ${formatDate(doc.signature_signed_at)}` : ''}</span>}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => run(() => documentsApi.verify(doc.id, !doc.is_verified), doc.is_verified ? 'Документ возвращён на проверку' : 'Документ проверен')}>
        {doc.is_verified ? <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}{doc.is_verified ? 'Вернуть на проверку' : 'Отметить проверенным'}
      </Button>
      {!signed && <Button variant="outline" size="sm" disabled={busy} onClick={() => show(pending ? 'revoke' : 'request')}><FileSignature className="mr-1.5 h-3.5 w-3.5" />{pending ? 'Отозвать запрос' : 'Запросить подтверждение'}</Button>}
      {allowDelete && <Button variant="ghost" size="sm" disabled={busy} onClick={() => show('delete')}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Удалить</Button>}
    </div>
    {error && !dialog && <p role="alert" className="text-red-600">{error}</p>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open && !busy) setDialog(null) }}>
      <DialogContent className="student-detail-dialog">
        <DialogHeader>
          <DialogTitle>{dialog === 'delete' ? 'Удалить документ?' : dialog === 'revoke' ? 'Отозвать запрос подтверждения?' : 'Запросить подтверждение ознакомления?'}</DialogTitle>
          <DialogDescription>{doc.file_name}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-p-text">{dialog === 'delete' ? 'Файл будет удалён у команды и студента. Если нужно только убрать его из кабинета студента, используйте «Скрыть от студента».' : dialog === 'revoke' ? 'Студенту больше не нужно подтверждать этот запрос. Видимость и отметка проверки документа сохранятся.' : 'Документ станет виден студенту. Ему нужно будет просмотреть файл, подтвердить ознакомление и указать ФИО. Это отдельное действие от проверки документа сотрудником.'}</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Отмена</Button>
          <Button disabled={busy} onClick={() => {
            if (dialog === 'delete') void run(() => documentsApi.delete(doc.id), 'Документ удалён')
            else if (dialog === 'revoke') void run(() => documentsApi.revokeSignature(doc.id), 'Запрос подтверждения отозван')
            else void run(() => documentsApi.requestSignature(doc.id), 'Подтверждение запрошено у студента')
          }}>{busy ? 'Сохраняем…' : dialog === 'delete' ? 'Удалить документ' : dialog === 'revoke' ? 'Отозвать запрос' : 'Отправить запрос'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
