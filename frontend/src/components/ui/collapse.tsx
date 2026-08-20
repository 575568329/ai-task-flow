// frontend/src/components/ui/collapse.tsx
// 通用折叠组件:CSS grid 0fr↔1fr 平滑过渡(2025 最佳实践,非 max-height 黑魔法,
// 过渡到真实 auto 尺寸)。open 控制展开/收起。
//
// 【全站动画规则·折叠类】
// 1. 纵向高度过渡 grid-template-rows:0fr↔1fr;横向宽度过渡 grid-template-columns:0fr↔1fr
//    (看板紧凑行形态的分组收起用横向:卡片横排,收起=向左收拢、右侧内容滑来补位)。
//    durationMs 默认 200ms ease-out。
// 2. 内层 overflow-hidden + min-h-0/min-w-0:收起时裁净内容,不被 min-content 撑开。
// 3. 方向箭头由调用方用单 ChevronDown + rotate 过渡(见 ProjectGroup),不在此处耦合。
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** 过渡时长(ms),默认 200。大场景(整栏)可传 300。 */
  durationMs?: number;
  /** 折叠方向:vertical 高度塌缩(默认)/ horizontal 宽度收拢(横向排布内容用) */
  direction?: 'vertical' | 'horizontal';
}

export function Collapse({ open, children, durationMs = 200, direction = 'vertical' }: CollapseProps) {
  const isVertical = direction === 'vertical';
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: isVertical ? (open ? '1fr' : '0fr') : undefined,
        gridTemplateColumns: isVertical ? undefined : open ? '1fr' : '0fr',
        transition: `${isVertical ? 'grid-template-rows' : 'grid-template-columns'} ${durationMs}ms ease-out`,
      }}
    >
      <div className={cn('overflow-hidden', isVertical ? 'min-h-0' : 'min-w-0')}>{children}</div>
    </div>
  );
}
