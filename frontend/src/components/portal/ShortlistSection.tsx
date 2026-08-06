import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Star, Trash2 } from 'lucide-react'
import { shortlistApi, ShortlistItem } from '@/api/studentUniversities'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'
import { UniversityPicker } from './UniversityPicker'

/** Shortlist of universities shared by a student and their mentor.
 *
 * `mode` picks the data source, not the styling: 'staff' reads a given
 * student's list, 'self' reads the logged-in student's own. Both write through
 * the same endpoint, which resolves the student server-side.
 */
export const ShortlistSection: React.FC<{
  mode: 'staff' | 'self'
  studentId?: string
  basePath?: string
}> = ({ mode, studentId, basePath = '/portal/universities' }) => {
  const queryClient = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)

  const queryKey = mode === 'self' ? ['shortlist', 'mine'] : ['shortlist', studentId]
  const { data: items = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => (mode === 'self' ? shortlistApi.listMine() : shortlistApi.listForStudent(studentId!)),
    enabled: mode === 'self' || Boolean(studentId),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const addMutation = useMutation({
    mutationFn: (universityId: string) =>
      shortlistApi.add({
        university_id: universityId,
        ...(mode === 'staff' ? { student_id: studentId } : {}),
      }),
    onSuccess: () => {
      invalidate()
      setPickerOpen(false)
      toast({ title: 'Добавлено в избранное' })
    },
    onError: (err) =>
      toast({ title: 'Не удалось добавить', description: getErrorMessage(err), variant: 'destructive' }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => shortlistApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Удалено из избранного' })
    },
    onError: () => toast({ title: 'Не удалось удалить', variant: 'destructive' }),
  })

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-p-muted">
          {isLoading ? 'Загрузка…' : `Вузов в списке: ${items.length}`}
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex h-9 flex-none items-center gap-1.5 rounded-ctl bg-brand px-3 text-xs font-bold text-black"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить вуз
        </button>
      </div>

      {items.length === 0 && !isLoading ? (
        <div className="rounded-card border border-dashed border-p-line p-5 text-center">
          <Star className="mx-auto h-5 w-5 text-p-muted2" />
          <p className="mt-2 text-sm text-p-muted">
            Пока пусто. Добавьте вузы, которые рассматриваете.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {items.map((item) => (
            <ShortlistCard
              key={item.id}
              item={item}
              basePath={basePath}
              onRemove={() => removeMutation.mutate(item.id)}
            />
          ))}
        </ul>
      )}

      <UniversityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        excludeIds={items.map((i) => i.university_id)}
        onPick={(id) => addMutation.mutate(id)}
        isPending={addMutation.isPending}
      />
    </div>
  )
}

const ShortlistCard: React.FC<{
  item: ShortlistItem
  basePath: string
  onRemove: () => void
}> = ({ item, basePath, onRemove }) => {
  const u = item.university
  const byStudent = item.added_by_role === 'student'
  return (
    <li className="flex items-start gap-3 rounded-card border border-p-line bg-p-panel p-3">
      {u.photo_url ? (
        <img src={u.photo_url} alt="" className="h-11 w-11 flex-none rounded-ctl object-cover" loading="lazy" />
      ) : (
        <span className="grid h-11 w-11 flex-none place-items-center rounded-ctl bg-p-panel2 text-base">
          {u.country_flag_emoji || '🎓'}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <Link to={`${basePath}/${u.id}`} className="block truncate text-sm font-bold text-p-text hover:underline">
          {u.name}
        </Link>
        <p className="mt-0.5 truncate text-xs text-p-muted">
          {[u.country_name, u.city].filter(Boolean).join(' · ')}
          {u.world_ranking != null ? ` · #${u.world_ranking}` : ''}
        </p>
        <span className="mt-1.5 inline-block rounded-full bg-p-panel2 px-2 py-0.5 text-[10px] font-bold text-p-muted2">
          {byStudent ? 'Выбор студента' : `Предложил ${item.added_by_name || 'ментор'}`}
        </span>
        {item.note && <p className="mt-1 text-xs text-p-muted">{item.note}</p>}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Убрать ${u.name} из избранного`}
        className="grid h-8 w-8 flex-none place-items-center rounded-ctl text-p-muted2 transition-colors hover:text-p-danger"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
}
