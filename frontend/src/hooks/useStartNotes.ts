import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { notesApi } from '@/api/notes'
import { toast } from '@/hooks/use-toast'
import { normalizeMeetingLink } from '@/lib/meetingLink'

export interface NotesTarget {
  studentId: string
  studentName?: string
  meeting?: { id: string; title: string; meeting_link?: string; note_session_id?: string | null }
}

/** Одна кнопка «начать конспект» для карточки студента и списка встреч:
 *  открывает уже начатую сессию встречи или заводит новую и сразу ведёт на
 *  экран записи, подставив ссылку встречи в «Отправить бота». */
export function useStartNotes() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ studentId, studentName, meeting }: NotesTarget) => {
      const url = normalizeMeetingLink(meeting?.meeting_link) || ''
      if (meeting?.note_session_id) return { id: meeting.note_session_id, url }
      const session = await notesApi.createSession(meeting
        ? { student_id: studentId, meeting_id: meeting.id, title: `Конспект: ${meeting.title}`, source: 'meeting' }
        : { student_id: studentId, title: studentName ? `Конспект ${studentName}` : 'Новая сессия конспекта', source: 'workspace' })
      return { id: session.id, url }
    },
    onSuccess: ({ id, url }) => {
      queryClient.invalidateQueries({ queryKey: ['workspace', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['workspace', 'meetings'] })
      navigate(`/workspace/meetings/session/${id}${url ? `?url=${encodeURIComponent(url)}` : ''}`)
    },
    onError: () => toast({ title: 'Не удалось начать конспект', variant: 'destructive' }),
  })
}
