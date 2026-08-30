import apiClient from './client'
import { UserRole } from '../types'

/**
 * Матрица прав (Этап 2.1). Формы повторяют app/schemas/permissions.py.
 *
 * Клетки приходят посчитанными: сервер разворачивает правило по ролям через те
 * же allows()/scope_for(), которыми пускает или не пускает эндпоинты. Считать
 * их здесь заново — значит завести второй экземпляр логики, который однажды
 * разойдётся с настоящим поведением.
 */
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'manage'

export type PermissionScope = 'all' | 'assigned' | 'own'

export interface PermissionRoleCell {
  allowed: boolean
  /** Заполнен только у разрешённой роли — иначе клетка читалась бы как доступ. */
  scope: PermissionScope | null
}

export interface PermissionMatrixRule {
  resource: string
  action: PermissionAction
  roles: Record<UserRole, PermissionRoleCell>
  /** null — «регламентом не зафиксировано». Это сигнал, а не пропуск данных. */
  basis: string | null
  /** Условия, не выразимые через «роль × действие × скоуп». */
  extra_rules: string[]
  denied_detail: string | null
  error_code: string
  /** Поведение расходится с ожиданием, решение отложено осознанно. */
  review: string | null
  /**
   * Правило нельзя переключать: без него нельзя управлять системой.
   * Строка показывается, но без переключателей — иначе админ будет искать
   * пропавшее право.
   */
  locked: boolean
  /** Состав ролей задан в конструкторе, а не взят из кода. */
  is_overridden: boolean
}

export interface PermissionMatrixSummary {
  resources: number
  rules: number
  needs_review: number
  rules_with_extra: number
  extra_rules: number
}

export interface PermissionMatrix {
  roles: UserRole[]
  actions: PermissionAction[]
  resources: string[]
  rules: PermissionMatrixRule[]
  summary: PermissionMatrixSummary
}

export const permissionsApi = {
  matrix: async (): Promise<PermissionMatrix> => {
    const response = await apiClient.get<PermissionMatrix>('/permissions/matrix')
    return response.data
  },

  /**
   * Заменить состав ролей у правила.
   *
   * Один вызов меняет всё сразу — пункт меню, роут и сам эндпоинт: они читают
   * один ключ. Ради этого из интерфейса и убирался хардкод.
   */
  setRoles: async (
    resource: string,
    action: PermissionAction,
    roles: UserRole[],
  ): Promise<{ roles: UserRole[]; previous_roles: UserRole[] }> => {
    const response = await apiClient.put<{ roles: UserRole[]; previous_roles: UserRole[] }>(
      `/permissions/matrix/${resource}/${action}`,
      { roles },
    )
    return response.data
  },
}
