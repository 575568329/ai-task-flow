// extension/src/sidepanel/views/registry.ts
import type { SidePanelView } from './types.js';
import { ClipView } from './ClipView.js';
import { ChatView } from './ChatView.js';

/** 视图注册表（扩展点）：加功能 = push 一项，容器逻辑不动（设计 §3.5） */
export const VIEWS: SidePanelView[] = [
  { id: 'clip', title: '剪藏', icon: '✂️', component: ClipView },
  { id: 'chat', title: '对话', icon: '💬', component: ChatView },
];
