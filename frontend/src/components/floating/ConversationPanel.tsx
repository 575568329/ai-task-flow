// frontend/src/components/floating/ConversationPanel.tsx
// 项目对话视图(悬浮窗右栏):顶栏(对话名/关联任务/会话ID/侧切换)+ 消息流 + 输入框。
// 历史切换与新建已移至左栏 SessionList,本组件不再持有历史 Popover / 顶栏新建入口。
// 数据源为 projectChatStore 的「当前激活项目的记忆对话」(派生 current)。
import { useState, type ClipboardEvent } from 'react';
import { ArrowUp, Square, Copy, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { MessageStream } from '@/components/chat/MessageStream';
import { useProjectChatStore } from '@/stores/projectChatStore';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toaster';

export function ConversationPanel() {
  const current = useProjectChatStore((s) =>
    s.activeRepoPath ? s.conversations[s.activeRepoPath] : undefined,
  );
  const projectsLoading = useProjectChatStore((s) => s.projectsLoading);
  const send = useProjectChatStore((s) => s.send);
  const stop = useProjectChatStore((s) => s.stop);
  const setDraft = useProjectChatStore((s) => s.setDraft);

  // 粘贴图片:存储 data URL(预览用) + 对应的纯 base64 数据(发送用)
  /** Anthropic SDK 支持的图片 MIME 类型 */
  const ALLOWED_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  const [pastedImages, setPastedImages] = useState<
    { dataUrl: string; base64: string; mediaType: string; name: string }[]
  >([]);

  // 无激活项目(projects 未加载/为空)时给提示,而非渲染空对话框
  if (!current) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">
        {projectsLoading ? '加载项目…' : '暂无项目(先在某个仓库里建过任务才会有)'}
      </div>
    );
  }

  const { turns, streaming, error, usage, side, sessionId, title, taskTitle, repoPath, loading, draft } = current;
  // 受控输入绑定 per-project 草稿:切项目自动切到该项目的草稿,不串项目
  const input = draft ?? '';

  const onSend = () => {
    const hasText = input.trim();
    const hasImages = pastedImages.length > 0;
    if ((!hasText && !hasImages) || streaming) return;
    const images = hasImages
      ? pastedImages.map((img) => ({ data: img.base64, mediaType: img.mediaType }))
      : undefined;
    setDraft(repoPath, '');
    setPastedImages([]);
    void send(hasText || '请看以下图片', images);
  };

  /** 粘贴图片:从剪贴板提取 File → FileReader 读 base64 → 存本地 state */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        if (!ALLOWED_IMAGE_TYPES.includes(item.type)) {
          toast.error(`不支持的图片格式:${item.type},请使用 JPEG/PNG/GIF/WebP`);
          continue;
        }
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length === 0) return;

    e.preventDefault(); // 不把图片 base64 插入到 textarea 文本中
    for (const file of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        // dataUrl 格式: "data:image/png;base64,xxxxx"
        const base64 = dataUrl.split(',')[1] ?? '';
        // 防御:base64 为空(浏览器异常)时拒绝,避免发送空数据到后端
        if (!base64) {
          console.debug('[ConversationPanel] FileReader 读取图片 base64 为空,跳过', file.name);
          return;
        }
        setPastedImages((prev) => [
          ...prev,
          { dataUrl, base64, mediaType: file.type, name: file.name || 'image' },
        ]);
      };
      reader.onerror = () => {
        // 文件损坏或读取失败时给予反馈(极罕见,但防御式编程)
        console.debug('[ConversationPanel] FileReader 读取图片失败', file.name);
        toast.error(`图片读取失败:${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const onCopyTurn = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板写入失败静默忽略(隐私模式等),但留 debug 日志便于排查
      console.debug('[ConversationPanel] clipboard.writeText 失败(隐私模式/权限不足)');
    }
  };

  // 复制当前会话的终端恢复指令(方便在对应侧终端 claude --resume <id> 接着聊)
  const onCopySessionId = async () => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(`claude --resume ${sessionId}`);
      toast.success('已复制恢复指令');
    } catch {
      toast.error('复制失败');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶栏:对话标题 + 关联任务 + 会话ID(可复制)+ 侧切换(历史/新建已移至左栏 SessionList) */}
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium">{title || '(新对话)'}</div>
          <div className="text-muted-foreground flex items-center gap-1 text-[10px]">
            {taskTitle && (
              <span className="bg-muted truncate rounded px-1" title={`关联任务:${taskTitle}`}>
                任务:{taskTitle}
              </span>
            )}
            {sessionId && (
              <button
                type="button"
                onClick={onCopySessionId}
                className="hover:text-foreground inline-flex items-center gap-0.5 font-mono transition-colors"
                title={`会话 ID:${sessionId}\n点击复制恢复指令(在对应侧终端运行)`}
              >
                <span>{sessionId.slice(0, 8)}</span>
                <Copy className="size-2.5" />
              </button>
            )}
          </div>
        </div>
        {/* 当前对话侧(只读标记):切侧会清空对话,仅新建对话时可改,故切换移至输入区 */}
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
            side === 'wsl' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
          title={side === 'wsl' ? 'WSL 侧 claude' : 'Windows 侧 claude'}
        >
          {side === 'wsl' ? 'WSL' : 'Win'}
        </span>
      </div>

      {/* 消息流:历史会话加载中显示提示,否则渲染复用 MessageStream */}
      {loading ? (
        <div className="text-muted-foreground flex min-h-0 flex-1 items-center justify-center text-xs">
          加载历史会话…
        </div>
      ) : (
        <MessageStream
          turns={turns}
          streaming={streaming}
          error={error}
          usage={usage}
          onCopyTurn={onCopyTurn}
          emptyHint={
            <div className="text-muted-foreground py-8 text-center text-sm">
              输入消息开始对话。工作目录:
              <span className="block font-mono text-[11px]">{repoPath}</span>
            </div>
          }
        />
      )}

      {/* 输入框 */}
      <div className="border-t p-2">
        {/* 粘贴图片预览:缩略图 + 文件名 + 删除按钮 */}
        {pastedImages.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pastedImages.map((img, i) => (
              <div key={i} className="group relative size-14 shrink-0 overflow-hidden rounded border">
                <img src={img.dataUrl} alt={img.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPastedImages((prev) => prev.filter((_, j) => j !== i))}
                  className="bg-background/80 absolute -top-0.5 -right-0.5 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label={`移除 ${img.name}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          value={input}
          onChange={(e) => setDraft(repoPath, e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // Enter 发送 / Shift+Enter 换行(与 TaskConversation 一致)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={
            loading
              ? '加载历史会话…'
              : streaming
                ? 'Claude 正在回复…(可点停止)'
                : '输入消息(Enter 发送,Shift+Enter 换行,可直接粘贴图片)'
          }
          disabled={streaming || !!loading}
          disableAutoGrow
          className="min-h-16 max-h-32 resize-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-muted-foreground/60 text-[11px]">
            {usage
              ? `· 输入 ${usage.input_tokens.toLocaleString()} / 输出 ${usage.output_tokens.toLocaleString()}`
              : ''}
          </span>
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="bg-destructive hover:bg-destructive/90 inline-flex size-8 items-center justify-center rounded-full text-white transition-colors"
              title="停止"
              aria-label="停止"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onSend}
              disabled={(!input.trim() && pastedImages.length === 0) || !!loading}
              className="bg-primary hover:bg-primary/90 inline-flex size-8 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              title="发送 (Enter)"
              aria-label="发送"
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
