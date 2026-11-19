import { WORK_STAGES, WORK_STAGE_LABELS, type WorkStage } from '@ai-task-flow/shared';
import { cn } from '@/lib/utils';

export type WorkStageFilter = WorkStage | 'all' | 'unset';

interface Props {
  value: WorkStage | '' | WorkStageFilter;
  onChange: (value: string) => void;
  mode?: 'form' | 'filter';
  className?: string;
  ariaLabel?: string;
}

/** 唯一阶段选择器：form 模式含「未标注」，filter 模式含「全部阶段/未标注」。 */
export function WorkStageSelect({
  value,
  onChange,
  mode = 'form',
  className,
  ariaLabel = '选择阶段',
}: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className={cn('border-input bg-background h-8 rounded-md border px-2 text-sm', className)}
    >
      {mode === 'filter' && <option value="all">全部阶段</option>}
      <option value="unset">未标注</option>
      {WORK_STAGES.map((stage) => (
        <option key={stage.id} value={stage.id}>{WORK_STAGE_LABELS[stage.id]}</option>
      ))}
    </select>
  );
}
