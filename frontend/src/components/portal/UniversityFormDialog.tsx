import React, { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/hooks/use-toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog'
import {
  universitiesApi,
  University,
  UniversityInput,
  DegreeLevel,
  GrantsStatus,
} from '@/api/universities'

const DEGREES: { value: DegreeLevel; label: string }[] = [
  { value: 'undergraduate', label: 'Бакалавриат' },
  { value: 'masters', label: 'Магистратура' },
  { value: 'doctorate', label: 'Докторантура' },
]

const GRANT_OPTIONS: { value: GrantsStatus; label: string }[] = [
  { value: 'unknown', label: 'Нет данных' },
  { value: 'yes', label: 'Есть полный грант' },
  { value: 'no', label: 'Полного гранта нет' },
]

const EMPTY: UniversityInput = {
  name: '',
  country_name: '',
  city: '',
  description: '',
  website: '',
  world_ranking: null,
  tuition_range: '',
  has_grants: false,
  has_grants_status: 'unknown',
  grant_note: '',
  photo_url: '',
  degree_levels: [],
}

const field =
  'h-10 w-full rounded-ctl border border-p-line bg-p-panel2 px-3 text-sm text-p-text outline-none transition-colors placeholder:text-p-muted2 focus:border-brand-dim'

/** Create/edit a catalog university.
 *
 * Deliberately omits faculties/requirements/deadline_note/description_full:
 * those are written by the Tilda import, which is re-runnable, so hand edits
 * there would be silently overwritten on the next sync.
 */
export const UniversityFormDialog: React.FC<{
  open: boolean
  onOpenChange: (open: boolean) => void
  university?: University | null
  onSaved?: (u: University) => void
}> = ({ open, onOpenChange, university = null, onSaved }) => {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<UniversityInput>(EMPTY)
  const isEdit = Boolean(university)

  useEffect(() => {
    if (!open) return
    setForm(
      university
        ? {
            name: university.name,
            country_name: university.country_name ?? '',
            city: university.city,
            description: university.description,
            website: university.website,
            world_ranking: university.world_ranking,
            tuition_range: university.tuition_range,
            has_grants: university.has_grants,
            has_grants_status: university.has_grants_status ?? 'unknown',
            grant_note: '',
            photo_url: university.photo_url ?? '',
            degree_levels: university.degree_levels ?? [],
          }
        : EMPTY
    )
  }, [open, university])

  const set = (patch: Partial<UniversityInput>) => setForm((f) => ({ ...f, ...patch }))

  const toggleDegree = (d: DegreeLevel) => {
    const current = form.degree_levels ?? []
    set({ degree_levels: current.includes(d) ? current.filter((x) => x !== d) : [...current, d] })
  }

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, name: form.name.trim() }
      return isEdit
        ? universitiesApi.update(university!.id, payload)
        : universitiesApi.create(payload)
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['universities'] })
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['university', university!.id] })
      toast({ title: isEdit ? 'Изменения сохранены' : 'Университет добавлен' })
      onSaved?.(saved)
      onOpenChange(false)
    },
    onError: () => toast({ title: 'Не удалось сохранить', variant: 'destructive' }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Редактировать университет' : 'Добавить университет'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Название</span>
            <input className={field} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Страна</span>
            <input className={field} value={form.country_name ?? ''} onChange={(e) => set({ country_name: e.target.value })} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Город</span>
            <input className={field} value={form.city} onChange={(e) => set({ city: e.target.value })} />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Рейтинг в мире</span>
            <input
              className={field}
              type="number"
              value={form.world_ranking ?? ''}
              onChange={(e) => set({ world_ranking: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Стоимость</span>
            <input className={field} placeholder="$8 000/год" value={form.tuition_range} onChange={(e) => set({ tuition_range: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Сайт</span>
            <input className={field} value={form.website} onChange={(e) => set({ website: e.target.value })} />
          </label>
          <label className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Фото (URL)</span>
            <input className={field} value={form.photo_url ?? ''} onChange={(e) => set({ photo_url: e.target.value })} />
          </label>
          {form.photo_url ? (
            <div className="sm:col-span-2 h-28 overflow-hidden rounded-ctl border border-p-line">
              <img src={form.photo_url} alt="" className="h-full w-full object-cover" />
            </div>
          ) : null}

          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-p-muted2">Степени</legend>
            <div className="flex flex-wrap gap-4">
              {DEGREES.map((d) => (
                <label key={d.value} className="flex cursor-pointer items-center gap-2 text-sm text-p-text">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={(form.degree_levels ?? []).includes(d.value)}
                    onChange={() => toggleDegree(d.value)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Гранты</span>
            <select
              className={field}
              value={form.has_grants_status ?? 'unknown'}
              onChange={(e) => {
                const v = e.target.value as GrantsStatus
                // Keep the legacy boolean in sync for consumers still reading it.
                set({ has_grants_status: v, has_grants: v === 'yes' })
              }}
            >
              {GRANT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Финансовая помощь</span>
            <input className={field} placeholder="До $20 000" value={form.grant_note ?? ''} onChange={(e) => set({ grant_note: e.target.value })} />
          </label>

          <label className="sm:col-span-2">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-p-muted2">Краткое описание</span>
            <textarea
              className={`${field} h-20 py-2`}
              value={form.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </label>
        </div>

        <p className="mt-1 text-[11px] text-p-muted2">
          Факультеты, требования и дедлайны заполняются импортом с сайта и здесь не редактируются —
          ручные правки затёрло бы при следующей синхронизации.
        </p>

        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-ctl border border-p-line px-4 text-sm font-bold text-p-muted transition-colors hover:text-p-text"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!form.name.trim() || save.isPending}
            onClick={() => save.mutate()}
            className="h-10 rounded-ctl bg-brand px-4 text-sm font-bold text-black transition-opacity disabled:opacity-50"
          >
            {save.isPending ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
