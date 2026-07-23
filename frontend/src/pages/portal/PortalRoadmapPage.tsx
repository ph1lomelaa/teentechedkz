import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { PortalRoadmap } from '@/components/portal/PortalRoadmap'
import { EmptyState } from '@/components/ui'

export const PortalRoadmapPage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ['portal', 'roadmap'], queryFn: roadmapApi.myRoadmap })
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null)
  useEffect(() => {
    if (data !== undefined) setRoadmap(data)
  }, [data])

  if (isLoading) return <div className="text-p-muted text-sm">Загрузка…</div>

  return (
    <PageShell maxWidth="full">
      <div>
      <p className="font-display text-[11px] tracking-[0.24em] uppercase text-brand mb-3">
        Дорожная карта поступления
      </p>

      {!roadmap ? (
        <EmptyState icon={<Map className="w-5 h-5" />} title="Roadmap ещё не назначен" description="Как только ментор назначит вам дорожную карту, здесь появится интерактивный таймлайн этапов с задачами." colorPrefix="p" />
      ) : (
        <PortalRoadmap roadmap={roadmap} onChanged={setRoadmap} />
      )}
      </div>
    </PageShell>
  )
}
