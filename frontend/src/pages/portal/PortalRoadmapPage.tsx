import React, { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Map } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'
import { roadmapApi, Roadmap } from '@/api/roadmap'
import { PortalRoadmap } from '@/components/portal/PortalRoadmap'

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
        <div className="mt-4 rounded-[16px] border border-p-line bg-p-panel p-10 text-center">
          <div className="w-14 h-14 rounded-full bg-brand/15 grid place-items-center mx-auto">
            <Map className="w-7 h-7 text-brand" />
          </div>
          <h2 className="mt-4 font-display text-[18px] font-extrabold text-p-text">Roadmap ещё не назначен</h2>
          <p className="mt-2 text-[13.5px] text-p-muted max-w-md mx-auto">
            Как только ментор назначит вам дорожную карту, здесь появится интерактивный таймлайн
            этапов с задачами.
          </p>
        </div>
      ) : (
        <PortalRoadmap roadmap={roadmap} onChanged={setRoadmap} />
      )}
      </div>
    </PageShell>
  )
}
