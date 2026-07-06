// 适配 react-resizable-panels v4 新 API(Group/Panel/Separator + orientation)。
// v4 重写了导出与 data 属性,与 shadcn 旧模板(PanelGroup/PanelResizeHandle/direction)不兼容,
// 故此文件按 v4 实际签名封装,对外仍暴露 ResizablePanelGroup/ResizablePanel/ResizableHandle 三个名字。
import { GripVerticalIcon } from "lucide-react"
import {
  Group as ResizableGroup,
  Panel,
  Separator as ResizableSeparator,
  type GroupProps,
  type SeparatorProps,
} from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: GroupProps) {
  return (
    <ResizableGroup
      data-slot="resizable-panel-group"
      orientation={orientation}
      className={cn(
        "flex h-full w-full",
        orientation === "vertical" && "flex-col",
        className
      )}
      {...props}
    />
  )
}

function ResizableHandle({
  className,
  withHandle,
  ...props
}: SeparatorProps & {
  withHandle?: boolean
}) {
  return (
    <ResizableSeparator
      data-slot="resizable-handle"
      className={cn(
        "bg-border focus-visible:ring-ring hover:bg-accent relative flex shrink-0 items-center justify-center outline-none transition-colors focus-visible:ring-1",
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-background z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </ResizableSeparator>
  )
}

export { Panel as ResizablePanel, ResizablePanelGroup, ResizableHandle }
