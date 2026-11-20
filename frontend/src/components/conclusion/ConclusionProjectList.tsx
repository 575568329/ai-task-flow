import type { ConclusionSummary } from '@ai-task-flow/shared';
import { Folder, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { groupConclusions, type ConclusionSelection } from './searchFilter';

interface Props {
  cards: ConclusionSummary[];
  /** null = 尚未选择(默认不加载全部) */
  selection: ConclusionSelection | null;
  onSelect: (selection: ConclusionSelection) => void;
}

export function ConclusionProjectList({ cards, selection, onSelect }: Props) {
  const grouped = groupConclusions(cards);
  const isActive = (target: ConclusionSelection) => {
    if (!selection) return false;
    if (target.type !== selection.type) return false;
    if (target.type === 'project' && selection.type === 'project') {
      return target.project === selection.project;
    }
    return true;
  };

  return (
    <div className="space-y-1">
      <Button
        variant={isActive({ type: 'all' }) ? 'secondary' : 'ghost'}
        size="sm"
        className="w-full justify-start gap-2"
        onClick={() => onSelect({ type: 'all' })}
      >
        全部
        <span className="text-muted-foreground ml-auto text-xs">{cards.length}</span>
      </Button>

      {grouped.projects.map((project) => (
        <Button
          key={project.name}
          variant={isActive({ type: 'project', project: project.name }) ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => onSelect({ type: 'project', project: project.name })}
        >
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{project.name}</span>
          <span className="text-muted-foreground ml-auto text-xs">{project.cards.length}</span>
        </Button>
      ))}

      {grouped.personal.length > 0 && (
        <Button
          variant={isActive({ type: 'personal' }) ? 'secondary' : 'ghost'}
          size="sm"
          className={cn('w-full justify-start gap-2')}
          onClick={() => onSelect({ type: 'personal' })}
        >
          <User className="size-3.5 shrink-0" />
          个人
          <span className="text-muted-foreground ml-auto text-xs">{grouped.personal.length}</span>
        </Button>
      )}
    </div>
  );
}
