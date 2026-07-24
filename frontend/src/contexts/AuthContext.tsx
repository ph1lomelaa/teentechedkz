import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react'
import { User, UserRole } from '../types'
import { authApi } from '../api/auth'
import { setAccessToken } from '../api/client'
import { ws } from '../lib/ws'

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
  hasRole: (...roles: UserRole[]) => boolean
  canAccess: (resource: 'finances' | 'guardians' | 'confidential' | 'users' | 'tasks_create' | 'all_students') => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  })

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
          return role === 'admin' || role === 'mzk_manager'
        case 'guardians':
          return true
        case 'confidential':
          return true
        case 'users':
          return role === 'admin' || role === 'mzk_manager'
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
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser, hasRole, canAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
