import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { toast } from '@/hooks/use-toast'
import { getErrorMessage } from '@/lib/errorMessage'

/**
 * Общий перехват ошибок запросов и мутаций.
 *
 * Зачем: в проекте 91 файл с useQuery и 195 мутаций, а сообщали об ошибке
 * единицы. Человек нажимал «сохранить» — ничего не происходило и никто не
 * объяснял почему; раздел с упавшим запросом выглядел не как поломка, а как
 * пустой список. Разбирать это по местам правильно, но долго, а молчание
 * стоит дорого каждый день. Общий перехват — нижняя граница: хуже, чем
 * разобранный экран, но несравнимо лучше тишины.
 *
 * Он именно нижняя граница, а не замена QueryState: тост исчезает и не даёт
 * «Повторить». Там, где экран умеет показать причину и кнопку, он и должен
 * это делать.
 */

// Обрыв связи роняет все запросы экрана разом — их бывает десяток. Без склейки
// человек получил бы стопку одинаковых тостов вместо одного сообщения.
const DUPLICATE_WINDOW_MS = 4000
let lastMessage = ''
let lastAt = 0

function reportOnce(title: string, error: unknown, fallback: string) {
  const description = getErrorMessage(error, fallback)
  const now = Date.now()
  if (description === lastMessage && now - lastAt < DUPLICATE_WINDOW_MS) return
  lastMessage = description
  lastAt = now
  toast({ title, description, variant: 'destructive' })
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) =>
        reportOnce('Не удалось загрузить данные', error, 'Проверьте связь и повторите.'),
    }),
    mutationCache: new MutationCache({
      // Свой onError у мутации — знак, что место уже умеет объяснить ошибку
      // по-своему («задача не отмечена», «чек не загрузился»). Общий тост там
      // был бы вторым сообщением об одном и том же.
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.options.onError) return
        reportOnce('Действие не выполнено', error, 'Попробуйте повторить.')
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}
