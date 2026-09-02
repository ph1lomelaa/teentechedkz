import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Shield } from 'lucide-react'
import { confidentialNotesApi } from '@/api'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from '@/hooks/use-toast'
import { AppButton } from '@/components/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { formatDate } from '@/lib/utils'
import type { ConfidentialNote, NoteVisibility } from '@/types'
import { invalidateStudent } from '@/lib/queryKeys'

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
  const { can } = useAuth()
  // Решение 30.08.2026: уровень видимости выбирает автор заметки, включая
  // ментора. Право на сам раздел и так было у всех троих.
  const canPickVisibility = can('confidential_notes', 'manage')
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [role, setRole] = useState<NoteVisibility>('admin_and_mzk')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const invalidate = () => invalidateStudent(queryClient, studentId)

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

  const editMutation = useMutation({
    mutationFn: ({ noteId, noteText }: { noteId: string; noteText: string }) =>
      confidentialNotesApi.update(noteId, { note_text: noteText }),
    onSuccess: () => {
      invalidate()
      setEditingId(null)
    },
    onError: () => toast({ title: 'Не удалось сохранить заметку', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => confidentialNotesApi.delete(noteId),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Заметка удалена' })
    },
    onError: () => toast({ title: 'Не удалось удалить заметку', variant: 'destructive' }),
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
            <div key={note.id} className="rounded-panel border border-w-line bg-w-panel2 p-3.5">
              {editingId === note.id ? (
                <div className="space-y-2.5">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={3}
                    className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2.5 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
                  />
                  <div className="flex items-center gap-2">
                    <AppButton
                      colorPrefix="w"
                      size="sm"
                      disabled={!editingText.trim() || editMutation.isPending}
                      onClick={() => editMutation.mutate({ noteId: note.id, noteText: editingText })}
                    >
                      Сохранить
                    </AppButton>
                    <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Отмена
                    </AppButton>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-w-ink">{note.note_text}</p>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-w-muted">
                      Видят: {VISIBILITY_LABEL[note.visible_to_role]} · {formatDate(note.created_at)}
                    </p>
                    <div className="relative">
                      <AppButton
                        colorPrefix="w"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        aria-label="Действия с заметкой"
                        onClick={() => setMenuOpenId(menuOpenId === note.id ? null : note.id)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </AppButton>
                      {menuOpenId === note.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 flex min-w-[180px] flex-col overflow-hidden rounded-ctl border border-w-line bg-w-panel shadow-lg">
                          <button
                            type="button"
                            disabled={visibilityMutation.isPending}
                            className="px-3 py-2 text-left text-xs text-w-ink hover:bg-w-panel2 disabled:opacity-50"
                            onClick={() => { setMenuOpenId(null); visibilityMutation.mutate({ noteId: note.id, visible: !note.visible_to_student }) }}
                          >
                            {note.visible_to_student ? 'Скрыть от ученика' : 'Показать ученику'}
                          </button>
                          <button
                            type="button"
                            className="px-3 py-2 text-left text-xs text-w-ink hover:bg-w-panel2"
                            onClick={() => { setMenuOpenId(null); setEditingId(note.id); setEditingText(note.note_text || '') }}
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            className="px-3 py-2 text-left text-xs text-w-danger hover:bg-w-panel2"
                            onClick={() => { setMenuOpenId(null); if (confirm('Удалить заметку?')) deleteMutation.mutate(note.id) }}
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  {note.visible_to_student && (
                    <p className="mt-1.5 text-[11px] font-bold text-w-good">Видно ученику в разделе «Заметки»</p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!adding && notes.length === 0 && (
        <div className="rounded-panel border border-dashed border-w-line bg-w-panel2 px-4 py-5 text-sm text-w-muted">
          У этого ученика пока нет заметок. Добавьте первую заметку, чтобы сохранить важную информацию для команды.
        </div>
      )}

      {!adding ? (
        <AppButton colorPrefix="w" size="sm" variant="subtle" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> {notes.length === 0 ? 'Добавить первую заметку' : 'Добавить заметку'}
        </AppButton>
      ) : (
        <div className="space-y-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Заметка..."
            rows={3}
            className="w-full rounded-ctl border border-w-line bg-w-panel2 px-3 py-2.5 text-sm text-w-ink outline-none placeholder:text-w-muted2 focus:border-w-accentDim"
          />
          <div className="flex flex-wrap items-center gap-2">
            {canPickVisibility && (
              // Radix Select вместо нативного <select>: на macOS/Safari
              // системный список игнорирует тему страницы и рисуется в
              // светлой теме ОС независимо от темы приложения.
              <Select value={role} onValueChange={(v) => setRole(v as NoteVisibility)}>
                <SelectTrigger className="h-10 w-44 border-w-line bg-w-panel2 text-sm font-bold text-w-ink focus:border-w-accentDim">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-w-line bg-w-panel text-w-ink">
                  <SelectItem value="admin_only">Только admin</SelectItem>
                  <SelectItem value="admin_and_mzk">Admin и MZK</SelectItem>
                  <SelectItem value="all_mentors">Все менторы</SelectItem>
                </SelectContent>
              </Select>
            )}
            <AppButton colorPrefix="w" size="sm" disabled={!text.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
              Сохранить
            </AppButton>
            <AppButton colorPrefix="w" size="sm" variant="ghost" onClick={() => { setAdding(false); setText('') }}>
              Отмена
            </AppButton>
          </div>
        </div>
      )}
    </div>
  )
}
