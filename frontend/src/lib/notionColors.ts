/**
 * Палитра цветов Notion (select / multi-select / status) — один источник для
 * тегов на доске и в таблице пайплайна, статусов в CRM и заголовков колонок.
 *
 * Почему не классы `dark:`: tailwind здесь включает тёмный режим классом
 * `.dark`, а тема приложения живёт в `data-theme` на оболочке. Варианты `dark:`
 * поэтому не срабатывали никогда: в тёмной теме теги оставались светлыми, а
 * слой совместимости в index.css перекрашивал лишь часть классов — получались
 * зелёный текст на зелёном и светлые «вспышки».
 *
 * Как устроено: значения ниже превращаются в CSS-переменные на классе
 * `notion-tag--<цвет>`, а тема выбирает нужную пару по `[data-theme]` — так же,
 * как вся остальная тема. Контраст каждой пары проверяет notionColors.test.ts.
 *
 * Тёмная тема — как в самом Notion: насыщенный средне-тёмный фон и светлый
 * текст. Светлая — исходные цвета Notion.
 */

export const NOTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type NotionColor = (typeof NOTION_COLORS)[number]

interface ThemePair {
  /** Фон тега. */
  bg: string
  /** Текст тега. */
  text: string
  /** Приглушённый фон заголовка колонки доски: текст на нём — основной цвет темы. */
  soft: string
}

export const NOTION_PALETTE: Record<NotionColor, { light: ThemePair; dark: ThemePair; dot: string }> = {
  default: { light: { bg: '#EDECE9', text: '#32302C', soft: '#EDECE9' }, dark: { bg: '#373737', text: '#F1F1EF', soft: '#292929' }, dot: '#9B9A97' },
  gray: { light: { bg: '#E3E2E0', text: '#32302C', soft: '#E3E2E0' }, dark: { bg: '#4A4A4A', text: '#F1F1EF', soft: '#343434' }, dot: '#9B9A97' },
  brown: { light: { bg: '#EEE0DA', text: '#442A1E', soft: '#EEE0DA' }, dark: { bg: '#5C3B2E', text: '#F3E3DA', soft: '#3F2B24' }, dot: '#A27763' },
  orange: { light: { bg: '#FADEC9', text: '#49290E', soft: '#FADEC9' }, dark: { bg: '#7A4419', text: '#FCE6D3', soft: '#513117' }, dot: '#D9730D' },
  yellow: { light: { bg: '#FDECC8', text: '#402C1B', soft: '#FDECC8' }, dark: { bg: '#7A5A1E', text: '#FFF0C7', soft: '#513E1A' }, dot: '#CB912F' },
  green: { light: { bg: '#DBEDDB', text: '#1C3829', soft: '#DBEDDB' }, dark: { bg: '#24503A', text: '#D9F5E3', soft: '#1E382B' }, dot: '#448361' },
  blue: { light: { bg: '#D3E5EF', text: '#183347', soft: '#D3E5EF' }, dark: { bg: '#234266', text: '#DCE9FF', soft: '#1D3045' }, dot: '#337EA9' },
  purple: { light: { bg: '#E8DEEE', text: '#412454', soft: '#E8DEEE' }, dark: { bg: '#46305F', text: '#ECE2FF', soft: '#322541' }, dot: '#9065B0' },
  pink: { light: { bg: '#F5E0E9', text: '#4C2337', soft: '#F5E0E9' }, dark: { bg: '#63304A', text: '#FFE0EE', soft: '#432534' }, dot: '#C14C8A' },
  red: { light: { bg: '#FFE2DD', text: '#5D1715', soft: '#FFE2DD' }, dark: { bg: '#6B3330', text: '#FFE0DC', soft: '#482725' }, dot: '#D44C47' },
}

/** Цвет из Notion API → наш; незнакомый (новый цвет в Notion) — как default. */
export function toNotionColor(value: string | null | undefined): NotionColor {
  return (NOTION_COLORS as readonly string[]).includes(value ?? '') ? (value as NotionColor) : 'default'
}

/** Тег: фон + текст по теме. */
export const notionTagClass = (color: string | null | undefined) => `notion-tag notion-tag--${toNotionColor(color)}`
/** Заголовок колонки доски: приглушённый фон, текст — основной цвет темы. */
export const notionSoftClass = (color: string | null | undefined) => `notion-soft notion-tag--${toNotionColor(color)}`
/** Точка цвета статуса (одинаковая в обеих темах). */
export const notionDotClass = (color: string | null | undefined) => `notion-dot notion-tag--${toNotionColor(color)}`

/**
 * CSS из палитры. Тёмная — по умолчанию (тема приложения по умолчанию тёмная),
 * светлая — внутри любой оболочки с data-theme="light" и в порталах
 * (диалоги и меню Radix живут в <body>, тему для них держит html[data-crm-theme]).
 */
export function buildNotionCss(): string {
  const vars = NOTION_COLORS.map((color) => {
    const { light, dark, dot } = NOTION_PALETTE[color]
    return [
      `.notion-tag--${color}{--nt-bg:${dark.bg};--nt-text:${dark.text};--nt-soft:${dark.soft};--nt-dot:${dot}}`,
      `[data-theme='light'] .notion-tag--${color},html[data-crm-theme='light'] .notion-tag--${color}{--nt-bg:${light.bg};--nt-text:${light.text};--nt-soft:${light.soft}}`,
    ].join('')
  }).join('')
  return `${vars}.notion-tag{background-color:var(--nt-bg)!important;color:var(--nt-text)!important}`
    + `.notion-soft{background-color:var(--nt-soft)!important;color:var(--p-text,inherit)!important}`
    + `.notion-dot{background-color:var(--nt-dot)!important}`
}

const STYLE_ID = 'notion-palette'
if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = buildNotionCss()
  document.head.appendChild(style)
}
