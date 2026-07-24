// frontend/src/components/ui/popover.tsx
// Popover:基于 @radix-ui/react-popover 的轻量弹出层。点外部/ Esc 关闭、键盘焦点、
// portal 到 body 避免 overflow 裁剪、智能定位(碰撞翻转)。用于「点按钮弹出一个浮动面板」
// 的场景(如历史会话列表)——这类交互的焦点管理/关闭逻辑不要自写(radix 已处理边界)。
import * as React from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverAnchor = PopoverPrimitive.Anchor;

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'center', sideOffset = 4, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        'bg-popover text-popover-foreground z-50 max-h-[var(--radix-popover-content-available-height)] w-72 overflow-y-auto rounded-md border shadow-md outline-none',
        // 进场:radix 关闭即 unmount,只做进场过渡(opacity + 轻微上移),不依赖 tailwindcss-animate
        'origin-[var(--radix-popover-content-transform-origin)] animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
