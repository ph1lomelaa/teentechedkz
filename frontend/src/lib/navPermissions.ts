import type { PermissionAction } from '@/api/permissions'

/**
 * Право, без которого пункт меню не показывается (Этап 2.5).
 *
 * Тот же кортеж стоит пропом `permission` на роуте в `App.tsx`. До этого меню и
 * роуты знали о доступе по-разному: пункт прятали условием по роли, а прямая
 * ссылка продолжала работать — так жил `/workspace/security-incidents`.
 */
export type NavPermission = [resource: string, action: PermissionAction]

interface NavItemLike {
  permission?: NavPermission
}

interface NavGroupLike<TItem extends NavItemLike> {
  items: TItem[]
}

/**
 * Убрать пункты, на которые у роли нет права, и опустевшие группы целиком.
 *
 * Фильтр **добавочный**: он стоит поверх деления на группы, которое уже есть в
 * каждой оболочке, и может только сузить показ. Пункт без `permission`
 * проходит — в реестре описано не всё (уведомления, статистика), и молчаливо
 * прятать такое было бы хуже, чем показать.
 *
 * Общая функция на три оболочки: разъехавшийся фильтр — это ровно тот способ,
 * которым меню и роуты уже однажды разошлись.
 */
export function filterNavByPermission<TItem extends NavItemLike, TGroup extends NavGroupLike<TItem>>(
  groups: TGroup[],
  can: (resource: string, action: PermissionAction) => boolean,
): TGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || can(item.permission[0], item.permission[1])),
    }))
    .filter((group) => group.items.length > 0)
}
