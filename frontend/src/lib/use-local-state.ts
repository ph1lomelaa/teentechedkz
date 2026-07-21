import { useState, useEffect } from 'react'

const PREFIX = 'teenteched_portal:'

export function useLocalState<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const fullKey = PREFIX + key
  const [value, setValue] = useState<T>(() => {
    try {
      const item = localStorage.getItem(fullKey)
      return item ? JSON.parse(item) : initialValue
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(fullKey, JSON.stringify(value))
    } catch {
      // localStorage disabled or quota exceeded
    }
  }, [value, fullKey])

  return [value, setValue]
}
