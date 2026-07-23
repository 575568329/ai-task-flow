// frontend/src/components/ShortcutsPanel.tsx
// 快捷键设置面板:列出动作 → 点击「按键」按钮进入捕获模式 → 按下一次按键即重绑。
// 捕获期间通过 setCapturing(true) 暂停业务监听,避免触发新建/保存等副作用。
import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_ACTIONS,
  loadShortcuts,
  saveShortcuts,
  setCapturing,
  eventToCombo,
  formatCombo,
  type ShortcutMap,
} from '@/lib/shortcuts';

export function ShortcutsPanel() {
  const [map, setMap] = useState<ShortcutMap>(() => loadShortcuts());
  const [editing, setEditing] = useState<keyof ShortcutMap | null>(null);
  const [dirty, setDirty] = useState(false);

  // 捕获模式:监听下一次按键(capture 阶段优先),落盘到本地 map(未保存前不持久化)
  useEffect(() => {
    setCapturing(editing !== null);
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = eventToCombo(e);
      if (!combo) return; // 纯修饰键,继续等待
      // Esc 放弃编辑
      if (combo === 'esc') {
        setEditing(null);
        return;
      }
      setMap((prev) => ({ ...prev, [editing]: combo }));
      setDirty(true);
      setEditing(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setCapturing(false);
    };
  }, [editing]);

  const onSave = () => {
    saveShortcuts(map);
    setDirty(false);
    toast.success('快捷键已保存');
  };

  const onReset = () => {
    setMap({ ...DEFAULT_SHORTCUTS });
    saveShortcuts({ ...DEFAULT_SHORTCUTS });
    setDirty(false);
    toast.info('已恢复默认快捷键');
  };

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <Keyboard className="size-3.5" />
        单键在输入框中不触发;按 Esc 取消重绑
      </div>
      {SHORTCUT_ACTIONS.map((action) => (
        <div key={action.key} className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-sm font-medium">{action.label}</div>
            <div className="text-muted-foreground text-xs">{action.description}</div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-w-28 font-mono"
            onClick={() => setEditing(action.key)}
          >
            {editing === action.key ? '按下按键…' : formatCombo(map[action.key])}
          </Button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={!dirty}>
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={onReset}>
          恢复默认
        </Button>
      </div>
    </div>
  );
}
