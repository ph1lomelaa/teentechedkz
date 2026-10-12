type Picker = () => Promise<string>
let picker: Picker | null = null
export function setAssignmentRolePicker(value: Picker | null) { picker = value }
export function chooseAssignmentRole(): Promise<string> {
  if (!picker) return Promise.reject(new Error('Войдите в систему, чтобы выбрать роль'))
  return picker()
}
