// frontend/src/components/views/KnowledgeView.tsx
// 知识库视图入口:挂载 knowledge/KnowledgeView(目录树 + 查看器)。
import { KnowledgeView as KnowledgePanel } from '@/components/knowledge/KnowledgeView';

export function KnowledgeView() {
  return <KnowledgePanel />;
}
