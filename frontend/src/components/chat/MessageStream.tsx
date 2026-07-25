// frontend/src/components/chat/MessageStream.tsx
// 对话消息流渲染:turns → user 气泡 / assistant 归一化 blocks。
// 性能:浏览器原生 content-visibility:auto —— 屏幕外 turn 跳过布局/绘制(原生虚拟化),
//   几百上千条不卡;不卸载 DOM(保留滚动位置/组件状态),对不定高消息无需测高、无绝对定位抖动。
//   配合 TurnRow memo(applyChatEvent 对未变 turn 保持引用),流式仅末尾 turn 重渲。
// 保留交互:自动滚底(nearBottom 判断)、流式占位、过程折叠、终态 footer、复制、错误、空态。
// taskChat(TaskConversation)与 projectChat(ConversationPanel)共用。
import { memo, useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { Copy } from 'lucide-react';
import { MessageContent } from '@/components/chat/MessageContent';
import { Collapse } from '@/components/ui/collapse';
import { ThinkingCard } from '@/components/board/ThinkingCard';
import { ToolUseCard } from '@/components/board/ToolUseCard';
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

function ProcessFold({ blocks, streaming }: { blocks: ChatBlock[]; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming) setOpen(false);
    wasStreaming.current = streaming;
  }, [streaming]);

  const stepCount = blocks.filter((b) => b.kind !== 'text').length;
  return (
    <div className="border-border bg-muted/20 rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hover:bg-muted/40 flex w-full items-center gap-1 px-2 py-1 text-left text-xs text-muted-foreground"
      >
        <span className={cn('inline-block transition-transform', open ? 'rotate-90' : '')}>▸</span>
        <span>{streaming ? `进行中 · ${stepCount} 步` : `${stepCount} 个步骤`}</span>
      </button>
      <Collapse open={open}>
        <div className="space-y-1 border-t px-2 py-1.5">
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
      </Collapse>
    </div>
  );
}

function AssistantTurn({ turn, streaming }: { turn: ChatTurn; streaming: boolean }) {
  const blocks = turn.blocks ?? [];
  const groups = groupBlocks(blocks);

  // 收集所有 process 块(text 除外)到一个折叠,避免 text 夹在步骤之间时拆成多个折叠
  const allProcessBlocks = groups
    .filter((g) => g.kind === 'process')
    .flatMap((g) => g.items);
  const firstProcessIdx = groups.findIndex((g) => g.kind === 'process');

  return (
    <div className="max-w-full space-y-1.5">
      {groups.map((g, gi) => {
        if (g.kind === 'text') {
          return g.items.map((b, i) =>
            b.kind === 'text' ? <MessageContent key={`text-${gi}-${i}`} content={b.text} /> : null,
          );
        }
        // 只在第一个 process 组的位置渲染折叠(内含所有步骤),后续 process 组跳过
        if (gi === firstProcessIdx && allProcessBlocks.length > 0) {
          return <ProcessFold key="fold" blocks={allProcessBlocks} streaming={streaming} />;
        }
        return null;
      })}
      {blocks.length === 0 && streaming && <ThinkingIndicator />}
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
  onCopyTurn?: (text: string) => void;
}

/** 单 turn 渲染(memo):applyChatEvent 对未变 turn 保持引用,流式时仅末尾 turn 重渲 */
const TurnRow = memo(function TurnRow({
  turn,
  isLast,
  streaming,
  usage,
  onCopyTurn,
}: {
  turn: ChatTurn;
  isLast: boolean;
  streaming: boolean;
  usage?: MessageStreamUsage;
  onCopyTurn?: (text: string) => void;
}) {
  if (turn.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <div className="bg-primary text-primary-foreground max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-sm">
          {turn.text}
        </div>
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
  // 提取本 turn 所有 text 块的纯文本(供复制按钮用)
  const turnText =
    turn.blocks
      ?.filter((b) => b.kind === 'text')
      .map((b) => (b as { text: string }).text)
      .join('\n') ?? '';
  return (
    <div className="space-y-1.5">
      <AssistantTurn turn={turn} streaming={streaming && isLast} />
      {!streaming && (
        <div className="text-muted-foreground/70 flex items-center gap-2 text-[11px]">
          {usage && typeof usage.duration_ms === 'number' && (
            <span>用时 {(usage.duration_ms / 1000).toFixed(1)}s</span>
          )}
          {onCopyTurn && turnText && (
            <button
              type="button"
              onClick={() => onCopyTurn(turnText)}
              className="hover:text-foreground inline-flex items-center gap-0.5 transition-colors"
              title="复制此条回复"
            >
              <Copy className="size-3" />
              复制
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export function MessageStream({ turns, streaming, error, usage, emptyHint, onCopyTurn }: MessageStreamProps) {
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
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 space-y-4 overflow-y-auto px-3 py-3">
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
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
      <div className="space-y-4">
        {turns.map((t, i) => (
          /* content-visibility:auto 让屏幕外 turn 跳过布局/绘制(原生虚拟化),不卸载 DOM */
          <div key={t.id} style={turnContainerStyle}>
            <div className="py-2">
              <TurnRow
                turn={t}
                isLast={i === turns.length - 1}
                streaming={streaming}
                usage={usage}
                onCopyTurn={onCopyTurn}
              />
            </div>
          </div>
        ))}
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
