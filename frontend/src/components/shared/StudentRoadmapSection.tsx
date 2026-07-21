import React, { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Route } from 'lucide-react'
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { RoadmapTimeline } from '@/components/portal/RoadmapTimeline'

export const StudentRoadmapSection: React.FC<{ studentId: string }> = ({ studentId }) => {
  const { toast } = useToast()
  const { hasRole } = useAuth()
  const queryClient = useQueryClient()
  const canManageTemplates = hasRole('admin', 'mzk_manager')

  const { data, isLoading } = useQuery({
    queryKey: ['student-roadmap', studentId],
    queryFn: () => roadmapApi.studentRoadmap(studentId),
  })
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null)
  useEffect(() => {
    if (data !== undefined) setRoadmap(data)
  }, [data])

  const { data: templates = [] } = useQuery({
    queryKey: ['roadmap-templates'],
    queryFn: roadmapApi.listTemplates,
    enabled: canManageTemplates && !isLoading && !roadmap,
  })
  const [templateId, setTemplateId] = useState('')

  const assignMutation = useMutation({
    mutationFn: () => roadmapApi.assign(templateId, studentId),
    onSuccess: (rm) => {
      setRoadmap(rm)
      queryClient.invalidateQueries({ queryKey: ['student-roadmap', studentId] })
      toast({ title: 'Roadmap назначен', description: 'Студент увидит его в кабинете.' })
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail
      toast({ title: 'Не удалось назначить', description: detail ?? 'Ошибка', variant: 'destructive' })
    },
  })

  return (
    <AccordionItem value="roadmap" className="border border-gray-200 rounded-[2px] px-4">
      <AccordionTrigger className="text-base font-semibold">
        <span className="flex items-center gap-2">
          <Route className="w-4 h-4 text-gray-500" />
          Roadmap поступления
          {roadmap ? (
            <Badge variant="outline" className="ml-1 text-[10px] font-medium">
              {roadmap.stages.length} этапов
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-1 text-[10px] font-medium text-gray-500">
              не назначен
            </Badge>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        {isLoading ? (
          <p className="text-sm text-gray-500 py-2">Загрузка…</p>
        ) : roadmap ? (
          <div className="py-1">
            <RoadmapTimeline roadmap={roadmap} canManage onChanged={setRoadmap} />
          </div>
        ) : canManageTemplates ? (
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
                  className="h-9 px-3 text-sm border border-gray-300 rounded-[2px] bg-white min-w-[240px]"
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
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 py-2">
            Roadmap ещё не назначен. Назначить шаблон может администратор или менеджер.
          </p>
        )}
      </AccordionContent>
    </AccordionItem>
  )
}
