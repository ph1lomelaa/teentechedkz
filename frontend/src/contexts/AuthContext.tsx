import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { User, UserRole } from '../types'
import { authApi } from '../api/auth'
import { setAccessToken, setForbiddenHandler } from '../api/client'
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
  canAccess: (resource: 'finances' | 'guardians' | 'confidential' | 'users' | 'tasks_create' | 'all_students') => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const navigate = useNavigate()
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
    const restoreSession = async (isRetry = false) => {
      try {
        const refreshData = await authApi.refresh()
        setAccessToken(refreshData.access_token)
        const user = await authApi.me()
        setAuth(user, refreshData.access_token)
      } catch (err) {
        // A real 401 means the session is genuinely gone — sign out.
        // Anything else (dropped connection, backend hiccup) is transient:
        // retry once before giving up, instead of forcing a fresh login.
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status !== 401 && !isRetry) {
          setTimeout(() => restoreSession(true), 800)
          return
        }
        setAuth(null, null)
      }
    }
    restoreSession()
  }, [setAuth])

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

  const hasRole = useCallback(
    (...roles: UserRole[]): boolean => {
      return !!state.user && roles.includes(state.user.role)
    },
    [state.user]
  )

  const canAccess = useCallback(
    (
      resource:
        | 'finances'
        | 'guardians'
        | 'confidential'
        | 'users'
        | 'tasks_create'
        | 'all_students'
    ): boolean => {
      if (!state.user) return false
      const role = state.user.role
      switch (resource) {
        case 'finances':
          return role === 'admin' || role === 'mzk_manager' || role === 'mentor'
        case 'guardians':
          return true
        case 'confidential':
          return true
        case 'users':
          return role === 'admin'
        case 'tasks_create':
          return true
        case 'all_students':
          return true
        default:
          return false
      }
    },
    [state.user]
  )

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser, setSession, hasRole, canAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
