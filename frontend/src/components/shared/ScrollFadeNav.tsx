import React, { useCallback, useEffect, useRef, useState } from 'react'

const FADE = 28

/**
 * Прокручиваемое меню, которое показывает, что внутри есть ещё пункты.
 *
 * На невысоком экране список не помещается, и последний пункт обрывался на
 * разделителе наполовину: выглядело как поломка вёрстки, а не как прокрутка.
 * Затухание рисуется только у того края, куда ещё можно прокрутить, поэтому
 * когда всё помещается или дошли до конца — пункты остаются чёткими.
 */
export const ScrollFadeNav: React.FC<React.ComponentPropsWithoutRef<'nav'>> = ({ style, children, onScroll, ...props }) => {
  const ref = useRef<HTMLElement | null>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const top = el.scrollTop > 2
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2
    setEdges((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }))
  }, [])

  useEffect(() => {
    measure()
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    Array.from(el.children).forEach((child) => observer.observe(child))
    return () => observer.disconnect()
  }, [measure])

  const stops = `${edges.top ? `transparent, #000 ${FADE}px` : '#000'}, ${edges.bottom ? `#000 calc(100% - ${FADE}px), transparent` : '#000'}`
  const mask = edges.top || edges.bottom ? `linear-gradient(to bottom, ${stops})` : undefined

  return (
    <nav
      ref={ref}
      onScroll={(event) => {
        measure()
        onScroll?.(event)
      }}
      data-fade-top={edges.top || undefined}
      data-fade-bottom={edges.bottom || undefined}
      style={{ ...style, WebkitMaskImage: mask, maskImage: mask }}
      {...props}
    >
      {children}
    </nav>
  )
}
