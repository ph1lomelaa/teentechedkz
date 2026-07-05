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

interface AuthState {
  user: User | null
  accessToken: string | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<User>
  logout: () => Promise<void>
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
    setState({
      user,
      accessToken: token,
      isLoading: false,
      isAuthenticated: !!user && !!token,
    })
  }, [])

  useEffect(() => {
    const restoreSession = async () => {
      try {
        const refreshData = await authApi.refresh()
        setAccessToken(refreshData.access_token)
        const user = await authApi.me()
        setAuth(user, refreshData.access_token)
      } catch {
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
          return true
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
    <AuthContext.Provider value={{ ...state, login, logout, hasRole, canAccess }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
