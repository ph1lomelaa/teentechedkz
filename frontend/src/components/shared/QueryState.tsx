import React from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { getErrorMessage } from '@/lib/errorMessage'
import { AppButton, AppCard, SkeletonRows } from '@/components/ui'
import { cn } from '@/lib/utils'

type ColorPrefix = 'ds' | 'p' | 'w'

/**
 * Три состояния запроса в одном месте: грузится / не загрузилось / пусто.
 *
 * Зачем: в проекте 67 файлов с `isLoading` и только 10 с обработкой ошибок.
 * Из-за этого упавший запрос выглядел не как поломка, а как пустой раздел —
 * студент читал «Задач пока нет» вместо «связь пропала». Разница принципиальная:
 * в первом случае человек ждёт ментора, во втором жмёт «Повторить».
 *
 * «Пусто» намеренно оставлено вызывающей стороне: текст пустого состояния
 * зависит от раздела и написан хорошо — компонент его не подменяет, а лишь
 * решает, когда показать.
 */
interface QueryStateProps {
  isLoading: boolean
  /** Прокидывается из useQuery; без него компонент работает как «загрузка/пусто». */
  isError?: boolean
  error?: unknown
  /** react-query `refetch`. Нет — кнопка «Повторить» не рисуется. */
  onRetry?: () => void
  /** Показать пустое состояние вместо детей. */
  isEmpty?: boolean
  empty?: React.ReactNode
  /** Свой скелетон под форму конкретного экрана; иначе — строки. */
  skeleton?: React.ReactNode
  skeletonRows?: number
  colorPrefix?: ColorPrefix
  className?: string
  children: React.ReactNode
}

const TITLE_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-ink',
  p: 'text-p-text',
  w: 'text-w-ink',
}

const TEXT_CLASS: Record<ColorPrefix, string> = {
  ds: 'text-ds-muted',
  p: 'text-p-muted',
  w: 'text-w-muted',
}

const ICON_CLASS: Record<ColorPrefix, string> = {
  ds: 'border-ds-danger/25 bg-ds-danger/[0.08] text-ds-danger',
  p: 'border-p-danger/25 bg-p-danger/[0.08] text-p-danger',
  w: 'border-w-danger/25 bg-w-danger/[0.08] text-w-danger',
}

export const QueryError: React.FC<{
  error?: unknown
  onRetry?: () => void
  colorPrefix?: ColorPrefix
  className?: string
}> = ({ error, onRetry, colorPrefix = 'ds', className }) => (
  <AppCard
    colorPrefix={colorPrefix}
    className={cn('px-4 py-8 text-center sm:px-8 sm:py-10', className)}
    role="alert"
  >
    <div className={cn('mx-auto grid h-16 w-16 place-items-center rounded-pill border', ICON_CLASS[colorPrefix])}>
      <AlertTriangle className="h-6 w-6" />
    </div>
    <div className={cn('mt-5 font-display text-lg font-black', TITLE_CLASS[colorPrefix])}>
      Не удалось загрузить
    </div>
    <div className={cn('mx-auto mt-2 max-w-md text-sm', TEXT_CLASS[colorPrefix])}>
      {getErrorMessage(error, 'Данные не пришли. Проверьте связь и повторите.')}
    </div>
    {onRetry && (
      <div className="mt-5">
        <AppButton colorPrefix={colorPrefix} variant="subtle" size="sm" onClick={onRetry}>
          <RotateCw className="mr-1.5 h-3.5 w-3.5" />
          Повторить
        </AppButton>
      </div>
    )}
  </AppCard>
)

export const QueryState: React.FC<QueryStateProps> = ({
  isLoading,
  isError,
  error,
  onRetry,
  isEmpty,
  empty,
  skeleton,
  skeletonRows = 4,
  colorPrefix = 'ds',
  className,
  children,
}) => {
  // Ошибка важнее загрузки: при refetch react-query снова поднимает isLoading,
  // и без этого порядка экран мигал бы скелетоном вместо показа причины.
  if (isError) return <QueryError error={error} onRetry={onRetry} colorPrefix={colorPrefix} className={className} />
  if (isLoading) return <>{skeleton ?? <SkeletonRows rows={skeletonRows} colorPrefix={colorPrefix} />}</>
  if (isEmpty && empty) return <>{empty}</>
  return <>{children}</>
}
