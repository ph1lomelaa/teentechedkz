import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Award, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { universitiesApi, UniversityInput } from '@/api/universities'
import { CrmPageHeader } from '@/components/shared/CrmPageHeader'

const empty: UniversityInput = {
  name: '',
  country_name: '',
  city: '',
  description: '',
  website: '',
  world_ranking: null,
  tuition_range: '',
  has_grants: false,
}

export const UniversitiesPage: React.FC = () => {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: unis = [], isLoading } = useQuery({ queryKey: ['universities'], queryFn: universitiesApi.list })
  const [form, setForm] = useState<UniversityInput>(empty)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['universities'] })

  const createMutation = useMutation({
    mutationFn: () => universitiesApi.create({ ...form, name: form.name.trim() }),
    onSuccess: () => {
      setForm(empty)
      invalidate()
      toast({ title: 'Университет добавлен' })
    },
    onError: () => toast({ title: 'Не удалось добавить', variant: 'destructive' }),
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => universitiesApi.remove(id),
    onSuccess: () => {
      invalidate()
      toast({ title: 'Удалено' })
    },
  })

  const set = (patch: Partial<UniversityInput>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="mx-auto w-full">
      <CrmPageHeader
        eyebrow="Справочник"
        title="Университеты"
        description="Общая база университетов, рейтингов, стоимости обучения и грантов."
      />

      <div className="mb-6 rounded-[2px] border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-p-text mb-3">Добавить университет</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <Input placeholder="Название" value={form.name} onChange={(e) => set({ name: e.target.value })} />
          <Input placeholder="Страна" value={form.country_name ?? ''} onChange={(e) => set({ country_name: e.target.value })} />
          <Input placeholder="Город" value={form.city} onChange={(e) => set({ city: e.target.value })} />
          <Input
            type="number"
            placeholder="Мировой рейтинг"
            value={form.world_ranking ?? ''}
            onChange={(e) => set({ world_ranking: e.target.value ? Number(e.target.value) : null })}
          />
          <Input placeholder="Стоимость (напр. $8–12k/год)" value={form.tuition_range} onChange={(e) => set({ tuition_range: e.target.value })} />
          <Input placeholder="Сайт" value={form.website} onChange={(e) => set({ website: e.target.value })} />
        </div>
        <div className="flex items-center gap-4 mt-3">
          <label className="flex items-center gap-2 text-sm text-p-text">
            <input type="checkbox" checked={form.has_grants} onChange={(e) => set({ has_grants: e.target.checked })} />
            Есть гранты
          </label>
          <Button
            size="sm"
            className="h-9 px-4 text-xs ml-auto"
            disabled={!form.name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            <Plus className="w-3.5 h-3.5 mr-2" /> Добавить
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-p-muted">Загрузка…</p>
      ) : unis.length === 0 ? (
        <p className="text-sm text-p-muted2">Университетов пока нет.</p>
      ) : (
        <div className="divide-y divide-border rounded-[2px] border border-border bg-card">
          {unis.map((u) => (
            <div key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-p-text flex items-center gap-2">
                  {u.name}
                  {u.world_ranking != null && (
                    <span className="text-[10px] font-bold tabular-nums bg-p-panel text-p-muted px-1.5 py-0.5 rounded">#{u.world_ranking}</span>
                  )}
                  {u.has_grants && <Award className="w-3.5 h-3.5 text-[#9a7d00]" />}
                </div>
                <div className="text-xs text-p-muted mt-0.5">
                  {[u.country_name, u.city, u.tuition_range].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {u.website && (
                  <Button asChild variant="outline" size="sm" className="h-8 px-3 text-xs">
                    <a href={u.website} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Сайт
                    </a>
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => window.confirm('Удалить университет?') && deleteMutation.mutate(u.id)}
                  className="h-8 w-8 p-0"
                  aria-label={`Удалить университет ${u.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
