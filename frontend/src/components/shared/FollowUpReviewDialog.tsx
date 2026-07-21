import { useEffect, useState } from 'react'
import { Send, Copy } from 'lucide-react'
import { MeetingFollowUpDraft } from '@/api/meetings'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function FollowUpReviewDialog({
  draft,
  open,
  isSending,
  onOpenChange,
  onCopy,
  onSend,
}: {
  draft: MeetingFollowUpDraft | null
  open: boolean
  isSending?: boolean
  onOpenChange: (open: boolean) => void
  onCopy: (text: string) => void
  onSend: (text: string) => void
}) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (draft?.message) setMessage(draft.message)
  }, [draft?.message])

  const clean = message.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Проверить follow-up</DialogTitle>
          <DialogDescription>
            Сообщение не отправляется автоматически. Отредактируйте текст и выберите действие.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-[12px] border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            {draft?.student_name ? `Студент: ${draft.student_name}` : 'Студент не указан'}
          </div>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={10}
            className="text-sm"
            placeholder="Текст follow-up сообщения"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onCopy(clean)} disabled={!clean || isSending}>
            <Copy className="mr-2 h-4 w-4" />
            Скопировать
          </Button>
          <Button onClick={() => onSend(clean)} disabled={!clean || isSending}>
            <Send className="mr-2 h-4 w-4" />
            {isSending ? 'Отправка…' : 'Отправить в чат'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
