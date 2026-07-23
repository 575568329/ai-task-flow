// frontend/src/components/SettingsDialog.tsx
// 设置弹窗(Tab 式):模型配置 / 存储管理 / MCP 挂载。
// 侧栏"设置"入口打开本弹窗。三个 Tab 用按钮+state 切换(无 Radix Tabs,Tab 少不引依赖)。
import { useState } from 'react';
import type { ComponentType } from 'react';
import { Database, SlidersHorizontal, Plug, Keyboard } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LlmConfigPanel } from './LlmConfigPanel';
import { StoragePanel } from './StoragePanel';
import { McpHelpPanel } from './McpHelpPanel';
import { ShortcutsPanel } from './ShortcutsPanel';

type SettingsTab = 'llm' | 'storage' | 'mcp' | 'shortcuts';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface TabDef {
  key: SettingsTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const TABS: TabDef[] = [
  { key: 'llm', label: '模型配置', icon: SlidersHorizontal },
  { key: 'storage', label: '存储管理', icon: Database },
  { key: 'mcp', label: 'MCP 挂载', icon: Plug },
  { key: 'shortcuts', label: '快捷键', icon: Keyboard },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('llm');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>配置 LLM 模型、管理本地存储、查看 MCP 挂载方式。</DialogDescription>
        </DialogHeader>

        {/* Tab 切换条(按钮实现,无 Tabs 依赖) */}
        <div className="flex gap-1 border-b">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {/* 当前 Tab 内容:AnimatePresence mode="wait" 切换时旧淡出→新淡入(切走卸载,与原条件渲染一致) */}
        <div className="max-h-[60vh] overflow-y-auto px-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {tab === 'llm' ? (
                <LlmConfigPanel />
              ) : tab === 'storage' ? (
                <StoragePanel />
              ) : tab === 'mcp' ? (
                <McpHelpPanel />
              ) : (
                <ShortcutsPanel />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
