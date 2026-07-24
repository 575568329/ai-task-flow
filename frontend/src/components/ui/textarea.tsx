import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({
  className,
  disableAutoGrow,
  ...props
}: React.ComponentProps<"textarea"> & { disableAutoGrow?: boolean }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        // 默认随内容自动增高(field-sizing:content);描述等长文本区禁用,改固定高度+滚动,避免撑开布局
        disableAutoGrow ? "[field-sizing:fixed]" : "field-sizing-content",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
