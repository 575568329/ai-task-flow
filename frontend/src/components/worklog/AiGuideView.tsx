// frontend/src/components/worklog/AiGuideView.tsx
// AI 使用指南:渲染 shared mcpToolCatalog(单一来源)——作用/何时用/示例话术。
// 教用户"什么时候让 AI 调用什么工具",工具变更时本页自动同步。
import { WORKLOG_TOOL_CATALOG } from '@ai-task-flow/shared';
import { Terminal, HelpCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export function AiGuideView() {
  return (
    <div className="h-full overflow-y-auto p-4 @xl:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary mt-0.5 rounded-md p-2">
            <HelpCircle className="size-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI 使用指南</h2>
            <p className="text-muted-foreground text-sm">
              在终端(Claude Code/ZCode)对 AI 说下面这些话,它就会调用对应的工作记录工具。
              干完活先记录、再汇报——成果不留在对话里。
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {WORKLOG_TOOL_CATALOG.map((tool) => (
            <div
              key={tool.name}
              className="bg-card border rounded-lg p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Terminal className="text-muted-foreground size-4" />
                <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-sm font-semibold">
                  {tool.name}
                </code>
                <Badge variant="secondary">{tool.description.split('。')[0]}</Badge>
              </div>
              <p className="text-sm">{tool.whenToUse}</p>
              <p className="bg-muted/50 border-l-primary border-l-2 rounded-r px-3 py-2 text-sm">
                {tool.userPromptExample}
              </p>
            </div>
          ))}
        </div>

        <p className="text-muted-foreground text-xs">
          删除类操作(delete/rename)执行前会自动快照到 ~/.ai-task-flow/worklog-backups/(保留 10 份),误删可手工恢复。
        </p>
      </div>
    </div>
  );
}
