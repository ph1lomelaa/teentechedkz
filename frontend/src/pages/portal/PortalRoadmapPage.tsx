import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { QueryState } from '@/components/shared/QueryState'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { PortalRoadmap } from '@/components/portal/PortalRoadmap'
import { withViewTransition } from '@/lib/motion'
import { EmptyState, SegmentedTabs } from '@/components/ui'

export const PortalRoadmapPage: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: ['portal', 'roadmap'], queryFn: roadmapApi.myRoadmaps })
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => {
    if (data !== undefined) {
      setRoadmaps(data)
      setSelectedId((current) => (current && data.some((r) => r.id === current)) ? current : data[0]?.id ?? null)
    }
  }, [data])


  const selected = roadmaps.find((r) => r.id === selectedId) ?? null

  return (
    <PageShell maxWidth="full">
      <div>
      <p className="font-display text-[11px] tracking-[0.24em] uppercase text-brand mb-3">
        Дорожная карта поступления
      </p>

      <QueryState
        colorPrefix="p"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={roadmaps.length === 0}
        empty={(
          <EmptyState icon={<Map className="w-5 h-5" />} title="Roadmap ещё не назначен" description="Как только ментор назначит вам дорожную карту, здесь появится интерактивный таймлайн этапов с задачами." colorPrefix="p" />
        )}
      >
        <>
          {roadmaps.length > 1 && (
            <SegmentedTabs
              className="mb-4"
              colorPrefix="p"
              value={selectedId ?? ''}
              onChange={(id) => withViewTransition(() => setSelectedId(id))}
              tabs={roadmaps.map((r) => ({ value: r.id, label: r.name }))}
            />
          )}
          {selected && (
            <div key={selected.id} className="anim-view-in">
              <PortalRoadmap roadmap={selected} />
            </div>
          )}
        </>
      </QueryState>
      </div>
    </PageShell>
  )
}
