// frontend/src/components/board/StepEditor.tsx
// 任务步骤编辑器:每步 = 有序图文块。
// - 文本块:Textarea 编辑(保留原块顺序,仅替换首个文本块内容)
// - 图片块:缩略图预览 + 删除;支持「添加图片」按钮 + 在 Textarea 内粘贴图片上传
// 支持步骤的增/删/上移/下移/标记完成。数据契约对齐 shared TaskStep.blocks。
import { useRef, useState, type ClipboardEvent } from 'react';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  ImagePlus,
  Loader2,
  Copy,
  X,
} from 'lucide-react';
import type { TaskStep, StepBlock } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { usePreviewStore } from '@/stores/previewStore';

interface StepEditorProps {
  steps: TaskStep[];
  onChange: (steps: TaskStep[]) => void;
  disabled?: boolean;
}

/** 取步骤所有块(空数组兜底) */
function getBlocks(step: TaskStep): StepBlock[] {
  return step.blocks ?? [];
}

/** 取首个文本块内容(无则空串) */
function getStepText(step: TaskStep): string {
  for (const block of getBlocks(step)) {
    if (block.type === 'text') return block.content;
  }
  return '';
}

export function StepEditor({ steps, onChange, disabled }: StepEditorProps) {
  // 正在上传的步骤 key(`${stepIndex}-upload`),用于显示 loading
  const [uploading, setUploading] = useState<string | null>(null);
  // 每步一个隐藏 file input 的引用,按钮点击触发
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  // 最新 steps 引用:uploadImage 跨 await 取值,避免闭包陈旧状态覆盖用户并发编辑
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  /** 更新某步的 blocks(整体替换,基于最新 steps) */
  const setStepBlocks = (stepIndex: number, blocks: StepBlock[]) => {
    onChange(stepsRef.current.map((s, i) => (i === stepIndex ? { ...s, blocks } : s)));
  };

  /** 写入文本:替换已有文本块内容(保留图片块与原顺序);无文本块则在最前插入 */
  const updateText = (index: number, content: string) => {
    const blocks = getBlocks(steps[index]);
    if (blocks.some((b) => b.type === 'text')) {
      setStepBlocks(
        index,
        blocks.map((b) => (b.type === 'text' ? { ...b, content } : b)),
      );
      return;
    }
    setStepBlocks(index, [{ type: 'text', content }, ...blocks]);
  };

  const addStep = () => {
    onChange([...steps, { blocks: [{ type: 'text', content: '' }], completed: false }]);
  };

  const toggleComplete = (index: number) => {
    onChange(steps.map((s, i) => (i === index ? { ...s, completed: !s.completed } : s)));
  };

  const removeStep = (index: number) => {
    onChange(steps.filter((_, i) => i !== index));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  /** 上传图片到后端,作为图片块追加到步骤末尾 */
  const uploadImage = async (stepIndex: number, file: File) => {
    const key = `${stepIndex}-upload`;
    setUploading(key);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/image', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`上传失败: HTTP ${res.status}`);
      const data = (await res.json()) as { url: string };
      // 绝对路径:任务 md 会被 Claude Code 经 MCP 拉取,需可直接访问
      const url = `${window.location.origin}${data.url}`;
      setStepBlocks(stepIndex, [...getBlocks(stepsRef.current[stepIndex]), { type: 'image', url }]);
      toast.success('图片已添加');
    } catch (error) {
      toast.error('图片上传失败');
      console.error('[StepEditor] uploadImage failed:', error);
    } finally {
      setUploading(null);
    }
  };

  /** 在 Textarea 内粘贴:检测到图片项则上传(阻止默认粘贴行为) */
  const handlePaste = (stepIndex: number, e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          void uploadImage(stepIndex, file);
          break;
        }
      }
    }
  };

  /** 删除指定下标的块(图片缩略图上的 ×) */
  const removeBlock = (stepIndex: number, blockIndex: number) => {
    setStepBlocks(
      stepIndex,
      getBlocks(steps[stepIndex]).filter((_, i) => i !== blockIndex),
    );
  };

  /** 复制单步内容(文本原样 + 图片转 markdown)到剪贴板,便于贴给 agent 执行 */
  const copyStep = async (stepIndex: number) => {
    const blocks = getBlocks(steps[stepIndex]);
    const lines: string[] = [`步骤 ${stepIndex + 1}:`];
    blocks.forEach((block) => {
      if (block.type === 'text' && block.content.trim()) {
        lines.push(block.content);
      } else if (block.type === 'image') {
        lines.push(`![图片](${block.url})`);
      }
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('步骤内容已复制');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败');
    }
  };

  if (steps.length === 0) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={addStep} disabled={disabled}>
        <Plus className="size-4" />
        添加步骤
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, index) => {
        const completed = step.completed ?? false;
        const blocks = getBlocks(step);
        const isUploading = uploading === `${index}-upload`;
        return (
          <div
            key={index}
            className={cn(
              'rounded-md border p-2 transition-colors',
              completed && 'bg-muted/40',
            )}
          >
            <div className="flex items-center gap-1 pb-1.5">
              <GripVertical className="text-muted-foreground size-4 shrink-0" />
              <span className="text-muted-foreground flex-1 text-xs font-medium">
                步骤 {index + 1}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => move(index, -1)}
                disabled={disabled || index === 0}
                aria-label="上移"
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => move(index, 1)}
                disabled={disabled || index === steps.length - 1}
                aria-label="下移"
              >
                <ChevronDown className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-7"
                onClick={() => removeStep(index)}
                disabled={disabled}
                aria-label="删除步骤"
              >
                <Trash2 className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground size-7"
                onClick={() => copyStep(index)}
                disabled={disabled}
                aria-label="复制步骤内容(含图片地址)"
                title="复制步骤内容(含图片地址)"
              >
                <Copy className="size-3.5" />
              </Button>
            </div>

            <Textarea
              value={getStepText(step)}
              onChange={(e) => updateText(index, e.target.value)}
              onPaste={(e) => handlePaste(index, e)}
              placeholder="描述这个步骤要做什么(可直接粘贴图片)…"
              className={cn('min-h-12', completed && 'line-through opacity-60')}
              disabled={disabled}
            />

            {/* 图片块预览(按 blocks 原顺序) */}
            {blocks.some((b) => b.type === 'image') && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {blocks.map((block, blockIndex) => {
                  if (block.type !== 'image') return null;
                  return (
                    <div key={block.url} className="group/img relative">
                      <img
                        src={block.url}
                        alt="步骤截图"
                        className="h-16 w-16 cursor-zoom-in rounded border object-cover"
                        onClick={() => usePreviewStore.getState().open(block.url)}
                      />
                      <button
                        type="button"
                        className="bg-destructive text-destructive-foreground absolute -top-1.5 -right-1.5 rounded-full p-0.5 opacity-0 transition-opacity group-hover/img:opacity-100"
                        onClick={() => removeBlock(index, blockIndex)}
                        disabled={disabled}
                        aria-label="删除图片"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-1.5 flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground h-7 px-2 text-xs"
                onClick={() => fileInputRefs.current[index]?.click()}
                disabled={disabled || isUploading}
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="size-3.5" />
                )}
                {isUploading ? '上传中…' : '添加图片'}
              </Button>
              <input
                ref={(el) => {
                  fileInputRefs.current[index] = el;
                }}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadImage(index, file);
                  e.target.value = ''; // 重置,允许重复选同一文件
                }}
              />
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={completed}
                  onChange={() => toggleComplete(index)}
                  disabled={disabled}
                  className="size-3.5"
                />
                标记完成
              </label>
            </div>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="w-full" onClick={addStep} disabled={disabled}>
        <Plus className="size-4" />
        添加步骤
      </Button>
    </div>
  );
}
