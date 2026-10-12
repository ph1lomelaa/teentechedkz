import { SelfAssignmentRolePicker } from '@/components/students/SelfAssignmentRolePicker'
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { User, UserRole } from '../types'
import { PermissionAction } from '../api/permissions'
import { authApi } from '../api/auth'
import { setAccessToken, setForbiddenHandler, refreshAccessToken } from '../api/client'
import { ws } from '../lib/ws'
import { getDefaultPath } from '../lib/authRouting'

interface AuthState {
  user: User | null
  accessToken: string | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  setSession: (user: User, accessToken: string) => void
  hasRole: (...roles: UserRole[]) => boolean
  /**
   * Право из реестра: `can('guardians', 'manage')`.
   *
   * Заменила `canAccess`, у которой четыре ветки из шести возвращали `true`
   * кому угодно — включая опекунов (ИИН родителей) и конфиденциальные заметки.
   * Права приходят с сервера (`user.permissions`) и совпадают с тем, что
   * решает бэкенд: второго расклада на фронте больше нет.
   *
   * `hasRole` остаётся только там, где вопрос действительно про личность роли
   * («я студент?»), а не про доступ.
   */
  can: (resource: string, action: PermissionAction) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate()
  const [sessionError, setSessionError] = useState(false)
  const [restoreAttempt, setRestoreAttempt] = useState(0)
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  })
  const userRef = useRef<User | null>(null)
  useEffect(() => {
    userRef.current = state.user
  }, [state.user])

  const setAuth = useCallback((user: User | null, token: string | null) => {
    setAccessToken(token)
    if (user && token) ws.start()
    else ws.stop()
    setState({
      user,
      accessToken: token,
      isLoading: false,
      isAuthenticated: !!user && !!token,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setSessionError(false)
    const restoreSession = async (isRetry = false) => {
      try {
        const token = await refreshAccessToken()
        if (cancelled) return
        if (!token) { setAuth(null, null); return }
        const user = await authApi.me()
        if (!cancelled) setAuth(user, token)
      } catch (err) {
        if (cancelled) return
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status === 401) { setAuth(null, null); return }
        if (!isRetry) {
          retryTimer = setTimeout(() => { void restoreSession(true) }, 800)
          return
        }
        setSessionError(true)
      }
    }
    void restoreSession()
    return () => { cancelled = true; clearTimeout(retryTimer) }
  }, [setAuth, restoreAttempt])

  const login = useCallback(
    async (email: string, password: string): Promise<User> => {
      const data = await authApi.login(email, password)
      setAuth(data.user, data.access_token)
      return data.user
    },
    [setAuth]
  )

  const setSession = useCallback(
    (user: User, accessToken: string) => {
      setAuth(user, accessToken)
    },
    [setAuth]
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore
    } finally {
      setAuth(null, null)
    }
  }, [setAuth])

  const refreshUser = useCallback(async () => {
    try {
      const user = await authApi.me()
      setState((s) => ({ ...s, user }))
    } catch {
      // ignore — session refresh handles auth failures
    }
  }, [])

  // A request just came back 403 FORBIDDEN — someone (an admin) may have
  // changed this user's role elsewhere while their tab stayed open. Re-fetch
  // the real role and, if it actually changed, move them to where that role
  // belongs instead of leaving them on a page they can no longer use.
  useEffect(() => {
    const handleForbidden = async () => {
      const previousRole = userRef.current?.role
      try {
        const user = await authApi.me()
        setState((s) => ({ ...s, user }))
        if (previousRole && user.role !== previousRole) {
          navigate(getDefaultPath(user.role), { replace: true })
        }
      } catch {
        // Session is genuinely gone — the 401 interceptor already owns that path.
      }
    }
    setForbiddenHandler(handleForbidden)
    return () => setForbiddenHandler(null)
  }, [navigate])

  // Вернулся во вкладку — перечитываем профиль: за это время могли
  // опубликовать новый регламент или поменять права. Не чаще раза в минуту,
  // чтобы переключение окон не превращалось в поток запросов.
  useEffect(() => {
    let lastCheck = Date.now()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !userRef.current) return
      if (Date.now() - lastCheck < 60_000) return
      lastCheck = Date.now()
      void refreshUser()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshUser])

  const hasRole = useCallback(
    (...roles: UserRole[]): boolean => {
      return !!state.user && roles.includes(state.user.role)
    },
    [state.user]
  )

  // Плоский Set вместо перебора массива: can() зовётся из ~70 мест на каждый
  // рендер страницы.
  const granted = useMemo(
    () => new Set(state.user?.permissions ?? []),
    [state.user]
  )

  const can = useCallback(
    (resource: string, action: PermissionAction): boolean => granted.has(`${resource}:${action}`),
    [granted]
  )

  if (sessionError) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p>Не удалось связаться с сервером. Попробуйте подключиться ещё раз.</p>
      <button type="button" className="rounded border px-4 py-2" onClick={() => setRestoreAttempt(value => value + 1)}>Повторить</button>
    </div>
  )

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser, setSession, hasRole, can }}>
      {children}
      <SelfAssignmentRolePicker user={state.user} />
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
