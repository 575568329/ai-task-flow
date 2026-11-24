// frontend/src/components/worklog/AiGuideView.tsx
// AI 使用指南:渲染 shared mcpToolCatalog(单一来源)——作用/何时用/示例话术。
// 教用户"什么时候让 AI 调用什么工具",工具变更时本页自动同步。
import {
  WORKLOG_TOOL_CATALOG,
  WORKLOG_DETAIL_TEMPLATE_BUG,
  WORKLOG_DETAIL_TEMPLATE_TASK,
  WORKLOG_DETAIL_RULES,
} from '@ai-task-flow/shared';
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
          {/* 主题/版本/需求由用户在页面创建,AI 只传 id:四步说清入口与顺序 */}
          <div className="bg-muted/40 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">🚀 新版本怎么开始</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>
                左侧点
                <span className="font-semibold">「新建主题」</span>
                (如「澳门底层数据建设」),创建后复制
                <code className="bg-muted mx-1 rounded px-1 font-mono text-xs">g_xxx</code>
                给 AI;
              </li>
              <li>
                在主题上右键
                <span className="font-semibold">「新建版本」</span>
                ,创建后复制
                <code className="bg-muted mx-1 rounded px-1 font-mono text-xs">v_xxx</code>
                给 AI;
              </li>
              <li>
                在版本上右键
                <span className="font-semibold">「新建需求」</span>
                (选好关联项目),创建后复制
                <code className="bg-muted mx-1 rounded px-1 font-mono text-xs">r_xxx</code>
                给 AI;
              </li>
              <li>
                让 AI 用
                <code className="bg-muted mx-1 rounded px-1 font-mono text-xs">versionId</code>/
                <code className="bg-muted mx-1 rounded px-1 font-mono text-xs">requirementId</code>
                记录;
                <span className="text-primary font-semibold">AI 不会自行创建主题、版本或需求</span>。
              </li>
            </ol>
          </div>

          {/* 记录格式规范:模板与规则单一来源自 shared catalog,AI 工具描述同源 */}
          <div className="bg-primary/5 border-primary/30 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">📋 记录格式(详细说明的固定结构)</h3>
            <p className="text-muted-foreground mt-1 text-xs">
              无论 AI 记录还是手动补录,「详细说明」按对应模板分条编号写——一眼看懂,后期可查:
            </p>
            <div className="mt-2 grid gap-2 @xl:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold">🐞 Bug 修复</p>
                <pre className="bg-muted/50 rounded-md p-3 font-mono text-xs leading-relaxed">{WORKLOG_DETAIL_TEMPLATE_BUG}</pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold">🛠️ 任务/功能</p>
                <pre className="bg-muted/50 rounded-md p-3 font-mono text-xs leading-relaxed">{WORKLOG_DETAIL_TEMPLATE_TASK}</pre>
              </div>
            </div>
            <ul className="mt-2 space-y-0.5">
              {WORKLOG_DETAIL_RULES.map((rule) => (
                <li key={rule} className="text-xs">· {rule}</li>
              ))}
            </ul>
          </div>

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
