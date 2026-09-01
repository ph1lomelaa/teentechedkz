import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterNavByPermission, type NavPermission } from './navPermissions'
import { getNavGroups } from '@/components/shared/Layout'

/**
 * Меню и роут обязаны читать один и тот же ключ (Этап 2.5).
 *
 * Ради чего тест: `/workspace/security-incidents` был скрыт из меню для ментора
 * и при этом открыт по прямой ссылке. Дыра возникла не по недосмотру, а потому
 * что доступ был записан дважды — условием по роли в навигации и отдельным
 * условием на роуте. Пока это два разных места, они будут расходиться.
 *
 * Ниже проверяется и сам фильтр, и то, что ключи в оболочках и в `App.tsx`
 * совпадают. Второе читает исходники — приём взят с бэкенда
 * (`test_permissions_wiring.py`): свойство «записано в одном месте» иначе не
 * выражается.
 */
const SRC = resolve(__dirname, '..')

function read(relative: string): string {
  return readFileSync(resolve(SRC, relative), 'utf-8')
}

/** path -> permission, как их объявляет оболочка. */
function navPermissions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const item = /path:\s*'([^']+)'[\s\S]{0,200}?permission:\s*\[([^\]]+)\]/g
  let match: RegExpExecArray | null
  while ((match = item.exec(source))) {
    out.set(match[1], match[2].replace(/['\s]/g, ''))
  }
  return out
}

/** path -> permission, как их объявляет роут.
 *
 * Разбор по кускам «от `<Route` до `<Route`», а не одной регуляркой по всему
 * файлу: роуты стоят подряд, и жадный поиск склеивал путь одного с правом
 * следующего. */
function routePermissions(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const chunk of source.split('<Route')) {
    const path = /path="([^"]+)"/.exec(chunk)
    const permission = /permission=\{\[([^\]]+)\]\}/.exec(chunk)
    if (path && permission) out.set(path[1], permission[1].replace(/['\s]/g, ''))
  }
  return out
}

/** path -> label, как их объявляет оболочка. */
function navLabels(source: string): Map<string, string> {
  const out = new Map<string, string>()
  const item = /label:\s*'([^']+)',\s*path:\s*'([^']+)'/g
  let match: RegExpExecArray | null
  while ((match = item.exec(source))) {
    out.set(match[2], match[1])
  }
  return out
}

/** path -> имя компонента страницы, как их объявляет App.tsx. */
function routeComponents(source: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const chunk of source.split('<Route')) {
    const path = /path="([^"]+)"/.exec(chunk)
    const component = /<([A-Z]\w+Page)\s*\/>/.exec(chunk)
    if (path && component) out.set(path[1], component[1])
  }
  return out
}

interface TestItem {
  label: string
  permission?: NavPermission
}

describe('filterNavByPermission', () => {
  const groups: Array<{ group: string; items: TestItem[] }> = [
    {
      group: 'A',
      items: [
        { label: 'открыто', permission: ['students', 'view'] },
        { label: 'закрыто', permission: ['security_incidents', 'manage'] },
      ],
    },
    { group: 'B', items: [{ label: 'без права' }] },
    { group: 'C', items: [{ label: 'тоже закрыто', permission: ['checkins', 'view'] }] },
  ]
  const can = (resource: string) => resource === 'students'

  it('убирает пункты без права', () => {
    const visible = filterNavByPermission(groups, can)
    expect(visible[0].items.map((i) => i.label)).toEqual(['открыто'])
  })

  it('пропускает пункт, у которого права не объявлено', () => {
    // В реестре описано не всё (уведомления, статистика). Прятать такое молча
    // хуже, чем показать: пропажа раздела выглядит как поломка.
    const visible = filterNavByPermission(groups, can)
    expect(visible.map((g) => g.group)).toContain('B')
  })

  it('выбрасывает группу, из которой не осталось ни одного пункта', () => {
    expect(filterNavByPermission(groups, can).map((g) => g.group)).not.toContain('C')
  })
})

describe('меню и роуты читают один ключ', () => {
  const app = read('App.tsx')
  const shells = [
    navPermissions(read('components/shared/Layout.tsx')),
    navPermissions(read('layouts/WorkspaceLayout.tsx')),
    navPermissions(read('components/portal/StudentPortalLayout.tsx')),
  ]

  it('каждый роут с правом совпадает с пунктом меню того же пути', () => {
    const routes = routePermissions(app)
    expect(routes.size).toBeGreaterThan(0)
    for (const [path, permission] of routes) {
      const declared = shells.map((shell) => shell.get(path)).find(Boolean)
      if (!declared) continue // роут без пункта меню — например, страница-деталь
      expect(`${path}: ${declared}`).toBe(`${path}: ${permission}`)
    }
  })

  it('роутов, решающих по роли, не становится больше', () => {
    // 30.08.2026: было 17, стало 1 — только /statistics, у которого нет своего
    // ресурса (см. докстринг ProtectedRoute). Счётчик держит движение в одну
    // сторону: пока роут решает по роли, переключатель в конструкторе прав его
    // не сдвинет, и прямая ссылка расходится с меню.
    const byRole = app.match(/roles=\{\[/g) ?? []
    expect(byRole.length).toBeLessThanOrEqual(1)
  })

  it('дыра с инцидентами безопасности закрыта на роуте, а не только в меню', () => {
    // Прямая ссылка пускала любого сотрудника, пока право знало только меню.
    expect(routePermissions(app).get('/workspace/security-incidents')).toBe(
      'security_incidents,manage',
    )
  })
})

describe('одно и то же называется одинаково', () => {
  /**
   * Ради чего этот блок.
   *
   * Оболочек две (CRM и кабинет), и часть разделов есть в обеих. Пока имя
   * пункта пишется в каждой отдельно, они расходятся — и человек, перешедший
   * из CRM в кабинет, не узнаёт тот же экран. На 30.08.2026 разошлись четверо:
   * «Статусы»/«Статус» и «Возвраты»/«Возвратные кейсы» — один и тот же
   * компонент под двумя именами; «Вознаграждения/Вознаграждение менторов» —
   * разница в числе; «Roadmap» — наоборот, одно имя на два разных экрана
   * (шаблоны против дорожной карты студента).
   *
   * Проверка идёт по компоненту, а не по пути: пути у оболочек разные по
   * определению, а экран за ними — один и тот же объект.
   */
  const components = routeComponents(read('App.tsx'))
  const labels = new Map<string, string>([
    ...navLabels(read('components/shared/Layout.tsx')),
    ...navLabels(read('layouts/WorkspaceLayout.tsx')),
  ])

  it('один экран — одно имя', () => {
    const byComponent = new Map<string, Set<string>>()
    for (const [path, label] of labels) {
      const component = components.get(path)
      if (!component) continue
      if (!byComponent.has(component)) byComponent.set(component, new Set())
      byComponent.get(component)!.add(label)
    }
    const clashes = [...byComponent]
      .filter(([, names]) => names.size > 1)
      .map(([component, names]) => `${component}: ${[...names].join(' / ')}`)
    expect(clashes).toEqual([])
  })

  it('одно имя — один экран', () => {
    const byLabel = new Map<string, Set<string>>()
    for (const [path, label] of labels) {
      const component = components.get(path)
      if (!component) continue
      if (!byLabel.has(label)) byLabel.set(label, new Set())
      byLabel.get(label)!.add(component)
    }
    // Пара `XPage` / `WorkspaceXPage` — это один раздел в двух оболочках, и
    // общее имя там правильно: человек должен узнавать тот же экран. Сведение
    // самих оболочек в одну — отдельная большая задача, здесь она не решается.
    // Нарушение — это когда за одним именем стоят разные разделы: так «Roadmap»
    // означал и шаблоны дорожных карт, и дорожную карту студента.
    const subject = (component: string) => component.replace(/^Workspace/, '')
    const clashes = [...byLabel]
      .filter(([, comps]) => new Set([...comps].map(subject)).size > 1)
      .map(([label, comps]) => `${label}: ${[...comps].join(' / ')}`)
    expect(clashes).toEqual([])
  })
})

/**
 * Дубли между оболочками (пункт 6 разбора).
 *
 * Ради чего тест: «Статус», «Обращения» и «Мои задачи» — это буквально одни и
 * те же компоненты, смонтированные по двум адресам. У ментора из-за таких
 * дублей меню разрасталось до 15 пунктов в CRM против 19 в кабинете, и он
 * работал в двух параллельных интерфейсах. Убрать такой пункт легко, вернуть
 * случайно — ещё легче: он выглядит как обычная строчка в списке.
 *
 * Проверка читает исходники по тем же соображениям, что и выше: свойство «этой
 * строки здесь быть не должно» иначе не выразить.
 */
describe('дубли разделов между оболочками', () => {
  const crmShell = read('components/shared/Layout.tsx')
  const getNavPaths = (role: string) =>
    getNavGroups(role).flatMap((group) => group.items.map((item) => item.path))

  it('«Мои задачи» остались одним адресом', () => {
    // Личная работа принадлежит кабинету по границе самих оболочек, туда же
    // ведёт уведомление о санкции SLA. В CRM для команды есть «Задачи менторов».
    expect(crmShell).not.toContain("path: '/my-tasks'")
    expect(read('layouts/WorkspaceLayout.tsx')).toContain("path: '/workspace/my-tasks'")
  })

  it('старый адрес «моих задач» не оставлен мёртвым', () => {
    // Ссылки и закладки на /my-tasks существуют — адрес обязан вести на живую
    // страницу, а не в «страница не найдена».
    expect(read('App.tsx')).toContain('<Route path="/my-tasks" element={<Navigate to="/workspace/my-tasks" replace />} />')
  })

  it('у ментора нет дублей «Статус» и «Обращения»', () => {
    const mentorPaths = new Set(getNavPaths('mentor'))
    expect(mentorPaths.has('/status-inbox')).toBe(false)
    expect(mentorPaths.has('/complaints')).toBe(false)
  })

  it('у админа и МЗК эти разделы остаются в CRM', () => {
    // Обратная сторона: CRM для них надмножество и основное место работы —
    // выселять их в другую оболочку значит менять одно неудобство на другое.
    for (const role of ['admin', 'mzk_manager']) {
      const paths = new Set(getNavPaths(role))
      expect(paths.has('/status-inbox')).toBe(true)
      expect(paths.has('/complaints')).toBe(true)
    }
  })
})
