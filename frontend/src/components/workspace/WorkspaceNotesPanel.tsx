import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Shield } from 'lucide-react'
import { confidentialNotesApi } from '@/api'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { WorkspaceButton, WorkspaceSelect } from '@/components/workspace/ui'
import { formatDate } from '@/lib/utils'
import type { ConfidentialNote, NoteVisibility } from '@/types'

type Props = {
  studentId: string
  studentName?: string
  notes: ConfidentialNote[]
}

const VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  admin_only: 'Только admin',
  admin_and_mzk: 'Admin и MZK',
  all_mentors: 'Все менторы',
}

/**
 * Dark, workspace-themed twin of the CRM confidential-notes accordion
 * (StudentCardPage) — lets a mentor create notes and toggle whether a note
 * is shown to the student, straight from the workspace, no jump to CRM.
 */
export function WorkspaceNotesPanel({ studentId, studentName, notes }: Props) {
  const queryClient = useQueryClient()
  const { hasRole } = useAuth()
  const canPickVisibility = hasRole('admin', 'mzk_manager')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [role, setRole] = useState<NoteVisibility>('admin_and_mzk')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['student', studentId] })

  const addMutation = useMutation({
    mutationFn: () =>
      confidentialNotesApi.create(studentId, {
        note_text: text,
        // a plain mentor can only ever see/toggle all_mentors-visibility notes again later,
        // so don't offer the other tiers — they'd create a note the mentor can't manage
        visible_to_role: canPickVisibility ? role : 'all_mentors',
      }),
    onSuccess: () => {
      invalidate()
      setText('')
      setAdding(false)
    },
    onError: () => toast({ title: 'Не удалось сохранить заметку', variant: 'destructive' }),
  })

  const visibilityMutation = useMutation({
    mutationFn: ({ noteId, visible }: { noteId: string; visible: boolean }) =>
      confidentialNotesApi.setStudentVisibility(noteId, visible),
    onSuccess: (_res, vars) => {
      invalidate()
      toast({ title: vars.visible ? 'Заметка видна ученику' : 'Заметка скрыта от ученика' })
    },
    onError: () => toast({ title: 'Не удалось изменить видимость', variant: 'destructive' }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 font-display text-base font-black text-w-ink">
        <Shield className="h-4 w-4 text-w-accentText" />
        Заметки{studentName ? ` о ${studentName}` : ''}
      </div>
      <p className="text-sm text-w-muted">
        Видны только персоналу — переключите «показать ученику», чтобы заметка появилась в разделе «Заметки» кабинета ученика.
      </p>

      {notes.length > 0 && (
        <div className="space-y-2.5">
          {notes.map((note) => (
            <div key={note.id} className="rounded-[13px] border border-w-line bg-w-panel2 p-3.5">
              <p className="text-sm text-w-ink">{note.note_text}</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-w-muted">
                  Видят: {VISIBILITY_LABEL[note.visible_to_role]} · {formatDate(note.created_at)}
                </p>
                <WorkspaceButton
                  size="sm"
                  variant="ghost"
                  disabled={visibilityMutation.isPending}
                  onClick={() => visibilityMutation.mutate({ noteId: note.id, visible: !note.visible_to_student })}
                >
                  {note.visible_to_student ? 'Скрыть от ученика' : 'Показать ученику'}
                </WorkspaceButton>
              </div>
              {note.visible_to_student && (
                <p className="mt-1.5 text-[11px] font-bold text-w-good">Видно ученику в разделе «Заметки»</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!adding ? (
        <WorkspaceButton size="sm" variant="soft" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Добавить заметку
        </WorkspaceButton>
      ) : (
        <div className="space-y-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Заметка..."
            rows={3}
            className="w-full rounded-[12px] border border-w-line bg-w-panel2 px-3 py-2.5 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <div className="flex flex-wrap items-center gap-2">
            {canPickVisibility && (
              <WorkspaceSelect value={role} onChange={(e) => setRole(e.target.value as NoteVisibility)} className="w-44">
                <option value="admin_only">Только admin</option>
                <option value="admin_and_mzk">Admin и MZK</option>
                <option value="all_mentors">Все менторы</option>
              </WorkspaceSelect>
            )}
            <WorkspaceButton size="sm" disabled={!text.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
              Сохранить
            </WorkspaceButton>
            <WorkspaceButton size="sm" variant="ghost" onClick={() => { setAdding(false); setText('') }}>
              Отмена
            </WorkspaceButton>
          </div>
        </div>
      )}
    </div>
  )
}
