import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Award } from 'lucide-react'
import { PageShell } from '@/components/shared/PageShell'

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

export const PortalScholarshipsPage: React.FC = () => {
  const { data: scholarships = [], isLoading } = useQuery({
    queryKey: ['portal', 'scholarships'],
    queryFn: () => fetchScholarships(),
  })

  return (
    <PageShell maxWidth="lg" className="animate-fade-in">
      <p className="font-display text-[11px] font-black uppercase tracking-[0.24em] text-brand">Кабинет</p>
      <h1 className="mt-2 mb-6 font-display text-[32px] font-black tracking-tight text-p-text">Стипендии</h1>

      {isLoading ? (
        <div className="text-center py-12 text-p-muted">Загрузка...</div>
      ) : scholarships.length === 0 ? (
        <div className="rounded-[16px] border border-p-line bg-p-panel p-8 text-center">
          <div className="w-11 h-11 rounded-[13px] bg-brand/15 grid place-items-center mx-auto">
            <Award className="w-5 h-5 text-brand" />
          </div>
          <h2 className="mt-4 text-base font-extrabold text-p-text">Стипендии пока не добавлены</h2>
          <p className="mt-1.5 text-sm text-p-muted">Проверьте позже или обратитесь к менторам для получения информации.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {scholarships.map((scholarship) => (
            <div key={scholarship.id} className="rounded-[13px] border border-p-line bg-p-panel p-6">
              <h3 className="font-bold text-p-text text-lg">{scholarship.name}</h3>

              {scholarship.description && (
                <p className="mt-3 text-sm text-p-muted">{scholarship.description}</p>
              )}

              <div className="mt-4 space-y-2">
                {scholarship.amount && (
                  <div className="flex justify-between text-sm">
                    <span className="text-p-muted">Размер:</span>
                    <span className="font-bold text-p-text">{scholarship.amount}</span>
                  </div>
                )}
                {scholarship.deadline && (
                  <div className="flex justify-between text-sm">
                    <span className="text-p-muted">Срок подачи:</span>
                    <span className="font-bold text-p-text">{new Date(scholarship.deadline).toLocaleDateString('ru-RU')}</span>
                  </div>
                )}
              </div>

              {scholarship.requirements && (
                <div className="mt-4 pt-4 border-t border-p-line">
                  <p className="text-xs font-bold uppercase tracking-[0.06em] text-p-muted2">Требования</p>
                  <p className="mt-2 text-sm text-p-muted">{scholarship.requirements}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  )
}
