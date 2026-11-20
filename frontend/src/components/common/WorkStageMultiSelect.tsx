// 阶段多选筛选器:8 个阶段 + 「未标注」;空选 = 全部。
// 工作记录页与结论卡页共用,筛选状态由各页面持有(StageFilter[])。
import { WORK_STAGES } from '@ai-task-flow/shared';
import { MultiSelect } from '@/components/ui/multi-select';
import { UNSET_STAGE, stageFilterLabel, type StageFilterItem } from '@/lib/workStage';

/** 下拉选项:8 个阶段 id + unset 伪值 */
const OPTIONS: StageFilterItem[] = [...WORK_STAGES.map((stage) => stage.id), UNSET_STAGE];

interface Props {
  value: StageFilterItem[];
  onChange: (value: StageFilterItem[]) => void;
  className?: string;
  ariaLabel?: string;
}

export function WorkStageMultiSelect({ value, onChange, className, ariaLabel = '按阶段筛选' }: Props) {
  return (
    <MultiSelect
      options={OPTIONS}
      value={value}
      onChange={(next) => onChange(next as StageFilterItem[])}
      formatOption={stageFilterLabel}
      noun="阶段"
      placeholder="全部阶段"
      className={className}
      ariaLabel={ariaLabel}
    />
  );
}
