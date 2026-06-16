// extension/src/sidepanel/components/DraftCard.tsx
import type { ClipDraft, TaskStep } from '@ai-task-flow/shared';

const BASE_URL = 'http://localhost:3000';

interface DraftCardProps {
  draft: ClipDraft;
  draftId: string;
  onChange: (next: ClipDraft) => void;
}

/**
 * 单条任务草案编辑：标题、描述、勾选步骤、查看关联图。
 * 步骤/图文块在 MVP 不可拖拽重排，故用组合键（draftId-si-bi）保证稳定唯一即可。
 */
export function DraftCard({ draft, draftId, onChange }: DraftCardProps) {
  function updateStep(index: number, next: TaskStep) {
    const steps = draft.steps.slice();
    steps[index] = next;
    onChange({ ...draft, steps });
  }

  return (
    <div className="draft-card">
      <input
        className="input draft-title"
        value={draft.title}
        placeholder="任务标题"
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
      />
      <textarea
        className="textarea"
        rows={2}
        value={draft.description}
        placeholder="描述（可选）"
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
      />
      {draft.steps.length > 0 && (
        <ol style={{ paddingLeft: 18, margin: '6px 0 0' }}>
          {draft.steps.map((step, si) => (
            <li key={`${draftId}-s${si}`} className="step">
              <input
                type="checkbox"
                checked={!!step.completed}
                onChange={(e) => updateStep(si, { ...step, completed: e.target.checked })}
              />
              <div className="step-body">
                {step.blocks?.map((b, bi) =>
                  b.type === 'text' ? (
                    <div key={`${draftId}-s${si}-b${bi}`}>{b.content}</div>
                  ) : (
                    <img key={`${draftId}-s${si}-b${bi}`} src={`${BASE_URL}${b.url}`} alt="截图" />
                  ),
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
