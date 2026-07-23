// frontend/src/components/McpHelpPanel.tsx
// 设置弹窗的一个 Tab:MCP 挂载说明(静态说明 + 一键挂载按钮)。
// 告诉用户如何在 Claude Code 挂载本看板的 MCP server,并提供一键注册按钮
// (前端→backend→spawn setup-mcp.mjs)。说明文案与 docs/MCP_TOOLS_GUIDE.md 对齐。
import { useState } from 'react';
import { Copy, Check, Terminal, Plug, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { systemApi } from '@/api/task';
import { toast } from '@/components/ui/toaster';

const MCP_JSON = `{
  "mcpServers": {
    "ai-task-flow": {
      "command": "node",
      "args": ["backend/dist/interfaces/mcp/server.js"]
    }
  }
}`;

const TOOLS = [
  { name: 'list_pending_tasks', desc: '列出待办任务' },
  { name: 'get_task', desc: '获取任务详情(Markdown)' },
  { name: 'record_result', desc: '回写任务执行结果' },
  { name: 'add_note_to_task', desc: '为任务添加备注' },
  { name: 'save_to_knowledge', desc: '写入知识库文档' },
];

export function McpHelpPanel() {
  const [copied, setCopied] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(MCP_JSON);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板被拒(非安全上下文),用户手动选文本复制即可,不阻断流程
    }
  };

  const handleSetup = async () => {
    setInstalling(true);
    setOutput(null);
    try {
      const res = await systemApi.mcpSetup();
      setOutput(res.output);
      if (res.ok) {
        toast.success('挂载完成,重启 Claude Code 会话后 /mcp 可见');
      } else {
        toast.error('挂载未完全成功,请查看下方输出');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '挂载失败');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 py-1 text-sm">
      <p className="text-muted-foreground">
        本看板自带 MCP server(stdio)。在 Claude Code 挂载后,可直接用对话拉取待办任务、回写执行结果、写入知识库——无需在网页和终端之间来回切换。
      </p>

      <div className="bg-primary/5 text-primary rounded-md p-2 text-xs">
        💡 也可在终端跑 <code className="bg-muted rounded px-1">npm run setup:mcp</code> 一键完成 build + 注册到 Claude Code
      </div>

      {/* 一键挂载按钮:前端调 backend spawn setup-mcp.mjs */}
      <div className="flex flex-col gap-1.5">
        <Button onClick={() => void handleSetup()} disabled={installing} size="sm" className="w-fit">
          {installing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Plug className="size-3.5" />
          )}
          {installing ? '挂载中…' : '一键挂载到 Claude Code'}
        </Button>
        {output && (
          <pre className="bg-muted max-h-40 overflow-auto rounded-md p-2 text-xs leading-relaxed">
            <code>{output}</code>
          </pre>
        )}
      </div>

      {/* 启用步骤 */}
      <div className="flex flex-col gap-1.5">
        <div className="font-medium">启用步骤(按钮已替你做完)</div>
        <ol className="text-muted-foreground flex list-decimal flex-col gap-1 pl-5">
          <li>
            项目根已自带 <code className="bg-muted rounded px-1">.mcp.json</code>,无需额外配置
          </li>
          <li>在项目根打开 Claude Code,首次弹窗选择「允许」加载此 server</li>
          <li>
            会话内输入 <code className="bg-muted rounded px-1">/mcp</code>,看到 ai-task-flow 连接成功即可
          </li>
        </ol>
      </div>

      {/* .mcp.json 内容 + 复制 */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-medium">.mcp.json</span>
          <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? '已复制' : '复制'}
          </Button>
        </div>
        <pre className="bg-muted overflow-x-auto rounded-md p-2 text-xs leading-relaxed">
          <code>{MCP_JSON}</code>
        </pre>
      </div>

      {/* 工具列表 */}
      <div className="flex flex-col gap-1.5">
        <div className="font-medium">提供的工具(5 个)</div>
        <div className="flex flex-col gap-1">
          {TOOLS.map((t) => (
            <div key={t.name} className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                {t.name}
              </Badge>
              <span className="text-muted-foreground text-xs">{t.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 注意事项 */}
      <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-1 rounded-md border p-2 text-xs">
        <div className="flex items-center gap-1 font-medium">
          <Terminal className="size-3.5" /> 注意
        </div>
        <ul className="text-muted-foreground flex list-disc flex-col gap-0.5 pl-5">
          <li>
            须在项目根打开 Claude Code 才能解析相对路径;改了 MCP 代码需重新{' '}
            <code className="bg-muted rounded px-1">npm run build:backend</code>
          </li>
          <li>
            数据存于 <code className="bg-muted rounded px-1">~/.ai-task-flow/tasks.json</code>,换机器需新建一个空的
          </li>
          <li>
            完整说明见 <code className="bg-muted rounded px-1">docs/MCP_TOOLS_GUIDE.md</code>
          </li>
        </ul>
      </div>
    </div>
  );
}
