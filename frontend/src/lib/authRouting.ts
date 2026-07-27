import { UserRole } from '@/types'

/** Single source of truth for "where does this role land by default". */
export function getDefaultPath(role: UserRole): string {
  switch (role) {
    case 'admin':
    case 'mzk_manager':
      return '/dashboard'
    case 'mentor':
      return '/my-students'
    case 'student':
      return '/portal'
    default:
      return '/dashboard'
  }
}
