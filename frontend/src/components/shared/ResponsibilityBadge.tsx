import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserCheck } from 'lucide-react'
import { ResponsibilityArea, responsibilitiesApi } from '@/api/responsibilities'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Метка «чей это участок» в заголовке раздела карточки ученика.
 *
 * Отвечает на вопрос, который до сих пор задать было негде: у ученика
 * несколько менторов и МЗК, и кто именно ведёт встречи или Telegram — не
 * знал никто.
 *
 * Метка ничего не ограничивает. Раздел открывает право (`can()`); метка лишь
 * говорит, к кому идти с вопросом. Поэтому она и выглядит как подпись, а не
 * как замок.
 *
 * Три состояния, и каждое подписано словом: цвет в одиночку не читается при
 * дальтонизме и в чёрно-белой печати, а «без ответственного» — самое важное
 * из трёх, потому что это и есть дыра, которую надо закрыть.
 *
 * Запрос общий с секцией «Кто за что отвечает» (тот же queryKey), поэтому
 * десять меток на карточке не дают десяти запросов.
 */
export const ResponsibilityBadge: React.FC<{
  studentId: string
  area: ResponsibilityArea
}> = ({ studentId, area }) => {
  const { user, can } = useAuth()
  const { data } = useQuery({
    queryKey: ['responsibilities', studentId],
    queryFn: () => responsibilitiesApi.forStudent(studentId),
    enabled: can('responsibilities', 'view'),
    staleTime: 60_000,
  })

  if (!data) return null
  const cell = data.areas.find((a) => a.area === area)
  if (!cell) return null

  if (cell.user_id && cell.user_id === user?.id) {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill border border-p-accent/30 bg-p-accent/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-p-accent">
        <UserCheck className="h-3 w-3" aria-hidden />
        Ваш участок
      </span>
    )
  }

  if (cell.user_name) {
    return (
      <span className="inline-flex items-center gap-1 rounded-pill border border-p-line px-2 py-0.5 text-[10px] font-medium text-p-muted">
        Ведёт: {cell.user_name}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700">
      Без ответственного
    </span>
  )
}
