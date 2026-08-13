// frontend/src/components/views/vocabRowContextMenu.ts
// 生词行右键菜单项工厂（数据驱动，复用通用 ContextMenuHost）。
import { Volume2, Languages, Star, CheckCircle2, Circle, Copy, Trash2 } from 'lucide-react';
import type { VocabDTO } from '@ai-task-flow/shared';
import type { MenuItemBuilder } from '@/components/context-menu/types';
import { isSpeechSupported } from '@/lib/speech';

/** 生词行右键上下文（回调集合，由 VocabRow 注入，复用现有无参闭包） */
export interface VocabRowMenuCtx {
  speakOriginal: () => void;
  speakTranslation: () => void;
  toggleStar: () => void;
  toggleMastered: () => void;
  copyWord: () => void;
  remove: () => void;
}

export const buildVocabRowItems: MenuItemBuilder<VocabDTO, VocabRowMenuCtx> = ({
  target,
  ctx,
}) => {
  const speechOk = isSpeechSupported();
  return [
    {
      type: 'action',
      key: 'speakOriginal',
      label: '朗读原文',
      icon: Volume2,
      hidden: !speechOk,
      onSelect: ctx.speakOriginal,
    },
    {
      type: 'action',
      key: 'speakTranslation',
      label: '朗读译文',
      icon: Languages,
      hidden: !speechOk,
      onSelect: ctx.speakTranslation,
    },
    { type: 'separator', key: 's1' },
    {
      type: 'action',
      key: 'star',
      label: target.starred ? '取消收藏' : '收藏',
      icon: Star,
      onSelect: ctx.toggleStar,
    },
    {
      type: 'action',
      key: 'mastered',
      label: target.mastered ? '取消掌握' : '标记掌握',
      icon: target.mastered ? CheckCircle2 : Circle,
      onSelect: ctx.toggleMastered,
    },
    {
      type: 'action',
      key: 'copy',
      label: '复制单词',
      icon: Copy,
      onSelect: ctx.copyWord,
    },
    { type: 'separator', key: 's2' },
    {
      type: 'action',
      key: 'delete',
      label: '删除',
      icon: Trash2,
      danger: true,
      onSelect: ctx.remove,
    },
  ];
};
