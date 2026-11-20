import { WORK_STAGES, WORK_STAGE_LABELS, type WorkStage } from '@ai-task-flow/shared';
import { cn } from '@/lib/utils';

interface Props {
  /** 空字符串 = 未标注 */
  value: WorkStage | '';
  /** 选「未标注」时回传空字符串(提交时不带 stage) */
  onChange: (value: WorkStage | '') => void;
  className?: string;
  ariaLabel?: string;
}

/** 表单单选阶段选择器;筛选场景用 WorkStageMultiSelect。 */
export function WorkStageSelect({
  value,
  onChange,
  className,
  ariaLabel = '选择阶段',
}: Props) {
  return (
    <select
      value={value || 'unset'}
      onChange={(e) => onChange(e.target.value === 'unset' ? '' : (e.target.value as WorkStage))}
      aria-label={ariaLabel}
      className={cn('border-input bg-background h-8 rounded-md border px-2 text-sm', className)}
    >
      <option value="unset">未标注</option>
      {WORK_STAGES.map((stage) => (
        <option key={stage.id} value={stage.id}>{WORK_STAGE_LABELS[stage.id]}</option>
      ))}
    </select>
  );
}
