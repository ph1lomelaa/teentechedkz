import type { ActInput, ActTemplate } from '@/api/acts'

export const ACT_CATALOG: { id: Exclude<ActTemplate, 'final'>; title: string; description: string; services: string[] }[] = [
  { id: 'portfolio', title: 'Академическое портфолио', description: 'Анализ достижений, план улучшения и работа с материалами.', services: [
    'Анализ академических достижений и внеучебной активности абитуриента',
    'Подготовка индивидуального плана улучшения академического портфолио',
    'Консультации по подбору профильных активностей и проектов',
    'Проверка и систематизация материалов академического портфолио',
  ] },
  { id: 'ielts', title: 'Подготовка IELTS', description: 'Занятия, проверка работ и рекомендации за выбранный период.', services: [
    'Проведение занятий по подготовке к международному экзамену IELTS',
    'Подготовка к разделам Listening, Reading, Writing и Speaking',
    'Проверка письменных работ и предоставление обратной связи',
    'Итоговая консультация и рекомендации по дальнейшей подготовке',
  ] },
  { id: 'profile', title: 'Оценка профиля', description: 'Установочная консультация, анализ профиля и рекомендации.', services: [
    'Проведение установочной консультации с абитуриентом',
    'Сбор и анализ сведений об образовании, целях и достижениях',
    'Оценка академического и личного профиля абитуриента',
    'Подготовка резюме профиля и рекомендаций по дальнейшей работе',
  ] },
  { id: 'stages', title: 'Несколько этапов', description: 'Общий акт по нескольким фактически выполненным этапам.', services: [
    'Сбор анамнеза, оценка профиля и подготовка рекомендаций',
    'Консультации и сопровождение улучшения академического портфолио',
    'Проведение занятий по подготовке к международному экзамену IELTS',
    'Проверка выполненных работ и предоставление итоговых рекомендаций',
  ] },
]
export const REQUISITES = [
  ['student_name', 'Фамилия и имя студента по договору', true],
  ['customer_name', 'Заказчик / подписант по договору', true],
  ['student_id_number', 'ИИН / идентификатор студента', false],
  ['customer_id', 'ИИН / идентификатор заказчика', false],
  ['customer_email', 'Email заказчика', false],
  ['contract_number', 'Номер договора', true],
  ['contract_date', 'Дата договора', true],
  ['executor_name', 'Исполнитель', true],
  ['executor_representative', 'Представитель исполнителя', true],
  ['executor_basis', 'Основание полномочий', true],
  ['executor_requisites', 'Реквизиты исполнителя', false],
  ['city', 'Город', true],
] as const satisfies readonly (readonly [keyof ActInput, string, boolean])[]
export const actToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Almaty' }).format(new Date())
export function documentTitle(name: string) { return name.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() }
export function displayDate(value?: string | null) { return value ? value.slice(0, 10).split('-').reverse().join('.') : 'Без даты' }
