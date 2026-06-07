// frontend/src/components/StepEditor.tsx
import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { Switch } from './ui/Switch';
import { X, GripVertical, Type, Image as ImageIcon, Copy, ClipboardCopy } from 'lucide-react';
import type { TaskStep, StepBlock } from '@ai-task-flow/shared';
import { toast } from './ui/Toaster';

interface StepEditorProps {
  steps: TaskStep[];
  onChange: (steps: TaskStep[]) => void;
}

/** 取出步骤的 blocks（兼容历史数据可能仍带旧字段） */
function getBlocks(step: TaskStep): StepBlock[] {
  if (Array.isArray(step.blocks)) return step.blocks;
  // 理论上读取时已规整，这里兜底
  const blocks: StepBlock[] = [];
  if (step.description?.trim()) blocks.push({ type: 'text', content: step.description });
  if (step.imageUrl) blocks.push({ type: 'image', url: step.imageUrl });
  return blocks;
}

export function StepEditor({ steps, onChange }: StepEditorProps) {
  // 正在上传的块定位：`${stepIndex}-${blockIndex}`
  const [uploading, setUploading] = useState<string | null>(null);
  // 多选:被勾选用于「组合复制派发指令」的步骤序号集合
  const [selected, setSelected] = useState<Set<number>>(new Set());

  /** 写回某个步骤的 blocks */
  function setStepBlocks(stepIndex: number, blocks: StepBlock[]) {
    const next = steps.map((s, i) => (i === stepIndex ? { ...s, blocks } : s));
    onChange(next);
  }

  /** 切换步骤完成状态 */
  function toggleStepCompleted(stepIndex: number) {
    const next = steps.map((s, i) =>
      i === stepIndex ? { ...s, completed: !s.completed } : s
    );
    onChange(next);
  }

  /** 切换步骤的多选状态(用于组合复制) */
  function toggleStepSelected(stepIndex: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) next.delete(stepIndex);
      else next.add(stepIndex);
      return next;
    });
  }

  /** 把一个步骤渲染成纯文本(文本原样 + 图片转 markdown) */
  function stepToText(stepIndex: number): string {
    const blocks = getBlocks(steps[stepIndex]);
    const lines: string[] = [`步骤 ${stepIndex + 1}:`];
    blocks.forEach((block) => {
      if (block.type === 'text' && block.content.trim()) lines.push(block.content);
      else if (block.type === 'image') lines.push(`![图片](${block.url})`);
    });
    return lines.join('\n\n');
  }

  /** 组合复制:把已勾选的多个步骤拼成一条派发指令交给 agent 执行 */
  function copySelected() {
    const indices = [...selected].sort((a, b) => a - b);
    if (indices.length === 0) {
      toast.error('请先勾选要组合的步骤');
      return;
    }
    const body = indices.map((i) => stepToText(i)).join('\n\n---\n\n');
    const content = `请按顺序执行以下 ${indices.length} 个步骤:\n\n${body}`;
    navigator.clipboard.writeText(content).then(
      () => toast.success(`已复制 ${indices.length} 个步骤的派发指令`),
      () => toast.error('复制失败')
    );
  }

  // ---- 步骤级操作 ----
  function addStep() {
    onChange([...steps, { blocks: [{ type: 'text', content: '' }] }]);
  }

  function deleteStep(stepIndex: number) {
    onChange(steps.filter((_, i) => i !== stepIndex));
  }

  function handleStepDragEnd(result: DropResult) {
    if (!result.destination) return;
    const items = Array.from(steps);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    onChange(items);
  }

  // ---- 块级操作 ----
  function addTextBlock(stepIndex: number) {
    const blocks = [...getBlocks(steps[stepIndex]), { type: 'text', content: '' } as StepBlock];
    setStepBlocks(stepIndex, blocks);
  }

  function updateTextBlock(stepIndex: number, blockIndex: number, content: string) {
    const blocks = getBlocks(steps[stepIndex]).map((b, i) =>
      i === blockIndex && b.type === 'text' ? { ...b, content } : b
    );
    setStepBlocks(stepIndex, blocks);
  }

  function deleteBlock(stepIndex: number, blockIndex: number) {
    const blocks = getBlocks(steps[stepIndex]).filter((_, i) => i !== blockIndex);
    setStepBlocks(stepIndex, blocks);
  }

  function handleBlockDragEnd(stepIndex: number, result: DropResult) {
    if (!result.destination) return;
    const blocks = Array.from(getBlocks(steps[stepIndex]));
    const [moved] = blocks.splice(result.source.index, 1);
    blocks.splice(result.destination.index, 0, moved);
    setStepBlocks(stepIndex, blocks);
  }

  /** 上传图片并作为新图片块追加到步骤末尾 */
  async function uploadImage(stepIndex: number, file: File) {
    const key = `${stepIndex}-upload`;
    setUploading(key);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload/image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      // 图片 URL 必须是绝对路径,因为会被 Claude Code 通过 MCP 拉走显示
      const url = `${window.location.origin}${data.url}`;
      const blocks = [...getBlocks(steps[stepIndex]), { type: 'image', url } as StepBlock];
      setStepBlocks(stepIndex, blocks);
      toast.success('图片已添加');
    } catch (error) {
      toast.error('图片上传失败');
      console.error(error);
    } finally {
      setUploading(null);
    }
  }

  /** 在文本块粘贴图片：作为新图片块插到该文本块之后 */
  function handlePaste(stepIndex: number, e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadImage(stepIndex, file);
          break;
        }
      }
    }
  }

  /** 复制单个步骤的内容（拼接文本和图片地址，交给 agent 执行） */
  function copyStep(stepIndex: number) {
    const blocks = getBlocks(steps[stepIndex]);
    const lines: string[] = [`步骤 ${stepIndex + 1}:`];

    blocks.forEach((block) => {
      if (block.type === 'text' && block.content.trim()) {
        lines.push(block.content);
      } else if (block.type === 'image') {
        lines.push(`![图片](${block.url})`);
      }
    });

    const content = lines.join('\n\n');
    navigator.clipboard.writeText(content).then(
      () => toast.success(`步骤 ${stepIndex + 1} 已复制`),
      () => toast.error('复制失败')
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <DragDropContext onDragEnd={handleStepDragEnd}>
        <Droppable droppableId="steps">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-2">
              {steps.map((step, stepIndex) => {
                const blocks = getBlocks(step);
                return (
                  <Draggable key={stepIndex} draggableId={`step-${stepIndex}`} index={stepIndex}>
                    {(prov, snapshot) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        className={`rounded-lg border p-3 transition-fast ${snapshot.isDragging ? 'dragging' : ''}`}
                        style={{
                          borderColor: 'var(--border-primary)',
                          backgroundColor: snapshot.isDragging ? 'var(--surface-2)' : 'var(--surface-1)',
                          ...prov.draggableProps.style,
                        }}
                      >
                        {/* 步骤头：拖拽手柄 + 多选框 + 序号 + 完成滑块 + 复制 + 删除 */}
                        <div className="mb-2 flex items-center gap-2">
                          <div
                            {...prov.dragHandleProps}
                            className="cursor-grab active:cursor-grabbing"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <GripVertical size={16} />
                          </div>
                          {/* 多选框:勾选后可组合复制派发指令 */}
                          <input
                            type="checkbox"
                            checked={selected.has(stepIndex)}
                            onChange={() => toggleStepSelected(stepIndex)}
                            className="cursor-pointer"
                            title="勾选以组合复制派发指令"
                          />
                          <span
                            className="text-xs font-medium"
                            style={{
                              color: 'var(--text-2)',
                              textDecoration: step.completed ? 'line-through' : 'none',
                              opacity: step.completed ? 0.6 : 1,
                            }}
                          >
                            步骤 {stepIndex + 1}
                          </span>
                          {/* 完成状态:用滑块表示 */}
                          <div className="ml-auto flex items-center gap-1.5">
                            <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                              {step.completed ? '已完成' : '未完成'}
                            </span>
                            <Switch
                              checked={step.completed || false}
                              onChange={() => toggleStepCompleted(stepIndex)}
                              title="标记步骤完成状态"
                            />
                          </div>
                          <button
                            onClick={() => copyStep(stepIndex)}
                            className="rounded p-1 transition-fast hover:opacity-80"
                            style={{ color: 'var(--text-3)' }}
                            title="复制步骤内容（含图片地址）"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            onClick={() => deleteStep(stepIndex)}
                            className="rounded p-1"
                            style={{ color: 'var(--error-8)' }}
                            title="删除步骤"
                          >
                            <X size={16} />
                          </button>
                        </div>

                        {/* 步骤内的图文块序列：可拖拽排序 */}
                        <StepBlocks
                          stepIndex={stepIndex}
                          blocks={blocks}
                          uploading={uploading === `${stepIndex}-upload`}
                          onBlockDragEnd={(r) => handleBlockDragEnd(stepIndex, r)}
                          onUpdateText={(bi, content) => updateTextBlock(stepIndex, bi, content)}
                          onDeleteBlock={(bi) => deleteBlock(stepIndex, bi)}
                          onPaste={(e) => handlePaste(stepIndex, e)}
                        />

                        {/* 块操作工具栏 */}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => addTextBlock(stepIndex)}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' }}
                          >
                            <Type size={13} />
                            加文本
                          </button>
                          <label className="cursor-pointer">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) uploadImage(stepIndex, file);
                                e.target.value = '';
                              }}
                              disabled={uploading === `${stepIndex}-upload`}
                            />
                            <span
                              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs"
                              style={{
                                backgroundColor: 'var(--surface-2)',
                                color: 'var(--text-2)',
                                cursor: uploading === `${stepIndex}-upload` ? 'not-allowed' : 'pointer',
                              }}
                            >
                              <ImageIcon size={13} />
                              {uploading === `${stepIndex}-upload` ? '上传中…' : '加图片'}
                            </span>
                          </label>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {/* 多选时:组合复制派发指令 */}
      {selected.size > 0 && (
        <div
          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
          style={{ borderColor: 'var(--primary-6)', backgroundColor: 'var(--primary-1)' }}
        >
          <span className="text-xs font-medium" style={{ color: 'var(--primary-9)' }}>
            已选 {selected.size} 个步骤
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="rounded px-2 py-1 text-xs transition-fast hover:opacity-80"
              style={{ color: 'var(--text-2)' }}
            >
              取消
            </button>
            <button
              onClick={copySelected}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-fast hover:opacity-90"
              style={{ backgroundColor: 'var(--primary-6)', color: '#fff' }}
            >
              <ClipboardCopy size={13} />
              复制派发指令
            </button>
          </div>
        </div>
      )}

      <Button variant="secondary" onClick={addStep}>
        + 添加步骤
      </Button>
    </div>
  );
}

// ---- 步骤内的图文块序列 ----

interface StepBlocksProps {
  stepIndex: number;
  blocks: StepBlock[];
  uploading: boolean;
  onBlockDragEnd: (result: DropResult) => void;
  onUpdateText: (blockIndex: number, content: string) => void;
  onDeleteBlock: (blockIndex: number) => void;
  onPaste: (e: React.ClipboardEvent) => void;
}

function StepBlocks({ stepIndex, blocks, onBlockDragEnd, onUpdateText, onDeleteBlock, onPaste }: StepBlocksProps) {
  if (blocks.length === 0) {
    return (
      <div className="rounded border border-dashed p-3 text-center text-xs" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-3)' }}>
        空步骤，点下方「加文本 / 加图片」
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onBlockDragEnd}>
      <Droppable droppableId={`blocks-${stepIndex}`}>
        {(provided) => (
          <div {...provided.droppableProps} ref={provided.innerRef}>
            {/* 文本块：纵向排列 */}
            <div className="flex flex-col gap-2 mb-2">
              {blocks.filter(b => b.type === 'text').map((block) => {
                const blockIndex = blocks.indexOf(block);
                return (
                  <Draggable key={blockIndex} draggableId={`block-${stepIndex}-${blockIndex}`} index={blockIndex}>
                    {(prov, snapshot) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        className="flex items-start gap-2 rounded p-1"
                        style={{
                          backgroundColor: snapshot.isDragging ? 'var(--surface-2)' : 'transparent',
                          ...prov.draggableProps.style,
                        }}
                      >
                        <div
                          {...prov.dragHandleProps}
                          className="mt-2 cursor-grab active:cursor-grabbing"
                          style={{ color: 'var(--text-3)' }}
                          title="拖拽调整顺序"
                        >
                          <GripVertical size={14} />
                        </div>
                        <div className="flex-1">
                          <Textarea
                            rows={2}
                            value={block.content}
                            onChange={(e) => onUpdateText(blockIndex, e.target.value)}
                            onPaste={onPaste}
                            placeholder="输入文本（可粘贴图片）"
                          />
                        </div>
                        <button
                          onClick={() => onDeleteBlock(blockIndex)}
                          className="mt-1 rounded p-1 transition-all hover:scale-110"
                          style={{ color: 'var(--error-8)' }}
                          title="删除文本"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </Draggable>
                );
              })}
            </div>

            {/* 图片块：横向排列，删除按钮覆盖在图片上 */}
            <div className="flex flex-wrap gap-2">
              {blocks.filter(b => b.type === 'image').map((block) => {
                const blockIndex = blocks.indexOf(block);
                return (
                  <Draggable key={blockIndex} draggableId={`block-${stepIndex}-${blockIndex}`} index={blockIndex}>
                    {(prov) => (
                      <div
                        ref={prov.innerRef}
                        {...prov.draggableProps}
                        className="relative group"
                        style={{
                          ...prov.draggableProps.style,
                        }}
                      >
                        <div
                          {...prov.dragHandleProps}
                          className="absolute top-1 left-1 z-10 cursor-grab active:cursor-grabbing rounded bg-black/50 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="拖拽调整顺序"
                        >
                          <GripVertical size={14} style={{ color: 'white' }} />
                        </div>
                        <img
                          src={block.url}
                          alt={`步骤${stepIndex + 1}图片`}
                          className="h-32 w-auto rounded border cursor-pointer transition-transform hover:scale-105"
                          style={{ borderColor: 'var(--border-primary)' }}
                          onClick={() => window.open(block.url, '_blank')}
                          title="点击预览大图"
                        />
                        <button
                          onClick={() => onDeleteBlock(blockIndex)}
                          className="absolute top-1 right-1 z-10 rounded-full bg-red-500 p-1 text-white opacity-0 group-hover:opacity-100 transition-all hover:scale-110 shadow-md"
                          title="删除图片"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                  </Draggable>
                );
              })}
            </div>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
