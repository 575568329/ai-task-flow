// frontend/src/components/chat/MessageStream.tsx
// 对话消息流渲染:turns → user 气泡 / assistant 归一化 blocks。
// 性能:浏览器原生 content-visibility:auto —— 屏幕外 turn 跳过布局/绘制(原生虚拟化),
//   几百上千条不卡;不卸载 DOM(保留滚动位置/组件状态),对不定高消息无需测高、无绝对定位抖动。
//   配合 TurnRow memo(applyChatEvent 对未变 turn 保持引用),流式仅末尾 turn 重渲。
// 保留交互:自动滚底(nearBottom 判断)、流式占位、过程折叠、终态 footer、复制、错误、空态。
// taskChat(TaskConversation)与 projectChat(ConversationPanel)共用。
import { memo, useEffect, useRef, useState, startTransition, type ReactNode, type CSSProperties } from 'react';
import { Copy } from 'lucide-react';
import { MessageContent } from '@/components/chat/MessageContent';
import { Collapse } from '@/components/ui/collapse';
import { ThinkingCard } from '@/components/board/ThinkingCard';
import { ToolUseCard } from '@/components/board/ToolUseCard';
import { ContextMenuHost } from '@/components/context-menu/ContextMenuHost';
import { buildTurnItems, type TurnMenuCtx } from './turnContextMenu';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import type { ChatBlock, ChatTurn } from '@ai-task-flow/shared';

const NEAR_BOTTOM_THRESHOLD = 120;
// content-visibility 屏幕外占位估计高度:'auto' 前缀让浏览器记住曾渲染过的真实高度,避免滚动条抖动
const TURN_INTRINSIC_SIZE = 'auto 120px';
// 屏幕外 turn 的容器样式:content-visibility:auto 跳过渲染,containIntrinsicSize 提供占位尺寸
const turnContainerStyle: CSSProperties = {
  // content-visibility:auto 跳过屏幕外 turn 的布局/绘制;contain 限制每条 turn 的重排重绘
  // 不波及兄弟(进入视口时的高计算局限在自身,减少连锁 layout),两者配合是滚动优化推荐组合
  contentVisibility: 'auto',
  containIntrinsicSize: TURN_INTRINSIC_SIZE,
  contain: 'layout style paint',
};

/** 将 blocks 按 text/process 分组:text 块独立一组,连续的 thinking+tool_use 归为一组。
 *  text 永远不折叠——用户关心的解释性文本不应该和过程步骤一起被收起来。
 *  渲染侧(AssistantTurn)会将所有 process 组合并到单个折叠,避免一 turn 多折叠占满屏幕。 */
function groupBlocks(blocks: ChatBlock[]): { kind: 'text' | 'process'; items: ChatBlock[] }[] {
  const groups: { kind: 'text' | 'process'; items: ChatBlock[] }[] = [];
  for (const b of blocks) {
    const isText = b.kind === 'text';
    const targetKind = isText ? 'text' : 'process';
    const last = groups[groups.length - 1];
    if (last && last.kind === targetKind) {
      last.items.push(b);
    } else {
      groups.push({ kind: targetKind, items: [b] });
    }
  }
  return groups;
}

/** 过滤无意义的 AI 文本块:纯省略号、系统元数据、图片引用等。
 *  历史对话中常见的整条无内容回复不应占用屏幕空间。 */
function isMeaninglessText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // 纯标点/省略号(1-10 个点/句号/省略号字符)
  if (/^[.。…]{1,10}$/.test(trimmed)) return true;
  // Claude Code 系统级元数据(内部消息泄露到文本流)
  if (trimmed === 'Continue from where you left off.') return true;
  if (trimmed === 'No response requested.') return true;
  if (trimmed.startsWith('Async agent launched successfully.')) return true;
  // 系统中断消息
  if (trimmed === '[Request interrupted by user for tool use]') return true;
  // 图片引用被当作文本(如 [Image: source: C:\...] / [Image #1] ...)
  if (/^\[Image[:\s#]/.test(trimmed)) return true;
  return false;
}

function ProcessFold({ blocks, streaming }: { blocks: ChatBlock[]; streaming: boolean }) {
  // 流式进行中默认展开;历史/非流式默认收起(避免大量步骤首次展开卡死)
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  const stepCount = blocks.filter((b) => b.kind !== 'text').length;
  // 大量步骤(>10):grid-template-rows 过渡前需计算全部卡片完整高度 → 同步 layout 卡死主线程。
  // 跳过 Collapse 动画,直接 show/hide;content-visibility:auto 让屏幕外卡片免布局,仅首屏项有开销。
  const heavyFold = stepCount > 10;

  const toggle = () => startTransition(() => setOpen((v) => !v));

  const inner = (
    <div className="space-y-0.5 border-t px-2 py-1">
      {blocks.map((b, i) => {
        const key = b.kind === 'tool_use' ? b.id : `${b.kind}-${i}`;
        if (b.kind === 'text') {
          return (
            <div key={key} className="text-muted-foreground text-xs">
              <MessageContent content={b.text} />
            </div>
          );
        }
        if (b.kind === 'thinking') return <ThinkingCard key={key} thinking={b.thinking} />;
        return <ToolUseCard key={key} id={b.id} name={b.name} input={b.input} result={b.result} />;
      })}
    </div>
  );

  return (
    <div className="border-border bg-muted/20 rounded-md border">
      <button
        type="button"
        onClick={toggle}
        className="hover:bg-muted/40 flex w-full items-center gap-1 px-2 py-0.5 text-left text-[11px] text-muted-foreground"
      >
        <span className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>▸</span>
        <span>{streaming ? `进行中 · ${stepCount} 步` : `${stepCount} 个步骤`}</span>
      </button>
      {heavyFold
        ? (open && inner)
        : (<Collapse open={open}>{inner}</Collapse>)}
    </div>
  );
}

/** 判断 assistant turn 是否有可见内容:有意义的文本 或 (流式中)有步骤/思考 */
function isAssistantTurnEmpty(turn: ChatTurn, streaming: boolean): boolean {
  // 仅 assistant turn 可能为空;user turn 始终可见
  if (turn.role !== 'assistant') return false;
  const blocks = turn.blocks ?? [];
  // 有非 meaningless 的 text 块 → 可见
  if (blocks.some((b) => b.kind === 'text' && !isMeaninglessText(b.text))) return false;
  // 流式中且有 process 块 → 可见(ProcessFold 展示步骤)
  if (streaming && blocks.some((b) => b.kind !== 'text')) return false;
  // 什么都没有 → 空 turn,不渲染 DOM
  return true;
}

function AssistantTurn({ turn, streaming, onCopyAll }: { turn: ChatTurn; streaming: boolean; onCopyAll?: (text: string) => void }) {
  const blocks = turn.blocks ?? [];
  const groups = groupBlocks(blocks);

  // 收集所有 process 块到一个折叠,text 块保持原位不折叠
  const processOnly = (b: ChatBlock) => b.kind !== 'text';
  const allProcessBlocks = groups
    .filter((g) => g.kind === 'process')
    .flatMap((g) => g.items)
    .filter(processOnly);
  const hasTextOnlyBlocks = blocks.some((b) => b.kind === 'text');
  const firstProcessIdx = groups.findIndex((g) => g.kind === 'process');

  // 构建渲染列表:text 块各自渲染,所有步骤合并到一个折叠放在第一个 process 组位置
  const children: ReactNode[] = [];
  const textNodes: ReactNode[] = [];
  let textSeq = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (g.kind === 'text') {
      for (const b of g.items) {
        if (b.kind === 'text') {
          if (!isMeaninglessText(b.text)) {
            textNodes.push(<MessageContent key={`text-${textSeq++}`} content={b.text} />);
          }
        }
      }
    } else if (gi === firstProcessIdx && allProcessBlocks.length > 0 && streaming) {
      // 历史对话（非流式）不展示步骤/思考折叠——用户回看历史只需要文本
      children.push(<ProcessFold key="fold" blocks={allProcessBlocks} streaming={streaming} />);
    }
    // 后续 process 组跳过(已合并到上面的折叠)
  }
  // 收集本轮 AI 回复文本(供复制),过滤无意义块
  const turnText = blocks
    .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
    .filter((b) => !isMeaninglessText(b.text))
    .map((b) => b.text)
    .join('\n');

  // 所有 text 块包裹在一个卡片容器中,提供本轮 AI 回复的统一视觉背景 + 复制按钮
  if (textNodes.length > 0) {
    children.unshift(
      <div key="text-wrap" className="bg-muted/30 rounded-lg px-3 py-2">
        <div className="space-y-1">{textNodes}</div>
        {!streaming && onCopyAll && turnText && (
          <div className="mt-1.5 flex justify-end border-t pt-1">
            <button
              type="button"
              onClick={() => onCopyAll(turnText)}
              className="hover:text-foreground text-muted-foreground/60 inline-flex items-center gap-1 text-[10px] transition-colors"
              title="复制本轮 AI 回复"
            >
              <Copy className="size-3" />
              复制
            </button>
          </div>
        )}
      </div>,
    );
  }

  return (
    <div className="max-w-full space-y-1">
      {children}
      {!hasTextOnlyBlocks && blocks.length === 0 && streaming && <ThinkingIndicator />}
    </div>
  );
}

function ThinkingIndicator() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 py-1 text-sm">
      <span>思考中</span>
      <span className="flex gap-0.5">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
      {seconds > 0 && <span className="text-[10px] tabular-nums">已 {seconds}s</span>}
    </div>
  );
}

export interface MessageStreamUsage {
  duration_ms?: number;
}

interface MessageStreamProps {
  turns: ChatTurn[];
  streaming: boolean;
  error?: string;
  usage?: MessageStreamUsage;
  emptyHint?: ReactNode;
  onCopyAll?: (text: string) => void;
}

/** 单 turn 渲染(memo):applyChatEvent 对未变 turn 保持引用,流式时仅末尾 turn 重渲 */
const TurnRow = memo(function TurnRow({
  turn,
  isLast,
  streaming,
  usage,
  onCopyAll,
}: {
  turn: ChatTurn;
  isLast: boolean;
  streaming: boolean;
  usage?: MessageStreamUsage;
  onCopyAll?: (text: string) => void;
}) {
  if (turn.role === 'user') {
    const turnCtx: TurnMenuCtx = {
      copy: (text) =>
        navigator.clipboard.writeText(text).then(
          () => toast.success('已复制'),
          () => toast.error('复制失败'),
        ),
    };
    return (
      <div className="flex flex-col items-end gap-1.5">
        <ContextMenuHost items={buildTurnItems} target={{ text: turn.text ?? '' }} ctx={turnCtx}>
          <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm">
            {turn.text}
          </div>
        </ContextMenuHost>
        {turn.images && turn.images.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end">
            {turn.images.map((dataUrl, i) => (
              <img
                key={i}
                src={dataUrl}
                alt={`附件 ${i + 1}`}
                className="size-12 rounded border object-cover"
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  // 空 assistant turn:无可见文本 + (历史模式无步骤/思考) → 不渲染
  if (isAssistantTurnEmpty(turn, streaming && isLast)) return null;

  return (
    <div className="space-y-1">
      <AssistantTurn turn={turn} streaming={streaming && isLast} onCopyAll={onCopyAll} />
      {!streaming && usage && typeof usage.duration_ms === 'number' && (
        <div className="text-muted-foreground/70 flex items-center gap-2 text-[11px]">
          <span>用时 {(usage.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
});

export function MessageStream({ turns, streaming, error, usage, emptyHint, onCopyAll }: MessageStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);

  // 末尾是 user turn = 用户刚发送,强制跟随;否则仅 nearBottom 时跟随
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last?.role === 'user') nearBottomRef.current = true;
    if (nearBottomRef.current && turns.length > 0) {
      const el = scrollRef.current;
      if (!el) return;
      const raf = requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [turns, streaming]);

  const scrollRafRef = useRef<number | null>(null);
  const onScroll = () => {
    // 滚动事件高频,rAF 合并到下一帧只算一次 nearBottom,避免每个 scroll 回调都强制读 layout
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      nearBottomRef.current = distance < NEAR_BOTTOM_THRESHOLD;
    });
  };

  const lastIsUser = turns.length === 0 || turns[turns.length - 1]?.role === 'user';

  if (turns.length === 0) {
    return (
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
        {emptyHint ?? <div className="text-muted-foreground py-8 text-center text-sm">在这里和 Claude 对话。</div>}
        {streaming && lastIsUser && <ThinkingIndicator />}
        {error && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="space-y-2">
        {turns.map((t, i) => {
          // 空 assistant turn 不渲染任何 DOM(外壳也不占位)
          if (isAssistantTurnEmpty(t, streaming && i === turns.length - 1)) return null;
          return (
            /* content-visibility:auto 让屏幕外 turn 跳过布局/绘制(原生虚拟化),不卸载 DOM */
            <div key={t.id} style={turnContainerStyle}>
              <div className="py-1">
                <TurnRow
                  turn={t}
                  isLast={i === turns.length - 1}
                  streaming={streaming}
                  usage={usage}
                  onCopyAll={onCopyAll}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* 流式占位 + 错误:列表之后,nearBottom 时可见 */}
      {streaming && lastIsUser && <ThinkingIndicator />}
      {error && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-xs whitespace-pre-wrap">
          {error}
        </div>
      )}
    </div>
  );
}
