import * as React from 'react'
import { Textarea, type TextareaProps } from '@/components/ui/primitives/textarea'
import { cn } from '@/lib/utils'

/** Textarea, растущий по содержимому: длинный текст виден целиком, без внутренней прокрутки. */
export const AutoTextarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, value, ...props }, forwardedRef) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

    const resize = React.useCallback(() => {
      const el = innerRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight + 2}px`
    }, [])

    React.useLayoutEffect(resize, [resize, value])
    // Ширина поля меняется (поворот телефона, появление скролла) — перенос строк меняет высоту.
    React.useEffect(() => {
      const el = innerRef.current
      if (!el || typeof ResizeObserver === 'undefined') return
      let lastWidth = el.clientWidth
      const observer = new ResizeObserver(() => {
        if (el.clientWidth !== lastWidth) {
          lastWidth = el.clientWidth
          resize()
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }, [resize])

    return (
      <Textarea
        {...props}
        value={value}
        rows={1}
        className={cn('min-h-[40px] resize-none overflow-hidden', className)}
        ref={(node) => {
          innerRef.current = node
          if (typeof forwardedRef === 'function') forwardedRef(node)
          else if (forwardedRef) forwardedRef.current = node
        }}
      />
    )
  },
)
AutoTextarea.displayName = 'AutoTextarea'
