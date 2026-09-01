import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award } from 'lucide-react'
import { PageHeader, AppCard, EmptyState } from '@/components/ui'
import { QueryState } from '@/components/shared/QueryState'

interface Scholarship {
  id: string
  name: string
  country_id: string | null
  description: string | null
  requirements: string | null
  deadline: string | null
  amount: string | null
}

async function fetchScholarships(countryId?: string): Promise<Scholarship[]> {
  const params = countryId ? `?country_id=${countryId}` : ''
  const res = await fetch(`/api/v1/scholarships${params}`)
  if (!res.ok) throw new Error('Failed to fetch scholarships')
  return res.json()
}

export const WorkspaceScholarshipsPage: React.FC = () => {
  const { data: scholarships = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['workspace', 'scholarships'],
    queryFn: () => fetchScholarships(),
  })

  return (
    <div className="fade-in">
      <PageHeader
        eyebrow="Кабинет ментора"
        title="Стипендии и программы"
        description="Образовательные программы и стипендии, доступные студентам."
        colorPrefix="w"
      />

      <QueryState
        colorPrefix="w"
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        isEmpty={scholarships.length === 0}
        empty={(
          <EmptyState
            icon={<Award className="h-5 w-5" />}
            title="Стипендии пока не добавлены"
            colorPrefix="w"
          />
        )}
      >
        <div className="space-y-3">
          {scholarships.map((scholarship) => (
            <AppCard key={scholarship.id} colorPrefix="w" className="p-5">
              <h3 className="font-bold text-w-ink">{scholarship.name}</h3>

              {scholarship.description && (
                <p className="mt-2 text-xs text-w-muted">{scholarship.description}</p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                {scholarship.amount && (
                  <div>
                    <div className="font-bold text-w-muted">Размер</div>
                    <div className="font-bold text-w-ink">{scholarship.amount}</div>
                  </div>
                )}
                {scholarship.deadline && (
                  <div>
                    <div className="font-bold text-w-muted">Срок</div>
                    <div className="font-bold text-w-ink">{new Date(scholarship.deadline).toLocaleDateString('ru-RU')}</div>
                  </div>
                )}
              </div>
            </AppCard>
          ))}
        </div>
      </QueryState>
    </div>
  )
}
