import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award } from 'lucide-react'

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
  const { data: scholarships = [], isLoading } = useQuery({
    queryKey: ['workspace', 'scholarships'],
    queryFn: () => fetchScholarships(),
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="font-display text-[28px] font-black text-w-text">Стипендии и программы</h1>
        <p className="mt-2 text-sm text-w-muted">Образовательные программы и стипендии доступные студентам</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-w-muted">Загрузка...</div>
      ) : scholarships.length === 0 ? (
        <div className="rounded-[14px] border border-w-line bg-w-panel p-8 text-center">
          <Award className="w-6 h-6 text-w-brand mx-auto opacity-30" />
          <h2 className="mt-4 text-sm font-extrabold text-w-text">Стипендии пока не добавлены</h2>
        </div>
      ) : (
        <div className="space-y-4">
          {scholarships.map((scholarship) => (
            <div key={scholarship.id} className="rounded-[12px] border border-w-line bg-w-panel p-5">
              <h3 className="font-bold text-w-text">{scholarship.name}</h3>

              {scholarship.description && (
                <p className="mt-2 text-xs text-w-muted">{scholarship.description}</p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                {scholarship.amount && (
                  <div>
                    <div className="text-w-muted font-bold">Размер</div>
                    <div className="text-w-text font-bold">{scholarship.amount}</div>
                  </div>
                )}
                {scholarship.deadline && (
                  <div>
                    <div className="text-w-muted font-bold">Срок</div>
                    <div className="text-w-text font-bold">{new Date(scholarship.deadline).toLocaleDateString('ru-RU')}</div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
