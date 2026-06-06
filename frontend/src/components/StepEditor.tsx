// frontend/src/components/StepEditor.tsx
import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { X, GripVertical, Type, Image as ImageIcon } from 'lucide-react';
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

  /** 写回某个步骤的 blocks */
  function setStepBlocks(stepIndex: number, blocks: StepBlock[]) {
    const next = steps.map((s, i) => (i === stepIndex ? { blocks } : s));
    onChange(next);
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
      const res = await fetch('http://localhost:3000/api/upload/image', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('上传失败');
      const data = await res.json();
      const url = `http://localhost:3000${data.url}`;
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
                        {/* 步骤头：拖拽手柄 + 序号 + 删除 */}
                        <div className="mb-2 flex items-center gap-2">
                          <div
                            {...prov.dragHandleProps}
                            className="cursor-grab active:cursor-grabbing"
                            style={{ color: 'var(--text-3)' }}
                          >
                            <GripVertical size={16} />
                          </div>
                          <span className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                            步骤 {stepIndex + 1}
                          </span>
                          <button
                            onClick={() => deleteStep(stepIndex)}
                            className="ml-auto rounded p-1"
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
          <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-2">
            {blocks.map((block, blockIndex) => (
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
                      title="拖拽调整图文顺序"
                    >
                      <GripVertical size={14} />
                    </div>

                    <div className="flex-1">
                      {block.type === 'text' ? (
                        <Textarea
                          rows={2}
                          value={block.content}
                          onChange={(e) => onUpdateText(blockIndex, e.target.value)}
                          onPaste={onPaste}
                          placeholder="输入文本（可粘贴图片）"
                        />
                      ) : (
                        <img
                          src={block.url}
                          alt={`步骤${stepIndex + 1}图片`}
                          className="max-h-40 rounded border"
                          style={{ borderColor: 'var(--border-primary)' }}
                        />
                      )}
                    </div>

                    <button
                      onClick={() => onDeleteBlock(blockIndex)}
                      className="mt-1 rounded p-1"
                      style={{ color: 'var(--error-8)' }}
                      title={block.type === 'text' ? '删除文本' : '删除图片'}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  );
}
