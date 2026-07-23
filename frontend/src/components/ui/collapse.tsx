// frontend/src/components/ui/collapse.tsx
// 通用折叠组件:CSS grid-template-rows 0fr↔1fr 平滑过渡高度(2025 最佳实践,
// 非 max-height 黑魔法,过渡到真实 auto 高度)。open 控制展开/收起。
//
// 【全站动画规则·折叠类】
// 1. 高度过渡用 grid-template-rows:0fr↔1fr,durationMs 默认 200ms ease-out。
// 2. 内层 overflow-hidden + min-h-0:收起时裁净内容,不被 min-content 撑开。
// 3. 方向箭头由调用方用单 ChevronDown + rotate 过渡(见 ProjectGroup),不在此处耦合。
import type { ReactNode } from 'react';

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** 过渡时长(ms),默认 200。大场景(整栏)可传 300。 */
  durationMs?: number;
}

export function Collapse({ open, children, durationMs = 200 }: CollapseProps) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        transition: `grid-template-rows ${durationMs}ms ease-out`,
      }}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
