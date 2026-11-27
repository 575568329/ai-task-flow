// frontend/src/components/AboutPanel.tsx
// 设置弹窗「关于」Tab:隐私说明 + 数据位置 + 外部访问边界。
// uTools 市场审核要求"收集个人信息必须有告知和隐私说明";本文件是产品内可见的告知入口。
import { Bot, HardDrive, Info, Network, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isMarketBuild } from '@/lib/appMode';

/** 版本号由 vite 编译期从根 package.json 注入,避免和插件清单写两处 */
const APP_VERSION = __APP_VERSION__;

export function AboutPanel() {
  return (
    <div className="space-y-3 py-1 text-sm">
      <div className="flex items-center gap-2">
        <Info className="text-muted-foreground size-4" />
        <span className="font-semibold">AI 工作记录</span>
        <Badge variant="secondary">v{APP_VERSION}</Badge>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        在终端让 AI 干活,通过 MCP 把改动记成「建设主题 → 版本 → 功能点」;
        页面负责回溯、搜索和人工增删改。数据默认存本机,开启 uTools 数据同步后随账号走。
      </p>

      <section className="bg-muted/30 space-y-1.5 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <HardDrive className="size-3.5" /> 数据保存在哪里
        </h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          工作记录、结论卡、知识库、思维导图、上传图片、LLM 配置与 Claude 配置快照
          均保存在本机用户目录 <code className="bg-muted rounded px-1 font-mono">~/.ai-task-flow</code>，
          并与本地 MCP / 桌面版共用。
          开启 uTools「数据同步」后，工作记录/结论卡/思维导图/知识库文本会通过你的 uTools 账号
          同步到其他设备；LLM 配置、Claude 配置和上传图片不同步。插件自身不上传任何数据。
        </p>
      </section>

      <section className="bg-muted/30 space-y-1.5 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <ShieldCheck className="size-3.5" /> 隐私承诺
        </h3>
        <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs leading-relaxed">
          <li>不收集账号、设备标识或使用统计,无遥测上报。</li>
          <li>不监听、不轮询剪贴板;只有你主动点「复制」时才写入剪贴板。</li>
          <li>不读取与功能无关的文件;知识库只访问你导入或指定的目录。</li>
          <li>账号同步由 uTools 客户端负责,插件不接触账号密码,也不直连云端接口。</li>
          <li>卸载插件不会自动删除数据目录,需要你手工清理。</li>
        </ul>
      </section>

      <section className="bg-muted/30 space-y-1.5 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Network className="size-3.5" /> 哪些操作会访问外部
        </h3>
        <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs leading-relaxed">
          <li>
            <span className="text-foreground font-medium">LLM 配置</span>:
            API Key 只保存在本机 <code className="bg-muted rounded px-1 font-mono">llm-config.json</code>;
            只有你配置并主动使用 AI 功能时,请求才发往你填写的 API 地址。
          </li>
          {!isMarketBuild() && (
            <li>
              <span className="text-foreground font-medium">Claude 配置切换</span>:
              只在你操作时读写本机 <code className="bg-muted rounded px-1 font-mono">~/.claude/settings.json</code>,
              写入前自动备份到 <code className="bg-muted rounded px-1 font-mono">~/.ai-task-flow/claude-settings-backups/</code>。
            </li>
          )}
          <li>
            <span className="text-foreground font-medium">知识库导入 / 导出</span>:
            导入只读取你在文件选择器里挑中的文件,导出生成 zip 由浏览器下载到本机;
            两步都不经过任何外部服务器。
          </li>
          <li>工作记录 MCP 只连接本机 127.0.0.1,不与外部服务器通信。</li>
          <li>若开启 uTools 数据同步,同步流量由 uTools 账号体系处理;同步内容是业务数据快照(不含密钥/图片/日志)。</li>
        </ul>
      </section>

      <section className="bg-muted/30 space-y-1.5 rounded-lg border p-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Bot className="size-3.5" /> AI 记录怎么用
        </h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          在工作记录页点「AI 使用指南」查看工具说明与示例话术。
          在 uTools 设置中开启「AI 设置 → MCP 服务」后,Claude Code / ZCode 等
          AI 客户端可直接调用本插件的记录工具。
        </p>
      </section>
    </div>
  );
}
