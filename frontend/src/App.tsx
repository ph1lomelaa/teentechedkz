import React from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import type { PermissionAction } from '@/api/permissions'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ImportJobsProvider } from '@/contexts/ImportJobsContext'
import { AppLayout } from '@/components/shared/Layout'
import { Toaster } from '@/components/ui/primitives/toaster'
import { getDefaultPath } from '@/lib/authRouting'

import { LandingPage } from '@/pages/LandingPage'
import { StudentLandingPage } from '@/pages/StudentLandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { JoinPage } from '@/pages/JoinPage'
import { StudentWelcomePage } from '@/pages/StudentWelcomePage'
import { InvitePage } from '@/pages/InvitePage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { PendingApprovalPage } from '@/pages/PendingApprovalPage'
import { AgreementSignPage } from '@/pages/AgreementSignPage'
import { StudentPortalLayout } from '@/components/portal/StudentPortalLayout'
import { WorkspaceLayout } from '@/layouts/WorkspaceLayout'
import { createQueryClient } from '@/lib/queryClient'

// Lazy-loaded pages (less critical path)
const DashboardPage = React.lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const StudentsListPage = React.lazy(() => import('@/pages/StudentsListPage').then((m) => ({ default: m.StudentsListPage })))
const StudentCardPage = React.lazy(() => import('@/pages/StudentCardPage').then((m) => ({ default: m.StudentCardPage })))
const NotesPage = React.lazy(() => import('@/pages/NotesPage').then((m) => ({ default: m.NotesPage })))
const NoteSessionPage = React.lazy(() => import('@/pages/NoteSessionPage').then((m) => ({ default: m.NoteSessionPage })))
const NoteDetailPage = React.lazy(() => import('@/pages/NoteDetailPage').then((m) => ({ default: m.NoteDetailPage })))
const PortalHomePage = React.lazy(() => import('@/pages/portal/PortalHomePage').then((m) => ({ default: m.PortalHomePage })))
const PortalRoadmapPage = React.lazy(() => import('@/pages/portal/PortalRoadmapPage').then((m) => ({ default: m.PortalRoadmapPage })))
const PortalTasksPage = React.lazy(() => import('@/pages/portal/PortalTasksPage').then((m) => ({ default: m.PortalTasksPage })))
const PortalMeetingsPage = React.lazy(() => import('@/pages/portal/PortalMeetingsPage').then((m) => ({ default: m.PortalMeetingsPage })))
const PortalNotesPage = React.lazy(() => import('@/pages/portal/PortalNotesPage').then((m) => ({ default: m.PortalNotesPage })))
const PortalComplaintsPage = React.lazy(() => import('@/pages/portal/PortalComplaintsPage').then((m) => ({ default: m.PortalComplaintsPage })))
const WorkspaceComplaintsPage = React.lazy(() => import('@/pages/workspace/WorkspaceComplaintsPage').then((m) => ({ default: m.WorkspaceComplaintsPage })))
const WorkspaceRefundCasesPage = React.lazy(() => import('@/pages/workspace/WorkspaceRefundCasesPage').then((m) => ({ default: m.WorkspaceRefundCasesPage })))
const WorkspaceSecurityIncidentsPage = React.lazy(() => import('@/pages/workspace/WorkspaceSecurityIncidentsPage').then((m) => ({ default: m.WorkspaceSecurityIncidentsPage })))
const WorkspaceMzkQualityPage = React.lazy(() => import('@/pages/workspace/WorkspaceMzkQualityPage').then((m) => ({ default: m.WorkspaceMzkQualityPage })))
const WorkspaceMentorRewardsPage = React.lazy(() => import('@/pages/workspace/WorkspaceMentorRewardsPage').then((m) => ({ default: m.WorkspaceMentorRewardsPage })))
const WorkspaceMyRewardsPage = React.lazy(() => import('@/pages/workspace/WorkspaceMyRewardsPage').then((m) => ({ default: m.WorkspaceMyRewardsPage })))
// CRM-версии тех же админ-разделов (общие компоненты, токены ds-*).
const AgreementsPage = React.lazy(() => import('@/pages/AgreementsPage').then((m) => ({ default: m.AgreementsPage })))
const MzkQualityPage = React.lazy(() => import('@/pages/MzkQualityPage').then((m) => ({ default: m.MzkQualityPage })))
const MentorRewardsPage = React.lazy(() => import('@/pages/MentorRewardsPage').then((m) => ({ default: m.MentorRewardsPage })))
const MentorTasksPage = React.lazy(() => import('@/pages/MentorTasksPage').then((m) => ({ default: m.MentorTasksPage })))
const CheckinsPage = React.lazy(() => import('@/pages/CheckinsPage').then((m) => ({ default: m.CheckinsPage })))
const PortalImportantNotesPage = React.lazy(() => import('@/pages/portal/PortalImportantNotesPage').then((m) => ({ default: m.PortalImportantNotesPage })))
const PortalUniversitiesPage = React.lazy(() => import('@/pages/portal/PortalUniversitiesPage').then((m) => ({ default: m.PortalUniversitiesPage })))
const PortalUniversityDetailPage = React.lazy(() => import('@/pages/portal/PortalUniversityDetailPage').then((m) => ({ default: m.PortalUniversityDetailPage })))
const PortalShortlistPage = React.lazy(() => import('@/pages/portal/PortalShortlistPage').then((m) => ({ default: m.PortalShortlistPage })))
const PortalApplicationsPage = React.lazy(() => import('@/pages/portal/PortalApplicationsPage').then((m) => ({ default: m.PortalApplicationsPage })))
const PortalCountriesPage = React.lazy(() => import('@/pages/portal/PortalCountriesPage').then((m) => ({ default: m.PortalCountriesPage })))
const PortalCountryDetailPage = React.lazy(() => import('@/pages/portal/PortalCountryDetailPage').then((m) => ({ default: m.PortalCountryDetailPage })))
const PortalChatPage = React.lazy(() => import('@/pages/portal/PortalChatPage').then((m) => ({ default: m.PortalChatPage })))
const PortalQuestionnairesPage = React.lazy(() => import('@/pages/portal/PortalQuestionnairesPage').then((m) => ({ default: m.PortalQuestionnairesPage })))
const PortalProfilePage = React.lazy(() => import('@/pages/portal/PortalProfilePage').then((m) => ({ default: m.PortalProfilePage })))
const PortalDocumentsPage = React.lazy(() => import('@/pages/portal/PortalDocumentsPage').then((m) => ({ default: m.PortalDocumentsPage })))
const PortalNotificationsPage = React.lazy(() => import('@/pages/portal/PortalNotificationsPage').then((m) => ({ default: m.PortalNotificationsPage })))
const WorkspaceDashboardPage = React.lazy(() => import('@/pages/workspace/WorkspaceDashboardPage').then((m) => ({ default: m.WorkspaceDashboardPage })))
const WorkspaceStudentsPage = React.lazy(() => import('@/pages/workspace/WorkspaceStudentsPage').then((m) => ({ default: m.WorkspaceStudentsPage })))
const WorkspaceStudentDetailPage = React.lazy(() => import('@/pages/workspace/WorkspaceStudentDetailPage').then((m) => ({ default: m.WorkspaceStudentDetailPage })))
const WorkspaceTasksPage = React.lazy(() => import('@/pages/workspace/WorkspaceTasksPage').then((m) => ({ default: m.WorkspaceTasksPage })))
const WorkspaceReviewPage = React.lazy(() => import('@/pages/workspace/WorkspaceReviewPage').then((m) => ({ default: m.WorkspaceReviewPage })))
const WorkspaceMentorTasksPage = React.lazy(() => import('@/pages/workspace/WorkspaceMentorTasksPage').then((m) => ({ default: m.WorkspaceMentorTasksPage })))
const WorkspaceMyTasksPage = React.lazy(() => import('@/pages/workspace/WorkspaceMyTasksPage').then((m) => ({ default: m.WorkspaceMyTasksPage })))
const WorkspaceCheckinsPage = React.lazy(() => import('@/pages/workspace/WorkspaceCheckinsPage').then((m) => ({ default: m.WorkspaceCheckinsPage })))
const WorkspaceMeetingsPage = React.lazy(() => import('@/pages/workspace/WorkspaceMeetingsPage').then((m) => ({ default: m.WorkspaceMeetingsPage })))
const WorkspaceDocumentsPage = React.lazy(() => import('@/pages/workspace/WorkspaceDocumentsPage').then((m) => ({ default: m.WorkspaceDocumentsPage })))
const WorkspaceChatPage = React.lazy(() => import('@/pages/workspace/WorkspaceChatPage').then((m) => ({ default: m.WorkspaceChatPage })))
const WorkspaceRoadmapPage = React.lazy(() => import('@/pages/workspace/WorkspaceRoadmapPage').then((m) => ({ default: m.WorkspaceRoadmapPage })))
const WorkspaceUniversitiesPage = React.lazy(() => import('@/pages/workspace/WorkspaceUniversitiesPage').then((m) => ({ default: m.WorkspaceUniversitiesPage })))
const WorkspaceUniversityDetailPage = React.lazy(() => import('@/pages/workspace/WorkspaceUniversityDetailPage').then((m) => ({ default: m.WorkspaceUniversityDetailPage })))
const WorkspaceCountriesPage = React.lazy(() => import('@/pages/workspace/WorkspaceCountriesPage').then((m) => ({ default: m.WorkspaceCountriesPage })))
const WorkspaceCountryDetailPage = React.lazy(() => import('@/pages/workspace/WorkspaceCountryDetailPage').then((m) => ({ default: m.WorkspaceCountryDetailPage })))
const WorkspaceAgreementsPage = React.lazy(() => import('@/pages/workspace/WorkspaceAgreementsPage').then((m) => ({ default: m.WorkspaceAgreementsPage })))
const WorkspaceMyDayPage = React.lazy(() => import('@/pages/workspace/WorkspaceMyDayPage').then((m) => ({ default: m.WorkspaceMyDayPage })))
const WorkspaceQuestionnairesPage = React.lazy(() => import('@/pages/workspace/WorkspaceQuestionnairesPage').then((m) => ({ default: m.WorkspaceQuestionnairesPage })))
const WorkspaceNotificationsPage = React.lazy(() => import('@/pages/workspace/WorkspaceNotificationsPage').then((m) => ({ default: m.WorkspaceNotificationsPage })))
const NewStudentPage = React.lazy(() =>
  import('@/pages/NewStudentPage').then((m) => ({ default: m.NewStudentPage }))
)
const MyStudentsPage = React.lazy(() =>
  import('@/pages/MyStudentsPage').then((m) => ({ default: m.MyStudentsPage }))
)
const CountryDetailPage = React.lazy(() =>
  import('@/pages/CountryDetailPage').then((m) => ({ default: m.CountryDetailPage }))
)
const CountriesPage = React.lazy(() =>
  import('@/pages/CountriesPage').then((m) => ({ default: m.CountriesPage }))
)
const FinancesPage = React.lazy(() =>
  import('@/pages/FinancesPage').then((m) => ({ default: m.FinancesPage }))
)
const SettingsUsersPage = React.lazy(() =>
  import('@/pages/SettingsUsersPage').then((m) => ({ default: m.SettingsUsersPage }))
)
const SettingsAccessRequestsPage = React.lazy(() =>
  import('@/pages/SettingsAccessRequestsPage').then((m) => ({ default: m.SettingsAccessRequestsPage }))
)
const SettingsPermissionsPage = React.lazy(() =>
  import('@/pages/SettingsPermissionsPage').then((m) => ({ default: m.SettingsPermissionsPage }))
)
const StatisticsPage = React.lazy(() =>
  import('@/pages/StatisticsPage').then((m) => ({ default: m.StatisticsPage }))
)
const TemplatesPage = React.lazy(() =>
  import('@/pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage }))
)
const KnowledgeBasePage = React.lazy(() =>
  import('@/pages/KnowledgeBasePage').then((m) => ({ default: m.KnowledgeBasePage }))
)
const UniversityDetailPage = React.lazy(() =>
  import('@/pages/UniversityDetailPage').then((m) => ({ default: m.UniversityDetailPage }))
)
const UniversitiesPage = React.lazy(() =>
  import('@/pages/UniversitiesPage').then((m) => ({ default: m.UniversitiesPage }))
)
const AtRiskStudentsPage = React.lazy(() =>
  import('@/pages/AtRiskStudentsPage').then((m) => ({ default: m.AtRiskStudentsPage }))
)
const TelegramInboxPage = React.lazy(() => import('@/pages/TelegramInboxPage'))
const TelegramChatDetailPage = React.lazy(() => import('@/pages/TelegramChatDetailPage'))
const StatusInboxPage = React.lazy(() => import('@/pages/StatusInboxPage'))

const queryClient = createQueryClient()

/**
 * Ошибка «версия приложения устарела», а не поломка кода.
 *
 * Страницы грузятся чанками, имена которых содержат хеш сборки. После деплоя
 * старые файлы исчезают, и вкладка, открытая до выката, при переходе в раздел
 * просит несуществующий чанк. Формулировка у браузеров разная — Safari говорит
 * «'text/html' is not a valid JavaScript MIME type» (nginx отдавал index.html
 * вместо js), Chrome — «Failed to fetch dynamically imported module».
 *
 * Показывать такому человеку «Экран не открылся» бессмысленно: чинить нечего,
 * нужна перезагрузка.
 */
export function isStaleBuildError(error: Error): boolean {
  const text = `${error.name} ${error.message}`
  return (
    /dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text) ||
    /valid JavaScript MIME type/i.test(text) ||
    /ChunkLoadError/i.test(text)
  )
}

/**
 * Firefox иногда сворачивает ошибку рассинхронизированного DOM в короткое
 * `NotFoundError: The object can not be found here.`. Она возникает, в
 * частности, в давно открытой вкладке при переходе между экранами. Для
 * человека это тот же восстанавливаемый случай, что и старый JS-чанк: первая
 * жёсткая перезагрузка возвращает приложение в согласованное состояние.
 *
 * Не считаем все NotFoundError восстанавливаемыми: например, ошибка доступа к
 * микрофону должна остаться видимой на экране записи.
 */
export function isRecoverableBrowserStateError(error: Error): boolean {
  const text = `${error.name} ${error.message}`
  if (!/NotFoundError/i.test(text)) return false

  return (
    /object can(?:\s*not|'t) be found here/i.test(text) ||
    /failed to execute '(?:removeChild|insertBefore|replaceChild)' on 'Node'/i.test(text) ||
    /node to be (?:removed|inserted|replaced) is not a child of this node/i.test(text)
  )
}

/** Ошибки, от которых безопасно восстанавливаться полной перезагрузкой. */
export function isRecoverableAppError(error: Error): boolean {
  return isStaleBuildError(error) || isRecoverableBrowserStateError(error)
}

/** Ключ одноразовой попытки: страховка от петли перезагрузок, если новая
 * сборка или DOM действительно не могут восстановиться. */
const RELOAD_GUARD = 'tte:runtime-recovery-reloaded'
const HEALTHY_APP_DELAY_MS = 10_000

/**
 * Возвращает `true`, когда перезагрузка уже начата или намеренно подавлена.
 * Одна функция используется и React boundary, и глобальными обработчиками:
 * иначе ошибки из Promise проходили мимо boundary и оставляли вкладку в
 * сломанном состоянии.
 */
export function recoverPageOnce(): boolean {
  try {
    const alreadyTried = sessionStorage.getItem(RELOAD_GUARD) === '1'
    sessionStorage.setItem(RELOAD_GUARD, '1')
    if (!alreadyTried) window.location.reload()
    return true
  } catch {
    // Приватный режим — хранилище недоступно. Тогда лучше не перезагружать
    // вовсе, чем уйти в бесконечный цикл.
    return false
  }
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidMount() {
    // Не снимаем флаг сразу: boundary монтируется до lazy-страницы, и при
    // ошибке её загрузки это превратило бы защиту в бесконечную перезагрузку.
    // Десять секунд стабильной работы достаточно, чтобы признать вкладку
    // здоровой и разрешить восстановление после следующего деплоя.
    window.setTimeout(() => {
      if (this.state.error) return
      try {
        sessionStorage.removeItem(RELOAD_GUARD)
      } catch {
        // Хранилище недоступно — не страшно, страховки тогда и не было.
      }
    }, HEALTHY_APP_DELAY_MS)
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('App runtime error', error)
    // Обычный ErrorBoundary изолирует ошибку от глобального обработчика, поэтому
    // без явного capture в Sentry не попадали ни стек компонента, ни маршрут.
    // При пустом VITE_SENTRY_DSN SDK остаётся no-op.
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack } },
      tags: { error_source: 'app_error_boundary' },
    })

    if (isRecoverableAppError(error)) recoverPageOnce()
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-white">
        <div className="mx-auto max-w-xl rounded-card border border-white/10 bg-[#141414] p-6 shadow-2xl">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">
            TeenTechEd
          </div>
          <h1 className="mt-3 font-display text-2xl font-black">
            {isRecoverableAppError(this.state.error)
              ? 'Восстанавливаем страницу'
              : 'Экран не открылся'}
          </h1>
          <p className="mt-2 text-sm leading-6 text-white/65">
            {isRecoverableAppError(this.state.error)
              ? 'Вкладка потеряла актуальное состояние. Портал попробует обновиться один раз автоматически; данные на сервере не потеряются.'
              : 'Страница упала в runtime. Теперь вместо белого экрана показываем ошибку, чтобы её можно было быстро исправить.'}
          </p>
          <pre className="mt-4 max-h-52 overflow-auto rounded-panel border border-white/10 bg-black/40 p-3 text-xs text-white/70">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-ctl bg-[#FFD400] px-4 py-2 text-xs font-black text-black"
            >
              Обновить страницу
            </button>
            <a
              href="/workspace"
              className="rounded-ctl border border-white/15 px-4 py-2 text-xs font-bold text-white/75 hover:text-white"
            >
              В кабинет
            </a>
          </div>
        </div>
      </div>
    )
  }
}

// Shared by every gated route below: loading state, no session, and the
// forced first-run password change all redirect the same way regardless of
// which route triggered the check. Returns null once the caller is clear to
// apply its own (route-specific) role check.
function useBaseAuthGuard(): React.ReactElement | null {
  const { user, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  // Первым из трёх: пока аккаунт не открыт администратором, ни временный
  // пароль, ни подпись регламента не имеют смысла. Тот же порядок на бэкенде
  // (core/deps.py) — гейты обязаны совпадать, иначе экран и API разойдутся.
  if (user.is_active === false) return <Navigate to="/pending" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  // Куда человек шёл до гейта — туда и вернём после подписи: ментор работает в
  // воркспейсе, и дефолтный путь роли увёл бы его в CRM.
  if (user.agreement_signature_required) {
    return <Navigate to="/agreements/sign" replace state={{ from: location.pathname + location.search }} />
  }
  return null
}

function RootRedirect() {
  const guard = useBaseAuthGuard()
  const { user } = useAuth()
  if (guard) return guard
  return <Navigate to={getDefaultPath(user!.role)} replace />
}

function HomeRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <LandingPage />
  return <RootRedirect />
}

/**
 * Право из реестра — тот же ключ, что стоит на пункте меню (Этап 2.5).
 *
 * До этого меню и роут знали о доступе по-разному: пункт прятали, а прямая
 * ссылка продолжала работать. `/workspace/security-incidents` был именно таким —
 * скрыт от ментора в навигации и открыт по URL.
 */
type RoutePermission = [resource: string, action: PermissionAction]

/**
 * Роут CRM-оболочки.
 *
 * `permission` — основная форма: тот же ключ реестра, что и у пункта меню, и
 * что спрашивает эндпоинт. Один переключатель в конструкторе прав убирает
 * пункт, закрывает прямую ссылку и отдаёт 403 — все три сразу.
 *
 * `roles` остался ровно у одного роута — `/statistics`. Своего ресурса у него
 * нет: страница собрана на ручках воркспейса, и правило `statistics` в реестре
 * было бы строкой, которую ни один эндпоинт не спрашивает (это ловит
 * `test_no_resource_is_dead`). Появится своя ручка — появится и право.
 *
 * /mentor-tasks, /mzk-quality и /mentor-rewards сведены к ключу меню
 * 30.08.2026 по решению владельца. Ментор эти пункты в меню и так видел, а по
 * ссылке получал редирект; теперь пускает. Страницы сами ветвятся по
 * `can(…, 'manage')`, поэтому ментор получает их в режиме чтения — как и
 * задумано правилами `mzk_quality:view` / `mentor_rewards:view`.
 */
function ProtectedRoute({
  children,
  roles,
  permission,
}: {
  children: React.ReactNode
  roles?: string[]
  permission?: RoutePermission
}) {
  const guard = useBaseAuthGuard()
  const { user, can } = useAuth()
  if (guard) return guard
  // Students live in the portal, never the CRM back-office.
  if (user!.role === 'student') return <Navigate to="/portal" replace />
  if (roles && !roles.includes(user!.role)) return <Navigate to="/app" replace />
  if (permission && !can(permission[0], permission[1])) return <Navigate to="/app" replace />
  return <>{children}</>
}

// Portal routes: student-only, wrapped in the yellow-accented cabinet layout.
function StudentRoute({ children }: { children: React.ReactNode }) {
  const guard = useBaseAuthGuard()
  const { user } = useAuth()
  if (guard) return guard
  if (user!.role !== 'student') return <Navigate to="/app" replace />
  return <StudentPortalLayout>{children}</StudentPortalLayout>
}

function WorkspaceRoute({
  children,
  permission,
}: {
  children: React.ReactNode
  permission?: RoutePermission
}) {
  const guard = useBaseAuthGuard()
  const { user, can } = useAuth()
  if (guard) return guard
  if (!['admin', 'mzk_manager', 'mentor'].includes(user!.role)) return <Navigate to="/app" replace />
  // Роль пускает в оболочку, право — в конкретный раздел. Без второй проверки
  // спрятанный из меню пункт остаётся доступен по прямой ссылке.
  if (permission && !can(permission[0], permission[1])) return <Navigate to="/workspace" replace />
  return <WorkspaceLayout>{children}</WorkspaceLayout>
}

// Тупиковый экран ожидания: сюда уводит гейт, и отсюда нет пути вглубь.
// Через ProtectedRoute идти не может — тот сам отправит обратно сюда.
function PendingApprovalRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  // Доступ уже открыли, пока человек сидел на этой вкладке — уводим в систему.
  if (user.is_active !== false) return <Navigate to="/" replace />
  return <PendingApprovalPage />
}

// Standalone (no layout): reachable by any authenticated user; the forced
// first-run redirect points here, so it must not go through ProtectedRoute.
function ChangePasswordRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <ChangePasswordPage />
}

// Same idea: reachable by any authenticated user whose password is already
// set (must_change_password gate runs first), so an unsigned agreement can
// never trap someone before they even have a real password.
function AgreementSignRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  return <AgreementSignPage />
}

function AppRoutes() {
  return (
    <React.Suspense fallback={<AppLoadingScreen />}>
      <Routes>
      <Route path="/" element={<HomeRoute />} />
      {/* Публичный лендинг для учеников — постоянная ссылка без токена */}
      {['/student', '/for-students'].map((path) => (
        <Route key={path} path={path} element={<StudentLandingPage />} />
      ))}
      <Route path="/login" element={<LoginPage />} />
      {/* Регистрация ровно одна — /join. Прежние адреса ведут на неё, а не
          отдают 404: ссылки на /apply и /register уже разошлись по перепискам
          и лендингам, и ломать их незачем.

          Что здесь было и почему убрано: /for-applicants показывала форму
          лида, которая аккаунта НЕ создаёт, — человек её отправлял, входить
          было некуда, и его возвращало на лендинг. За всё время через неё не
          пришло ни одной заявки. /join/mentor заводила ментора по паролю —
          третий способ создать аккаунт, мимо Google и без нормализации
          телефона. Ментора без Google теперь приглашает админ ссылкой
          (Настройки → Пользователи → Пригласить). */}
      <Route path="/apply" element={<Navigate to="/join" replace />} />
      <Route path="/register" element={<Navigate to="/join" replace />} />
      <Route path="/for-applicants" element={<Navigate to="/join" replace />} />
      <Route path="/join/mentor" element={<Navigate to="/join" replace />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/welcome/:token" element={<StudentWelcomePage />} />
      <Route path="/app" element={<RootRedirect />} />

      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <AppLayout>
              <DashboardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/students"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StudentsListPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/students/new"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <NewStudentPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/students/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <StudentCardPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/notes"
        element={
          <ProtectedRoute>
            <AppLayout>
              <NotesPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/notes/session/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <NoteSessionPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/notes/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <NoteDetailPage />
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/my-students"
        element={
          <ProtectedRoute permission={['students', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <MyStudentsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/countries"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <CountriesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/countries/:id"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <CountryDetailPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/finances"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <FinancesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Роль, а не право: правила `statistics` в реестре нет. */}
      <Route
        path="/statistics"
        element={
          <ProtectedRoute roles={['admin']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <StatisticsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings/users"
        element={
          <ProtectedRoute permission={['users', 'manage']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <SettingsUsersPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Раздел «Кто за что отвечает» скрыт по решению владельца (02.09.2026):
          пока не нужен. Скрыт, а не удалён — страница
          `pages/SettingsResponsibilitiesPage.tsx` и её API на месте, вернуть
          раздел значит восстановить этот роут и пункт меню в Layout.tsx.

          Секция «Кто за что отвечает» внутри карточки ученика
          (`StudentResponsibilitiesSection`) — другое и продолжает работать.

          Старый адрес уводим на обзор, а не оставляем в пустоту: он мог осесть
          в закладках и переписках. */}
      <Route path="/settings/responsibilities" element={<Navigate to="/dashboard" replace />} />

      {/* Очередь самозаписи: смотрят админ и МЗК, решают только админы —
          мутирующие ручки проверяют access_requests:manage отдельно. */}
      <Route
        path="/settings/access-requests"
        element={
          <ProtectedRoute permission={['access_requests', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <SettingsAccessRequestsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Матрица прав: реестр отдаётся только админу, поэтому и роут админский. */}
      <Route
        path="/settings/permissions"
        element={
          <ProtectedRoute permission={['permissions', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <SettingsPermissionsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* /migration-conflicts — старый адрес этой же страницы, оставлен для закладок */}
      {['/at-risk', '/migration-conflicts'].map((path) => (
        <Route
          key={path}
          path={path}
          element={
            <ProtectedRoute>
              <AppLayout>
                <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                  <AtRiskStudentsPage />
                </React.Suspense>
              </AppLayout>
            </ProtectedRoute>
          }
        />
      ))}

      <Route
        path="/telegram-inbox"
        element={
          <ProtectedRoute permission={['telegram_chats', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <TelegramInboxPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/telegram-inbox/:chatId"
        element={
          <ProtectedRoute permission={['telegram_chats', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <TelegramChatDetailPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/status-inbox"
        element={
          <ProtectedRoute permission={['status_history', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <StatusInboxPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/roadmap-templates"
        element={
          <ProtectedRoute permission={['roadmap_templates', 'manage']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <TemplatesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/knowledge-base"
        element={
          <ProtectedRoute permission={['knowledge', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <KnowledgeBasePage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/universities"
        element={
          <ProtectedRoute permission={['universities', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <UniversitiesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/universities/:id"
        element={
          <ProtectedRoute permission={['universities', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <UniversityDetailPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* CRM is the superset shell: the same complaints/refunds pages the
          workspace renders, mounted here for admins working in the CRM. */}
      <Route
        path="/complaints"
        element={
          <ProtectedRoute permission={['complaints', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <WorkspaceComplaintsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      {/* Narrower than complaints: every refund-case endpoint is admin/mzk
          only, so a mentor here would 403 on the first fetch. */}
      <Route
        path="/refund-cases"
        element={
          <ProtectedRoute permission={['refund_cases', 'manage']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <WorkspaceRefundCasesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      {/* Регламенты создаёт и публикует только админ (все write-эндпоинты AdminOnly). */}
      <Route
        path="/agreements"
        element={
          <ProtectedRoute permission={['agreements', 'manage']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <AgreementsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/mentor-tasks"
        element={
          <ProtectedRoute permission={['tasks', 'manage']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <MentorTasksPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/checkins"
        element={
          <ProtectedRoute permission={['checkins', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <CheckinsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      {/* «Мои задачи» существовали по двум адресам одной и той же страницей:
          обёртки в семь строк вокруг общего MyTasksList, вся разница — цвет.
          Личная работа по границе самих оболочек принадлежит кабинету («что мне
          сегодня делать»), туда же ведёт уведомление о санкции SLA. Командный
          разрез остался в CRM отдельным разделом «Задачи менторов». */}
      <Route path="/my-tasks" element={<Navigate to="/workspace/my-tasks" replace />} />
      <Route
        path="/mzk-quality"
        element={
          <ProtectedRoute permission={['mzk_quality', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <MzkQualityPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/mentor-rewards"
        element={
          <ProtectedRoute permission={['mentor_rewards', 'view']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <MentorRewardsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Forced/optional password change (no layout) */}
      <Route path="/pending" element={<PendingApprovalRoute />} />
      <Route path="/change-password" element={<ChangePasswordRoute />} />
      <Route path="/agreements/sign" element={<AgreementSignRoute />} />

      {/* Student portal (cabinet) */}
      <Route path="/portal" element={<StudentRoute><PortalHomePage /></StudentRoute>} />
      <Route path="/portal/roadmap" element={<StudentRoute><PortalRoadmapPage /></StudentRoute>} />
      <Route path="/portal/tasks" element={<StudentRoute><PortalTasksPage /></StudentRoute>} />
      <Route path="/portal/meetings" element={<StudentRoute><PortalMeetingsPage /></StudentRoute>} />
      <Route path="/portal/notes" element={<StudentRoute><PortalNotesPage /></StudentRoute>} />
      <Route path="/portal/complaints" element={<StudentRoute><PortalComplaintsPage /></StudentRoute>} />
      <Route path="/portal/questionnaires" element={<StudentRoute><PortalQuestionnairesPage /></StudentRoute>} />
      <Route path="/portal/important-notes" element={<StudentRoute><PortalImportantNotesPage /></StudentRoute>} />
      <Route path="/portal/documents" element={<StudentRoute><PortalDocumentsPage /></StudentRoute>} />
      <Route path="/portal/notifications" element={<StudentRoute><PortalNotificationsPage /></StudentRoute>} />
      <Route path="/portal/chat" element={<StudentRoute><PortalChatPage /></StudentRoute>} />
      <Route path="/portal/universities" element={<StudentRoute><PortalUniversitiesPage /></StudentRoute>} />
      <Route path="/portal/universities/:id" element={<StudentRoute><PortalUniversityDetailPage /></StudentRoute>} />
      <Route path="/portal/shortlist" element={<StudentRoute><PortalShortlistPage /></StudentRoute>} />
      <Route path="/portal/applications" element={<StudentRoute><PortalApplicationsPage /></StudentRoute>} />
      <Route path="/portal/countries" element={<StudentRoute><PortalCountriesPage /></StudentRoute>} />
      <Route path="/portal/countries/:id" element={<StudentRoute><PortalCountryDetailPage /></StudentRoute>} />
      <Route path="/portal/profile" element={<StudentRoute><PortalProfilePage /></StudentRoute>} />

      {/* Staff/mentor workspace — donor-style mentor cabinet backed by CRM data */}
      <Route path="/workspace" element={<WorkspaceRoute><WorkspaceDashboardPage /></WorkspaceRoute>} />
      <Route path="/workspace/students" element={<WorkspaceRoute><WorkspaceStudentsPage /></WorkspaceRoute>} />
      <Route path="/workspace/students/:studentId" element={<WorkspaceRoute><WorkspaceStudentDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/roadmap" element={<WorkspaceRoute><WorkspaceRoadmapPage /></WorkspaceRoute>} />
      <Route path="/workspace/tasks" element={<WorkspaceRoute><WorkspaceTasksPage /></WorkspaceRoute>} />
      <Route path="/workspace/review" element={<WorkspaceRoute><WorkspaceReviewPage /></WorkspaceRoute>} />
      <Route path="/workspace/mentor-tasks" element={<WorkspaceRoute><WorkspaceMentorTasksPage /></WorkspaceRoute>} />
      <Route path="/workspace/my-tasks" element={<WorkspaceRoute><WorkspaceMyTasksPage /></WorkspaceRoute>} />
      <Route path="/workspace/checkins" element={<WorkspaceRoute permission={['checkins', 'view']}><WorkspaceCheckinsPage /></WorkspaceRoute>} />
      <Route path="/workspace/questionnaires" element={<WorkspaceRoute><WorkspaceQuestionnairesPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings" element={<WorkspaceRoute><WorkspaceMeetingsPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings/session/:id" element={<WorkspaceRoute><NoteSessionPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings/notes/:id" element={<WorkspaceRoute><NoteDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/documents" element={<WorkspaceRoute><WorkspaceDocumentsPage /></WorkspaceRoute>} />
      <Route path="/workspace/telegram" element={<Navigate to="/workspace/chat?channel=telegram" replace />} />
      <Route path="/workspace/notes" element={<Navigate to="/workspace/meetings?tab=notes" replace />} />
      <Route path="/workspace/chat" element={<WorkspaceRoute><WorkspaceChatPage /></WorkspaceRoute>} />
      <Route path="/workspace/universities" element={<WorkspaceRoute><WorkspaceUniversitiesPage /></WorkspaceRoute>} />
      <Route path="/workspace/universities/:id" element={<WorkspaceRoute><WorkspaceUniversityDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/countries" element={<WorkspaceRoute><WorkspaceCountriesPage /></WorkspaceRoute>} />
      <Route path="/workspace/countries/:id" element={<WorkspaceRoute><WorkspaceCountryDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/agreements" element={<WorkspaceRoute><WorkspaceAgreementsPage /></WorkspaceRoute>} />
      <Route path="/workspace/complaints" element={<WorkspaceRoute><WorkspaceComplaintsPage /></WorkspaceRoute>} />
      <Route path="/workspace/refund-cases" element={<WorkspaceRoute permission={['refund_cases', 'manage']}><WorkspaceRefundCasesPage /></WorkspaceRoute>} />
      <Route path="/workspace/security-incidents" element={<WorkspaceRoute permission={['security_incidents', 'manage']}><WorkspaceSecurityIncidentsPage /></WorkspaceRoute>} />
      <Route path="/workspace/mzk-quality" element={<WorkspaceRoute><WorkspaceMzkQualityPage /></WorkspaceRoute>} />
      <Route path="/workspace/mentor-rewards" element={<WorkspaceRoute><WorkspaceMentorRewardsPage /></WorkspaceRoute>} />
      <Route path="/workspace/my-rewards" element={<WorkspaceRoute><WorkspaceMyRewardsPage /></WorkspaceRoute>} />
      <Route path="/workspace/my-day" element={<WorkspaceRoute><WorkspaceMyDayPage /></WorkspaceRoute>} />
      <Route path="/workspace/notifications" element={<WorkspaceRoute><WorkspaceNotificationsPage /></WorkspaceRoute>} />
      <Route
        path="/workspace/status"
        element={
          <WorkspaceRoute>
            <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
              <StatusInboxPage />
            </React.Suspense>
          </WorkspaceRoute>
        }
      />

      <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </React.Suspense>
  )
}

function AppLoadingScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0A0A0A] text-[#A3A39D]">
      <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.18em]">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#FFD400]" />
        TeenTechEd
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <ImportJobsProvider>
              <AppErrorBoundary>
                <AppRoutes />
                <Toaster />
              </AppErrorBoundary>
            </ImportJobsProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
