import React, { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, KeyRound, Layers, ListChecks, Lock } from 'lucide-react'
import {
  PermissionAction,
  PermissionMatrixRule,
  PermissionScope,
  permissionsApi,
} from '@/api/permissions'
import { toast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { ROLE_LABELS, UserRole } from '@/types'
import { Input } from '@/components/ui/primitives/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/primitives/table'
import { PageHeader, StatCard } from '@/components/ui'
import {
  OTHER_GROUP,
  RESOURCE_GROUPS,
  groupTitleFor,
  resourceLabel,
} from '@/lib/permissionLabels'

const ACTION_LABELS: Record<PermissionAction, string> = {
  view: 'Просмотр',
  create: 'Создание',
  edit: 'Правка',
  delete: 'Удаление',
  manage: 'Полный доступ',
}

// Формулировки взяты из docstring Scope в app/core/permissions.py — расходиться
// им нельзя, иначе страница начнёт обещать не тот объём данных.
const SCOPE_LABELS: Record<PermissionScope, string> = {
  all: 'весь раздел',
  assigned: 'свои студенты',
  own: 'своя запись',
}

function ruleKey(rule: PermissionMatrixRule): string {
  return `${rule.resource}:${rule.action}`
}

/**
 * Клетка «роль × правило».
 *
 * `all` намеренно остаётся без подписи: это значение по умолчанию у большинства
 * из 74 правил, и подписывать его везде — значит утопить в шуме те немногие
 * клетки, где объём данных действительно урезан. Подпись = отклонение.
 */
function RoleCell({
  rule,
  role,
  editable,
  pending,
  onToggle,
}: {
  rule: PermissionMatrixRule
  role: UserRole
  editable: boolean
  pending: boolean
  onToggle: () => void
}) {
  const cell = rule.roles[role]
  const allowed = !!cell?.allowed

  const mark = (
    <span className="inline-flex flex-col gap-0.5">
      <span className={allowed ? 'text-emerald-700' : 'text-p-muted2'} aria-hidden>
        {allowed ? '✓' : '—'}
      </span>
      {allowed && cell?.scope && cell.scope !== 'all' && (
        <span className="text-[11px] leading-tight text-p-muted">{SCOPE_LABELS[cell.scope]}</span>
      )}
    </span>
  )

  if (!editable) {
    return <span aria-label={allowed ? 'есть доступ' : 'нет доступа'}>{mark}</span>
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      // Роль и текущее состояние — в имени кнопки: без этого экран читается
      // как таблица одинаковых галочек, а скринридер называет их «кнопка».
      aria-label={`${ROLE_LABELS[role]}: ${allowed ? 'есть доступ' : 'нет доступа'}. Нажмите, чтобы ${allowed ? 'закрыть' : 'открыть'}`}
      aria-pressed={allowed}
      className="w-full rounded-ctl px-2 py-1 transition-colors hover:bg-p-line/40 disabled:opacity-50"
    >
      {mark}
    </button>
  )
}

/** Раскрытая строка: всё, что в клетку не влезло. */
function RuleDetails({ rule, colSpan }: { rule: PermissionMatrixRule; colSpan: number }) {
  return (
    <TableRow className="border-p-line hover:bg-transparent">
      <TableCell colSpan={colSpan} className="bg-p-bg">
        <div className="flex flex-col gap-3 py-1 text-sm">
          {rule.review && (
            <div className="rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <span className="font-medium">Требует решения. </span>
              {rule.review}
            </div>
          )}
          {rule.extra_rules.length > 0 && (
            <div>
              <p className="label-caps mb-1.5">Дополнительные условия</p>
              <ul className="flex flex-col gap-1 text-p-muted">
                {rule.extra_rules.map((extra) => (
                  <li key={extra} className="leading-5">— {extra}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-x-8 gap-y-1 text-xs text-p-muted">
            <span>Основание: {rule.basis ?? 'регламентом не зафиксировано'}</span>
            <span>Код отказа: {rule.error_code}</span>
            {rule.denied_detail && <span>Текст отказа: «{rule.denied_detail}»</span>}
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

/**
 * Матрица прав, только чтение. Правки нет и не планируется: реестр живёт в коде
 * (app/core/permissions.py), и редактирование прав из UI было бы вторым, ничем
 * не проверяемым источником правды.
 */
export const SettingsPermissionsPage: React.FC = () => {
  const [query, setQuery] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { can } = useAuth()
  const queryClient = useQueryClient()
  const canManage = can('permissions', 'manage')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['permissions', 'matrix'],
    queryFn: permissionsApi.matrix,
  })

  const setRoles = useMutation({
    mutationFn: ({ rule, role }: { rule: PermissionMatrixRule; role: UserRole }) => {
      const current = (data?.roles ?? []).filter((r) => rule.roles[r]?.allowed)
      const next = rule.roles[role]?.allowed ? current.filter((r) => r !== role) : [...current, role]
      return permissionsApi.setRoles(rule.resource, rule.action, next)
    },
    onSuccess: () => {
      // Право меняет и меню, и роуты, и ответы API — перечитываем всё, включая
      // профиль: список прав пользователя приезжает вместе с ним.
      queryClient.invalidateQueries({ queryKey: ['permissions', 'matrix'] })
      toast({ title: 'Право изменено' })
    },
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({ title: detail || 'Не удалось изменить право', variant: 'destructive' })
    },
  })

  const roles = data?.roles ?? []
  const columnCount = roles.length + 2

  const visibleRules = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.rules ?? []).filter((rule) => {
      if (onlyReview && !rule.review) return false
      if (!needle) return true
      // Ищем и по названию, и по ключу: админ набирает «жалобы», разработчик —
      // «complaints», и обоим должно найтись.
      return (
        rule.resource.toLowerCase().includes(needle) ||
        resourceLabel(rule.resource).toLowerCase().includes(needle) ||
        groupTitleFor(rule.resource).toLowerCase().includes(needle) ||
        ACTION_LABELS[rule.action].toLowerCase().includes(needle)
      )
    })
  }, [data?.rules, query, onlyReview])

  /**
   * Правила, разложенные по разделам страницы.
   *
   * Плоский список из 87 строк не читается: соседние строки про деньги и про
   * Telegram ничем не связаны, а глазу не за что зацепиться. Порядок групп
   * задан в permissionLabels — от ежедневного к системному; внутри группы
   * сохраняется порядок реестра, чтобы правила одного раздела шли подряд.
   */
  const grouped = useMemo(() => {
    const order = [...RESOURCE_GROUPS.map((g) => g.title), OTHER_GROUP]
    const hints = new Map(RESOURCE_GROUPS.map((g) => [g.title, g.hint]))
    const buckets = new Map<string, PermissionMatrixRule[]>()
    for (const rule of visibleRules) {
      const title = groupTitleFor(rule.resource)
      const list = buckets.get(title)
      if (list) list.push(rule)
      else buckets.set(title, [rule])
    }
    return order
      .filter((title) => buckets.has(title))
      .map((title) => ({
        title,
        hint: hints.get(title) ?? '',
        rules: buckets.get(title) as PermissionMatrixRule[],
      }))
  }, [visibleRules])

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const summary = data?.summary

  return (
    <div>
      <PageHeader
        eyebrow="Управление"
        title="Права доступа"
        description="Что каждая роль может делать с каждым разделом. Нажатие на клетку меняет доступ сразу везде — в меню, в переходах по ссылкам и в самом API."
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          colorPrefix="p"
          icon={<Layers className="h-4 w-4" />}
          label="Разделов"
          value={String(summary?.resources ?? 0)}
        />
        <StatCard
          colorPrefix="p"
          icon={<KeyRound className="h-4 w-4" />}
          label="Правил"
          value={String(summary?.rules ?? 0)}
          onClick={() => { setOnlyReview(false); setQuery('') }}
        />
        <StatCard
          colorPrefix="p"
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Требуют решения"
          value={String(summary?.needs_review ?? 0)}
          valueClassName={summary?.needs_review ? 'text-amber-500' : undefined}
          sub={summary?.needs_review ? 'поведение расходится с ожиданием' : undefined}
          warn={!!summary?.needs_review}
          onClick={() => setOnlyReview(true)}
        />
        <StatCard
          colorPrefix="p"
          icon={<ListChecks className="h-4 w-4" />}
          label="Доп. условий"
          value={String(summary?.extra_rules ?? 0)}
          sub={summary ? `в ${summary.rules_with_extra} правилах` : undefined}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти раздел или действие"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm text-p-muted">
          <input
            type="checkbox"
            checked={onlyReview}
            onChange={(event) => setOnlyReview(event.target.checked)}
          />
          Только требующие решения
        </label>
      </div>

      <div className="border-y border-p-line">
        <Table>
          <TableHeader>
            <TableRow className="border-p-line hover:bg-transparent">
              <TableHead>Раздел</TableHead>
              <TableHead>Действие</TableHead>
              {roles.map((role) => (
                <TableHead key={role} className="text-center">{ROLE_LABELS[role]}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columnCount || 6} className="text-center py-8 text-p-muted">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={columnCount || 6} className="text-center py-8 text-p-muted">
                  Не удалось загрузить матрицу прав
                </TableCell>
              </TableRow>
            ) : visibleRules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="text-center py-8 text-p-muted">
                  Ничего не найдено
                </TableCell>
              </TableRow>
            ) : (
              grouped.flatMap((group) => [
                <TableRow key={`group-${group.title}`} className="border-p-line hover:bg-transparent">
                  <TableCell colSpan={columnCount} className="bg-p-bg py-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.14em] text-p-accent">
                      {group.title}
                    </span>
                    {group.hint && (
                      <span className="ml-2 text-xs text-p-muted">{group.hint}</span>
                    )}
                  </TableCell>
                </TableRow>,
                ...group.rules.map((rule) => {
                const key = ruleKey(rule)
                const isOpen = expanded.has(key)
                const notes = rule.extra_rules.length
                return (
                  <React.Fragment key={key}>
                    <TableRow
                      className="border-p-line hover:bg-p-bg cursor-pointer"
                      onClick={() => toggle(key)}
                    >
                      <TableCell className="font-medium text-p-text">
                        <div className="flex items-center gap-2">
                          {isOpen ? (
                            <ChevronDown className="h-3.5 w-3.5 text-p-muted2" aria-hidden />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-p-muted2" aria-hidden />
                          )}
                          {/* Крупно — название, мелко — ключ реестра. Ключ не
                              убираем: по нему разговаривают с разработчиком и
                              по нему же ищут в коде. */}
                          <span className="min-w-0">
                            <span className="block text-[14px] leading-tight text-p-text">
                              {resourceLabel(rule.resource)}
                            </span>
                            <span className="block font-mono text-[11px] leading-tight text-p-muted2">
                              {rule.resource}
                            </span>
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5 pl-5">
                          {rule.review && (
                            <span className="text-[11px] px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded-pill font-medium uppercase tracking-wide">
                              требует решения
                            </span>
                          )}
                          {notes > 0 && (
                            <span className="text-[11px] px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded-pill font-medium uppercase tracking-wide">
                              +{notes} доп. правил
                            </span>
                          )}
                          {rule.locked && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-p-bg text-p-muted border border-p-line rounded-pill font-medium uppercase tracking-wide"
                              title="Без этого права нельзя управлять системой — снять его нечем будет вернуть"
                            >
                              <Lock className="h-3 w-3" aria-hidden />
                              защищено
                            </span>
                          )}
                          {rule.is_overridden && (
                            <span className="text-[11px] px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-pill font-medium uppercase tracking-wide">
                              изменено вручную
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-p-muted">{ACTION_LABELS[rule.action]}</TableCell>
                      {roles.map((role) => (
                        <TableCell key={role} className="text-center align-top">
                          <RoleCell
                            rule={rule}
                            role={role}
                            editable={canManage && !rule.locked}
                            pending={setRoles.isPending}
                            onToggle={() => setRoles.mutate({ rule, role })}
                          />
                        </TableCell>
                      ))}
                    </TableRow>
                    {isOpen && <RuleDetails rule={rule} colSpan={columnCount} />}
                  </React.Fragment>
                )
                }),
              ])
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-4 text-xs text-p-muted">
        Под каждым названием — ключ реестра из <span className="font-mono">app/core/permissions.py</span>:
        название нужно, чтобы понять строку, ключ — чтобы найти её в коде и назвать разработчику.
        «Полный доступ» включает просмотр, создание, правку и удаление. Подпись под галочкой
        («свои студенты», «своя запись») означает, что роль видит не весь раздел, а только свою часть;
        без подписи — раздел целиком. Строки с пометкой «защищено» изменить нельзя: без них
        нельзя управлять системой, и вернуть снятое право было бы уже нечем.
        Каждая правка пишется в историю.
      </p>
    </div>
  )
}
