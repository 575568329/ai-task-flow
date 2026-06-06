// frontend/src/components/StepEditor.tsx
import { useState } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from 'react-beautiful-dnd';
import { Button } from './ui/Button';
import { Textarea } from './ui/Input';
import { Upload, X, GripVertical } from 'lucide-react';
import type { TaskStep } from '@ai-task-flow/shared';
import { toast } from './ui/Toaster';

interface StepEditorProps {
  steps: TaskStep[];
  onChange: (steps: TaskStep[]) => void;
}

export function StepEditor({ steps, onChange }: StepEditorProps) {
  const [uploading, setUploading] = useState<number | null>(null);

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return;

    const items = Array.from(steps);
    const [reordered] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reordered);

    onChange(items);
  }

  function updateStep(index: number, updates: Partial<TaskStep>) {
    const updated = [...steps];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  }

  function deleteStep(index: number) {
    onChange(steps.filter((_, i) => i !== index));
  }

  function addStep() {
    onChange([...steps, { description: '' }]);
  }

  async function uploadImage(index: number, file: File) {
    setUploading(index);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('http://localhost:3000/api/upload/image', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('上传失败');

      const data = await res.json();
      updateStep(index, { imageUrl: `http://localhost:3000${data.url}` });
      toast.success('图片上传成功');
    } catch (error) {
      toast.error('图片上传失败');
      console.error(error);
    } finally {
      setUploading(null);
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent) {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          uploadImage(index, file);
          break;
        }
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="steps">
          {(provided) => (
            <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col gap-2">
              {steps.map((step, index) => (
                <Draggable key={index} draggableId={String(index)} index={index}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      className={`rounded-lg border p-3 transition-fast ${
                        snapshot.isDragging ? 'dragging' : ''
                      }`}
                      style={{
                        borderColor: 'var(--border-primary)',
                        backgroundColor: snapshot.isDragging ? 'var(--surface-2)' : 'var(--surface-1)',
                        ...provided.draggableProps.style,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          {...provided.dragHandleProps}
                          className="mt-2 cursor-grab active:cursor-grabbing"
                          style={{ color: 'var(--text-3)' }}
                        >
                          <GripVertical size={16} />
                        </div>
                        <div className="flex-1">
                          <div className="mb-1 text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                            步骤 {index + 1}
                          </div>
                          <Textarea
                            rows={2}
                            value={step.description}
                            onChange={(e) => updateStep(index, { description: e.target.value })}
                            onPaste={(e) => handlePaste(index, e)}
                            placeholder="输入步骤描述(可粘贴图片)"
                          />
                          {step.imageUrl && (
                            <div className="relative mt-2 inline-block">
                              <img
                                src={step.imageUrl}
                                alt={`步骤${index + 1}`}
                                className="max-h-32 rounded border"
                                style={{ borderColor: 'var(--border-primary)' }}
                              />
                              <button
                                onClick={() => updateStep(index, { imageUrl: undefined })}
                                className="absolute right-1 top-1 rounded-full p-1"
                                style={{ backgroundColor: 'var(--error-5)', color: 'var(--error-9)' }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          )}
                          <div className="mt-2 flex gap-2">
                            <label className="cursor-pointer">
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) uploadImage(index, file);
                                }}
                                disabled={uploading === index}
                              />
                              <span
                                className="inline-flex items-center gap-1 rounded px-2 py-1 text-sm"
                                style={{
                                  backgroundColor: 'var(--surface-2)',
                                  color: 'var(--text-2)',
                                  cursor: uploading === index ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <Upload size={14} />
                                {uploading === index ? '上传中...' : '上传图片'}
                              </span>
                            </label>
                          </div>
                        </div>
                        <button
                          onClick={() => deleteStep(index)}
                          className="mt-1 rounded p-1 hover:bg-red-50"
                          style={{ color: 'var(--error-8)' }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </Draggable>
              ))}
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
