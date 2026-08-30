import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterNavByPermission, type NavPermission } from './navPermissions'

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

  it('дыра с инцидентами безопасности закрыта на роуте, а не только в меню', () => {
    // Прямая ссылка пускала любого сотрудника, пока право знало только меню.
    expect(routePermissions(app).get('/workspace/security-incidents')).toBe(
      'security_incidents,manage',
    )
  })
})
