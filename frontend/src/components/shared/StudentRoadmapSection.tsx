import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Route } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/primitives/accordion'
import { Button } from '@/components/ui/primitives/button'
import { Badge } from '@/components/ui/primitives/badge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { RoadmapTimeline } from '@/components/shared/RoadmapTimeline'
import { SegmentedTabs } from '@/components/ui'
import { ResponsibilityBadge } from '@/components/shared/ResponsibilityBadge'
import { QueryError } from '@/components/shared/QueryState'

export const StudentRoadmapSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { toast } = useToast()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const canManageTemplates = can('roadmap_templates', 'manage')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['student-roadmap', studentId],
    queryFn: () => roadmapApi.studentRoadmaps(studentId),
  })
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAssignForm, setShowAssignForm] = useState(false)
  useEffect(() => {
    if (data !== undefined) {
      setRoadmaps(data)
      setSelectedId((current) => (current && data.some((r) => r.id === current)) ? current : data[0]?.id ?? null)
    }
  }, [data])
  const selected = roadmaps.find((r) => r.id === selectedId) ?? null

  const { data: templates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
    enabled: canManageTemplates && (roadmaps.length === 0 || showAssignForm),
  })
  const [templateId, setTemplateId] = useState('')

  const assignMutation = useMutation({
    mutationFn: () => roadmapApi.assign(templateId, studentId),
    onSuccess: (rm) => {
      setRoadmaps((current) => [rm, ...current])
      setSelectedId(rm.id)
      setShowAssignForm(false)
      setTemplateId('')
      queryClient.invalidateQueries({ queryKey: ['student-roadmap', studentId] })
      toast({ title: 'Roadmap назначен', description: 'Студент увидит его в кабинете.' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось назначить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (roadmapId: string) => roadmapApi.archiveRoadmap(roadmapId),
    onSuccess: (_rm, roadmapId) => {
      setRoadmaps((current) => {
        const next = current.filter((r) => r.id !== roadmapId)
        setSelectedId(next[0]?.id ?? null)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['student-roadmap', studentId] })
      toast({ title: 'Roadmap архивирован' })
    },
    onError: () => {
      toast({ title: 'Не удалось архивировать', variant: 'destructive' })
    },
  })

  const assignForm = (
    <div className="space-y-3 py-1">
      <p className="text-sm text-gray-500">
        Назначьте студенту дорожную карту по шаблону — этапы и задачи развернутся автоматически.
      </p>
      {templates.length === 0 ? (
        <p className="text-sm text-gray-400">
          Шаблонов пока нет. Создайте их в разделе «Roadmap-шаблоны».
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="h-9 px-3 text-sm border border-gray-300 rounded-ctl bg-white min-w-[240px]"
          >
            <option value="">Выберите шаблон…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {[t.country_name, t.degree, t.year].filter(Boolean).join(' ')} ({t.stage_count} эт.)
              </option>
            ))}
          </select>
          <Button
            size="sm"
            className="h-9 px-4 text-xs"
            disabled={!templateId || assignMutation.isPending}
            onClick={() => assignMutation.mutate()}
          >
            Назначить
          </Button>
          {roadmaps.length > 0 && (
            <Button size="sm" variant="ghost" className="h-9 px-3 text-xs" onClick={() => setShowAssignForm(false)}>
              Отмена
            </Button>
          )}
        </div>
      )}
    </div>
  )

  return (
    <AccordionItem value="roadmap" className="border border-gray-200 rounded-card px-4">
      <AccordionTrigger className="text-base font-semibold">
        <span className="flex flex-wrap items-center gap-2">
          <Route className="w-4 h-4 text-gray-500" />
          Roadmap поступления
          <ResponsibilityBadge studentId={studentId} area="roadmap" />
          {roadmaps.length > 0 ? (
            <Badge variant="outline" className="ml-1 text-2xs font-medium">
              {roadmaps.length > 1 ? `${roadmaps.length} активных` : `${roadmaps[0].stages.length} этапов`}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 text-2xs font-medium text-gray-500">
              не назначен
            </Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {isError ? (
          <QueryError error={error} onRetry={refetch} />
        ) : isLoading ? (
          <p className="text-sm text-gray-500 py-2">Загрузка…</p>
        ) : roadmaps.length > 0 ? (
          <div className="py-1 space-y-3">
            {roadmaps.length > 1 && (
              <SegmentedTabs
                colorPrefix="ds"
                value={selectedId ?? ''}
                onChange={setSelectedId}
                tabs={roadmaps.map((r) => ({ value: r.id, label: r.name }))}
              />
            )}
            {canManageTemplates && (
              <div className="flex items-center justify-end gap-2">
                {selected && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs text-gray-500"
                    disabled={archiveMutation.isPending}
                    onClick={() => selected && archiveMutation.mutate(selected.id)}
                  >
                    Архивировать этот roadmap
                  </Button>
                )}
                {!showAssignForm && (
                  <Button size="sm" variant="outline" className="h-8 px-3 text-xs" onClick={() => setShowAssignForm(true)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Ещё один roadmap
                  </Button>
                )}
              </div>
            )}
            {showAssignForm && assignForm}
            {selected && <RoadmapTimeline roadmap={selected} canManage onChanged={(rm) => setRoadmaps((current) => current.map((r) => r.id === rm.id ? rm : r))} />}
          </div>
        ) : canManageTemplates ? (
          assignForm
        ) : (
          <p className="text-sm text-gray-500 py-2">
            Roadmap ещё не назначен. Назначить шаблон может администратор или МЗК.
          </p>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
