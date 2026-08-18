// frontend/src/components/mindmap/autoEditQueue.ts
// 双击空白创建节点后的"自动进入编辑"信号。
//
// 为什么用模块级变量而非 data 标志：data 会随自动保存落库，重开文档时
// 会误触发自动编辑；模块变量只活在当前会话内存，节点 mount 时消费即失效。
// 项目为单编辑器实例（keep-alive），无并发问题。
let pendingId: string | null = null;

/** 登记待自动进入编辑的节点 id（创建后立即调用） */
export function queueAutoEdit(id: string): void {
  pendingId = id;
}

/** 节点 mount 时消费：若命中则应自动进入编辑态（一次性） */
export function consumeAutoEdit(id: string): boolean {
  if (pendingId === id) {
    pendingId = null;
    return true;
  }
  return false;
}
