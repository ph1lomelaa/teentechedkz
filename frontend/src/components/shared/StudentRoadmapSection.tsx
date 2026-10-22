import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Route } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  useStudentDetailMode,
} from '@/components/students/detail/StudentDetailSections'
import { Button } from '@/components/ui/primitives/button'
import { Badge } from '@/components/ui/primitives/badge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { RoadmapHeaderCard } from '@/components/portal/RoadmapHeaderCard'
import { WorkspaceRoadmapEditor } from '@/components/workspace/WorkspaceRoadmapEditor'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/primitives/select'
import { useLocation, useNavigate } from 'react-router-dom'
import { AppButton, EmptyState, SegmentedTabs } from '@/components/ui'
import { QueryError } from '@/components/shared/QueryState'

export const StudentRoadmapSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { toast } = useToast()
  const inDetail = useStudentDetailMode()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const canManageTemplates = can('roadmaps', 'edit')
  const canEdit = can('roadmaps', 'edit')
  const location = useLocation()
  const navigate = useNavigate()
  const selectedFromUrl = new URLSearchParams(location.search).get('roadmap')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['student-roadmap', studentId],
    queryFn: () => roadmapApi.studentRoadmaps(studentId),
  })
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(selectedFromUrl)
  const [showAssignForm, setShowAssignForm] = useState(false)
  useEffect(() => {
    if (data !== undefined) {
      setRoadmaps(data)
      setSelectedId((current) => (current && data.some((r) => r.id === current)) ? current : data[0]?.id ?? null)
    }
  }, [data])
  useEffect(() => { if (selectedFromUrl && roadmaps.some((r) => r.id === selectedFromUrl)) setSelectedId(selectedFromUrl) }, [selectedFromUrl, roadmaps])
  const selectRoadmap = (value: string) => {
    setSelectedId(value)
    const search = new URLSearchParams(location.search)
    search.set('roadmap', value)
    navigate({ pathname: location.pathname, search: search.toString(), hash: location.hash }, { replace: true, preventScrollReset: true })
  }
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
      <p className="text-sm text-p-muted">
        Назначьте студенту дорожную карту по шаблону — этапы и задачи развернутся автоматически.
      </p>
      {templates.length === 0 ? (
        <p className="text-sm text-p-muted2">
          Шаблонов пока нет. Создайте их в разделе «Roadmap-шаблоны».
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="h-10 w-full sm:w-80 border-p-line bg-p-panel2 text-p-text"><SelectValue placeholder="Выберите шаблон…" /></SelectTrigger>
            <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name} · {[t.country_name, t.degree, t.year].filter(Boolean).join(' ')} ({t.stage_count} эт.)
              </SelectItem>
            ))}
          </SelectContent></Select>
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
    <AccordionItem unframed value="roadmap" className="border border-p-line rounded-card px-4">
      {!inDetail && <AccordionTrigger className="text-base font-semibold">
        <span className="flex flex-wrap items-center gap-2">
          <Route className="w-4 h-4 text-p-muted" />
          Roadmap поступления
          {roadmaps.length > 0 && <Badge variant="outline">{selected?.mentor_name ? `Ведёт: ${selected.mentor_name}` : 'Roadmap назначен'}</Badge>}
          {roadmaps.length > 0 ? (
            <Badge variant="outline" className="ml-1 text-2xs font-medium">
              {roadmaps.length > 1 ? `${roadmaps.length} активных` : `${roadmaps[0].stages.length} этапов`}
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 text-2xs font-medium text-p-muted">
              не назначен
            </Badge>
          )}
        </span>
      </AccordionTrigger>}
      <AccordionContent>
        <section className="roadmap-ui rounded-card border border-w-line bg-w-panel p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-black text-w-ink"><span className="text-w-accentText"><Route className="h-4 w-4" /></span>Roadmap студента</h2>
          </div>
          {isError ? (
            <QueryError error={error} onRetry={refetch} />
          ) : isLoading ? (
            <p className="py-2 text-sm text-w-muted">Загрузка…</p>
          ) : !roadmaps.length ? (
            <div className="space-y-4">
              <EmptyState colorPrefix="w" title="Roadmap не назначен" description="Назначьте шаблон — этапы и задачи развернутся автоматически и сразу станут видны студенту в его кабинете." />
              {canManageTemplates && assignForm}
            </div>
          ) : (
            <div className="space-y-4">
              {roadmaps.length > 1 && <SegmentedTabs colorPrefix="w" value={selectedId ?? ''} onChange={selectRoadmap} tabs={roadmaps.map((r) => ({ value: r.id, label: r.name }))} />}
              {canManageTemplates && <div className="flex flex-wrap items-center justify-end gap-2">
                {selected && <AppButton colorPrefix="w" variant="ghost" size="sm" disabled={archiveMutation.isPending} onClick={() => archiveMutation.mutate(selected.id)}>Архивировать этот roadmap</AppButton>}
                {!showAssignForm && <AppButton colorPrefix="w" variant="ghost" size="sm" onClick={() => setShowAssignForm(true)}>+ Ещё один roadmap</AppButton>}
              </div>}
              {showAssignForm && assignForm}
              {selected && <>
                <RoadmapHeaderCard roadmap={selected} className="mb-5" />
                <WorkspaceRoadmapEditor studentCard key={selected.id} roadmap={selected} canManage={canEdit} onChanged={(rm) => {
                  setRoadmaps((current) => current.map((r) => r.id === rm.id ? rm : r))
                  queryClient.setQueryData<Roadmap[]>(['student-roadmap', studentId], (current) => current?.map((r) => r.id === rm.id ? rm : r))
                  queryClient.invalidateQueries({ queryKey: ['students'] })
                  queryClient.invalidateQueries({ queryKey: ['workspace'] })
                }} />
              </>}
            </div>
          )}
        </section>
      </AccordionContent>
    </AccordionItem>
  )
}
