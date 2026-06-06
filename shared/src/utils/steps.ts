// shared/src/utils/steps.ts
// 步骤图文块的规整与 Markdown 生成——前后端共用的单一来源。
// 保证：编辑器顺序 === 前端预览顺序 === 给 AI 的 Markdown 顺序。

import type { StepBlock, TaskStep } from '../types/task.js';

/**
 * 把任意来源的步骤规整为统一的 blocks 结构。
 *
 * 兼容三种输入：
 * 1. 新格式 { blocks: [...] }              → 原样返回（过滤空块）
 * 2. 旧格式 { description, imageUrl }       → 转为 [文本块?, 图片块?]，保持"文前图后"
 * 3. 两者混合（迁移期）                      → blocks 优先，旧字段忽略
 */
export function normalizeStep(step: TaskStep): Required<Pick<TaskStep, 'blocks'>> & { blocks: StepBlock[] } {
  // 新格式：已有 blocks，直接清洗
  if (Array.isArray(step.blocks)) {
    return { blocks: step.blocks.filter(isNonEmptyBlock) };
  }

  // 旧格式：description + imageUrl → 文本在前，图片在后
  const blocks: StepBlock[] = [];
  if (step.description && step.description.trim()) {
    blocks.push({ type: 'text', content: step.description });
  }
  if (step.imageUrl) {
    blocks.push({ type: 'image', url: step.imageUrl });
  }
  return { blocks };
}

/** 批量规整 */
export function normalizeSteps(steps: TaskStep[] | undefined): TaskStep[] {
  if (!steps) return [];
  return steps.map((s) => normalizeStep(s));
}

/** 过滤空块：空文本、无 url 的图片都丢弃 */
function isNonEmptyBlock(block: StepBlock): boolean {
  if (block.type === 'text') return !!block.content && block.content.trim().length > 0;
  if (block.type === 'image') return !!block.url;
  return false;
}

/**
 * 把步骤列表渲染成 Markdown 步骤段。
 *
 * 输出格式（AI 可清晰识别每个步骤的图文先后）：
 *
 *   ### 步骤 1
 *
 *   先点登录
 *
 *   ![步骤1-图1](http://...)
 *
 *   再填表单
 *
 * @param steps      任务步骤（可为旧格式，内部会规整）
 * @param headingLevel 步骤标题的层级，默认 3（###）
 */
export function stepsToMarkdown(steps: TaskStep[] | undefined, headingLevel: number = 3): string {
  const normalized = normalizeSteps(steps);
  if (normalized.length === 0) return '（无步骤）';

  const hashes = '#'.repeat(Math.min(Math.max(headingLevel, 1), 6));
  const lines: string[] = [];

  normalized.forEach((step, stepIndex) => {
    lines.push(`${hashes} 步骤 ${stepIndex + 1}`, '');

    const blocks = step.blocks ?? [];
    if (blocks.length === 0) {
      lines.push('（空步骤）', '');
      return;
    }

    let imageCount = 0;
    blocks.forEach((block) => {
      if (block.type === 'text') {
        lines.push(block.content, '');
      } else {
        imageCount += 1;
        lines.push(`![步骤${stepIndex + 1}-图${imageCount}](${block.url})`, '');
      }
    });
  });

  // 去掉末尾多余空行
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines.join('\n');
}
