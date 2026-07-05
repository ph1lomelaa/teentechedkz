import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/shared/Layout'
import { Toaster } from '@/components/ui/toaster'

import { LoginPage } from '@/pages/LoginPage'
import { DashboardPage } from '@/pages/DashboardPage'
import { StudentsListPage } from '@/pages/StudentsListPage'
import { StudentCardPage } from '@/pages/StudentCardPage'
import { NotesPage } from '@/pages/NotesPage'
import { NoteSessionPage } from '@/pages/NoteSessionPage'
import { NoteDetailPage } from '@/pages/NoteDetailPage'

// Lazy-loaded pages (less critical path)
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
const TasksPage = React.lazy(() =>
  import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage }))
)
const MigrationConflictsPage = React.lazy(() =>
  import('@/pages/MigrationConflictsPage').then((m) => ({ default: m.MigrationConflictsPage }))
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

function RootRedirect() {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="flex items-center justify-center h-screen text-gray-400">Загрузка...</div>
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'admin' || user.role === 'mzk_manager') return <Navigate to="/dashboard" replace />
  return <Navigate to="/my-students" replace />
}

function ProtectedRoute({
  children,
  roles,
}: {
  children: React.ReactNode
  roles?: string[]
}) {
  const { user, isLoading } = useAuth()
  if (isLoading) return <div className="flex items-center justify-center h-screen text-gray-400">Загрузка...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />

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
          <ProtectedRoute roles={['lead_mentor', 'mentor']}>
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
          <ProtectedRoute roles={['admin']}>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <SettingsUsersPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/tasks"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <TasksPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/migration-conflicts"
        element={
          <ProtectedRoute>
            <AppLayout>
              <React.Suspense fallback={<div className="p-6">Загрузка...</div>}>
                <MigrationConflictsPage />
              </React.Suspense>
            </AppLayout>
          </ProtectedRoute>
        }
      />

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

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
          <Toaster />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
