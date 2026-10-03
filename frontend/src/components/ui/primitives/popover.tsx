import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/utils'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

/**
 * Без портала намеренно: токены темы (--p-*) объявлены на .crm-shell, а портал
 * уводит содержимое в <body>, где их нет, — поповер терял бы цвета темы.
 */
const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 6, ...props }, ref) => (
  <PopoverPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    collisionPadding={16}
    className={cn(
      'z-50 w-72 max-w-[calc(100vw-2rem)] rounded-panel border border-p-line bg-p-panel p-2 text-sm text-p-text shadow-lg outline-none',
      className,
    )}
    {...props}
  />
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent }
