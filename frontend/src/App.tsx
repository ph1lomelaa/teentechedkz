import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { AppLayout } from '@/components/shared/Layout'
import { Toaster } from '@/components/ui/toaster'

import { LandingPage } from '@/pages/LandingPage'
import { LoginPage } from '@/pages/LoginPage'
import { ApplyPage } from '@/pages/ApplyPage'
import { JoinMentorPage } from '@/pages/JoinMentorPage'
import { StudentWelcomePage } from '@/pages/StudentWelcomePage'
import { InvitePage } from '@/pages/InvitePage'
import { ChangePasswordPage } from '@/pages/ChangePasswordPage'
import { StudentPortalLayout } from '@/components/portal/StudentPortalLayout'
import { WorkspaceLayout } from '@/layouts/WorkspaceLayout'

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
const PortalImportantNotesPage = React.lazy(() => import('@/pages/portal/PortalImportantNotesPage').then((m) => ({ default: m.PortalImportantNotesPage })))
const PortalUniversitiesPage = React.lazy(() => import('@/pages/portal/PortalUniversitiesPage').then((m) => ({ default: m.PortalUniversitiesPage })))
const PortalCountriesPage = React.lazy(() => import('@/pages/portal/PortalCountriesPage').then((m) => ({ default: m.PortalCountriesPage })))
const PortalChatPage = React.lazy(() => import('@/pages/portal/PortalChatPage').then((m) => ({ default: m.PortalChatPage })))
const PortalQuestionnairesPage = React.lazy(() => import('@/pages/portal/PortalQuestionnairesPage').then((m) => ({ default: m.PortalQuestionnairesPage })))
const PortalProfilePage = React.lazy(() => import('@/pages/portal/PortalProfilePage').then((m) => ({ default: m.PortalProfilePage })))
const PortalDocumentsPage = React.lazy(() => import('@/pages/portal/PortalDocumentsPage').then((m) => ({ default: m.PortalDocumentsPage })))
const PortalNotificationsPage = React.lazy(() => import('@/pages/portal/PortalNotificationsPage').then((m) => ({ default: m.PortalNotificationsPage })))
const WorkspaceDashboardPage = React.lazy(() => import('@/pages/workspace/WorkspaceDashboardPage').then((m) => ({ default: m.WorkspaceDashboardPage })))
const WorkspaceStudentsPage = React.lazy(() => import('@/pages/workspace/WorkspaceStudentsPage').then((m) => ({ default: m.WorkspaceStudentsPage })))
const WorkspaceStudentDetailPage = React.lazy(() => import('@/pages/workspace/WorkspaceStudentDetailPage').then((m) => ({ default: m.WorkspaceStudentDetailPage })))
const WorkspaceTasksPage = React.lazy(() => import('@/pages/workspace/WorkspaceTasksPage').then((m) => ({ default: m.WorkspaceTasksPage })))
const WorkspaceMeetingsPage = React.lazy(() => import('@/pages/workspace/WorkspaceMeetingsPage').then((m) => ({ default: m.WorkspaceMeetingsPage })))
const WorkspaceDocumentsPage = React.lazy(() => import('@/pages/workspace/WorkspaceDocumentsPage').then((m) => ({ default: m.WorkspaceDocumentsPage })))
const WorkspaceChatPage = React.lazy(() => import('@/pages/workspace/WorkspaceChatPage').then((m) => ({ default: m.WorkspaceChatPage })))
const WorkspaceRoadmapPage = React.lazy(() => import('@/pages/workspace/WorkspaceRoadmapPage').then((m) => ({ default: m.WorkspaceRoadmapPage })))
const WorkspaceUniversitiesPage = React.lazy(() => import('@/pages/workspace/WorkspaceUniversitiesPage').then((m) => ({ default: m.WorkspaceUniversitiesPage })))
const WorkspaceCountriesPage = React.lazy(() => import('@/pages/workspace/WorkspaceCountriesPage').then((m) => ({ default: m.WorkspaceCountriesPage })))
const WorkspaceQuestionnairesPage = React.lazy(() => import('@/pages/workspace/WorkspaceQuestionnairesPage').then((m) => ({ default: m.WorkspaceQuestionnairesPage })))
const WorkspaceProfilePage = React.lazy(() => import('@/pages/workspace/WorkspaceProfilePage').then((m) => ({ default: m.WorkspaceProfilePage })))
const WorkspaceNotificationsPage = React.lazy(() => import('@/pages/workspace/WorkspaceNotificationsPage').then((m) => ({ default: m.WorkspaceNotificationsPage })))
const NewStudentPage = React.lazy(() =>
  import('@/pages/NewStudentPage').then((m) => ({ default: m.NewStudentPage }))
)
const MyStudentsPage = React.lazy(() =>
  import('@/pages/MyStudentsPage').then((m) => ({ default: m.MyStudentsPage }))
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
const TemplatesPage = React.lazy(() =>
  import('@/pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage }))
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
})

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('App runtime error', error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-screen bg-[#0A0A0A] px-6 py-10 text-white">
        <div className="mx-auto max-w-xl rounded-[22px] border border-white/10 bg-[#141414] p-6 shadow-2xl">
          <div className="text-[11px] font-black uppercase tracking-[0.24em] text-[#FFD400]">
            TeenTechEd
          </div>
          <h1 className="mt-3 font-display text-2xl font-black">Экран не открылся</h1>
          <p className="mt-2 text-sm leading-6 text-white/65">
            Страница упала в runtime. Теперь вместо белого экрана показываем ошибку, чтобы её можно было быстро исправить.
          </p>
          <pre className="mt-4 max-h-52 overflow-auto rounded-[14px] border border-white/10 bg-black/40 p-3 text-xs text-white/70">
            {this.state.error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-[12px] bg-[#FFD400] px-4 py-2 text-xs font-black text-black"
            >
              Обновить страницу
            </button>
            <a
              href="/workspace"
              className="rounded-[12px] border border-white/15 px-4 py-2 text-xs font-bold text-white/75 hover:text-white"
            >
              В кабинет
            </a>
          </div>
        </div>
      </div>
    )
  }
}

function RootRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  if (user.role === 'student') return <Navigate to="/portal" replace />
  if (user.role === 'admin' || user.role === 'mzk_manager') return <Navigate to="/dashboard" replace />
  return <Navigate to="/my-students" replace />
}

function HomeRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <LandingPage />
  return <RootRedirect />
}

function ProtectedRoute({
  children,
  roles,
}: {
  children: React.ReactNode
  roles?: string[]
}) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  // Students live in the portal, never the CRM back-office.
  if (user.role === 'student') return <Navigate to="/portal" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />
  return <>{children}</>
}

// Portal routes: student-only, wrapped in the yellow-accented cabinet layout.
function StudentRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  if (user.role !== 'student') return <Navigate to="/app" replace />
  return <StudentPortalLayout>{children}</StudentPortalLayout>
}

function WorkspaceRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (user.must_change_password) return <Navigate to="/change-password" replace />
  if (!['admin', 'mzk_manager', 'mentor'].includes(user.role)) return <Navigate to="/app" replace />
  return <WorkspaceLayout>{children}</WorkspaceLayout>
}

// Standalone (no layout): reachable by any authenticated user; the forced
// first-run redirect points here, so it must not go through ProtectedRoute.
function ChangePasswordRoute() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <AppLoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  return <ChangePasswordPage />
}

function AppRoutes() {
  return (
    <React.Suspense fallback={<AppLoadingScreen />}>
      <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/apply" element={<ApplyPage />} />
      <Route path="/register" element={<ApplyPage />} />
      <Route path="/join" element={<JoinMentorPage />} />
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
          <ProtectedRoute roles={['admin', 'mzk_manager', 'mentor']}>
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

      <Route
        path="/settings/users"
        element={
          <ProtectedRoute roles={['admin', 'mzk_manager']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <SettingsUsersPage />
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
          <ProtectedRoute roles={['admin', 'mzk_manager', 'mentor']}>
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
          <ProtectedRoute roles={['admin', 'mzk_manager', 'mentor']}>
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
          <ProtectedRoute roles={['admin', 'mzk_manager', 'mentor']}>
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
          <ProtectedRoute roles={['admin', 'mzk_manager']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <TemplatesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/universities"
        element={
          <ProtectedRoute roles={['admin', 'mzk_manager']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <UniversitiesPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      {/* Forced/optional password change (no layout) */}
      <Route path="/change-password" element={<ChangePasswordRoute />} />

      {/* Student portal (cabinet) */}
      <Route path="/portal" element={<StudentRoute><PortalHomePage /></StudentRoute>} />
      <Route path="/portal/roadmap" element={<StudentRoute><PortalRoadmapPage /></StudentRoute>} />
      <Route path="/portal/tasks" element={<StudentRoute><PortalTasksPage /></StudentRoute>} />
      <Route path="/portal/meetings" element={<StudentRoute><PortalMeetingsPage /></StudentRoute>} />
      <Route path="/portal/notes" element={<StudentRoute><PortalNotesPage /></StudentRoute>} />
      <Route path="/portal/questionnaires" element={<StudentRoute><PortalQuestionnairesPage /></StudentRoute>} />
      <Route path="/portal/important-notes" element={<StudentRoute><PortalImportantNotesPage /></StudentRoute>} />
      <Route path="/portal/documents" element={<StudentRoute><PortalDocumentsPage /></StudentRoute>} />
      <Route path="/portal/notifications" element={<StudentRoute><PortalNotificationsPage /></StudentRoute>} />
      <Route path="/portal/chat" element={<StudentRoute><PortalChatPage /></StudentRoute>} />
      <Route path="/portal/universities" element={<StudentRoute><PortalUniversitiesPage /></StudentRoute>} />
      <Route path="/portal/countries" element={<StudentRoute><PortalCountriesPage /></StudentRoute>} />
      <Route path="/portal/profile" element={<StudentRoute><PortalProfilePage /></StudentRoute>} />

      {/* Staff/mentor workspace — donor-style mentor cabinet backed by CRM data */}
      <Route path="/workspace" element={<WorkspaceRoute><WorkspaceDashboardPage /></WorkspaceRoute>} />
      <Route path="/workspace/students" element={<WorkspaceRoute><WorkspaceStudentsPage /></WorkspaceRoute>} />
      <Route path="/workspace/students/:studentId" element={<WorkspaceRoute><WorkspaceStudentDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/roadmap" element={<WorkspaceRoute><WorkspaceRoadmapPage /></WorkspaceRoute>} />
      <Route path="/workspace/tasks" element={<WorkspaceRoute><WorkspaceTasksPage /></WorkspaceRoute>} />
      <Route path="/workspace/questionnaires" element={<WorkspaceRoute><WorkspaceQuestionnairesPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings" element={<WorkspaceRoute><WorkspaceMeetingsPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings/session/:id" element={<WorkspaceRoute><NoteSessionPage /></WorkspaceRoute>} />
      <Route path="/workspace/meetings/notes/:id" element={<WorkspaceRoute><NoteDetailPage /></WorkspaceRoute>} />
      <Route path="/workspace/documents" element={<WorkspaceRoute><WorkspaceDocumentsPage /></WorkspaceRoute>} />
      <Route path="/workspace/telegram" element={<Navigate to="/workspace/chat?channel=telegram" replace />} />
      <Route path="/workspace/notes" element={<Navigate to="/workspace/meetings?tab=notes" replace />} />
      <Route path="/workspace/chat" element={<WorkspaceRoute><WorkspaceChatPage /></WorkspaceRoute>} />
      <Route path="/workspace/universities" element={<WorkspaceRoute><WorkspaceUniversitiesPage /></WorkspaceRoute>} />
      <Route path="/workspace/countries" element={<WorkspaceRoute><WorkspaceCountriesPage /></WorkspaceRoute>} />
      <Route path="/workspace/notifications" element={<WorkspaceRoute><WorkspaceNotificationsPage /></WorkspaceRoute>} />
      <Route path="/workspace/profile" element={<WorkspaceRoute><WorkspaceProfilePage /></WorkspaceRoute>} />

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
            <AppErrorBoundary>
              <AppRoutes />
              <Toaster />
            </AppErrorBoundary>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  )
}
