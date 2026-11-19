import { WORK_STAGE_LABELS, type WorkStage } from '@ai-task-flow/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STAGE_BADGE_CLASS } from '@/lib/workStage';

interface Props {
  stage?: WorkStage;
  className?: string;
}

export function WorkStageBadge({ stage, className }: Props) {
  if (!stage) return null;
  return (
    <Badge variant="outline" className={cn('text-[10px]', STAGE_BADGE_CLASS[stage], className)}>
      {WORK_STAGE_LABELS[stage]}
    </Badge>
  );
}
