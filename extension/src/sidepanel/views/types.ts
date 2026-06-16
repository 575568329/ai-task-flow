// extension/src/sidepanel/views/types.ts
import type { ComponentType } from 'react';

/** 侧栏视图契约：加功能 = registry.push 一项（设计 §3.5） */
export interface SidePanelView {
  id: string;
  title: string;
  icon: string; // emoji 标识
  component: ComponentType;
}
