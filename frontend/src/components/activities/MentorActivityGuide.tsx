import { BookOpen, ChevronDown } from 'lucide-react'

const sections = [
  ['1. Ученики', 'Вкладка «Ученики» — с неё начинается день. У каждого ученика видно, что нужно от вас, что в работе и что уже стало достижением. Мини-полка показывает типы опыта: зелёная ячейка значит, что достижение есть. «Портфолио» открывает всё по ученику на одном экране.'],
  ['2. Фокус и подбор', 'В портфолио ученика напишите 1–2 строки «что усилить» — ученик увидит их вверху своего раздела. В пустой ячейке полки нажмите «Подобрать»: откроется каталог с этим типом. Там «Рекомендовать»: ученик решит сам, «Сразу в план» — участие появится у него сразу.'],
  ['3. Шаги', 'Соберите 2–5 шагов со сроками. По умолчанию ученик закрывает шаг сам. «Нужна проверка ментора» включайте только там, где важен ваш ответ: эссе, заявка, мотивационное письмо. «Обязательный файл» — если нужно подтверждение.'],
  ['4. Проверка', '«Нужно от меня» и общая страница «Проверка» показывают шаги на проверке и итоги участия. Возвращая работу, напишите, что исправить: ученик увидит комментарий первым пунктом в «Сейчас».'],
  ['5. Итог', 'Когда обязательные шаги выполнены, ученик отправляет итог и файл. «Подтвердить итог» превращает участие в достижение и заполняет ячейку полки. Регистрацию у организатора ученик делает сам на сайте организатора.'],
]

export function MentorActivityGuide() {
  return <details className="group rounded-panel border border-ds-line bg-ds-panel">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-bold"><BookOpen className="h-4 w-4 shrink-0 text-ds-muted" aria-hidden />Как работать с портфолио учеников<ChevronDown className="ml-auto h-4 w-4 shrink-0 text-ds-muted transition group-open:rotate-180" aria-hidden /></summary>
    <div className="grid gap-5 border-t border-ds-line p-4 sm:p-5 lg:grid-cols-2">{sections.map(([title, text]) => <section key={title} className="min-w-0"><h2 className="text-sm font-bold">{title}</h2><p className="mt-2 text-sm leading-relaxed text-ds-muted">{text}</p></section>)}</div>
  </details>
}
