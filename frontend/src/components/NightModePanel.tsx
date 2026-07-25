// frontend/src/components/NightModePanel.tsx
// 设置弹窗的一个 Tab:夜间开发模式开关。
// 开启后「打开终端」启动的交互式 claude 拼 --permission-mode bypassPermissions,
// 跳过所有权限确认(无人值守);关闭(一键还原)即恢复权限确认。
//
// 存储:uiStore.nightMode(localStorage 持久化),前端开关值在「打开终端」时随请求透传给后端。
// 安全:开启是危险操作 → useConfirm 二次确认(destructive 染红);关闭是安全操作,直接生效。
// Switch 受控(checked=nightMode):用户取消确认时不 setNightMode,Switch 自动保持原态。
import { Moon, ShieldCheck, ShieldOff } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { toast } from '@/components/ui/toaster';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export function NightModePanel() {
  const nightMode = useUIStore((s) => s.nightMode);
  const setNightMode = useUIStore((s) => s.setNightMode);
  const { confirm } = useConfirm();

  const handleToggle = async (next: boolean) => {
    if (next) {
      // 开启 = 危险操作,二次确认
      const ok = await confirm({
        title: '开启夜间开发模式',
        description:
          '开启后,「打开终端」启动的 Claude 将跳过所有权限确认——文件写入、命令执行均不再弹窗,可执行任意操作。\n\n仅限你信任的本机隔离环境(worktree)使用,切勿用于共享 / 生产 / 不可丢弃的仓库。\n\n确认开启?',
        confirmText: '我已知晓风险,开启',
        variant: 'destructive',
      });
      if (!ok) return; // 取消:Switch 受控,自动保持关闭态
      setNightMode(true);
      toast.success('夜间模式已开启:打开终端的 Claude 将跳过所有权限确认');
    } else {
      // 关闭 = 还原(安全操作),无需二次确认
      setNightMode(false);
      toast.success('已恢复正常模式:Claude 将恢复权限确认');
    }
  };

  return (
    <div className="flex flex-col gap-4 py-1">
      {/* 开关行:左说明 + 右 Switch */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 font-medium">
            <Moon className="size-4 shrink-0" />
            夜间开发模式
          </div>
          <p className="text-muted-foreground text-xs">
            开启后,通过「打开终端」启动的 Claude 自动以{' '}
            <code className="text-foreground">--permission-mode bypassPermissions</code> 运行,
            跳过所有权限确认,适合夜间无人值守跑任务。
          </p>
        </div>
        <Switch checked={nightMode} onCheckedChange={handleToggle} className="mt-0.5 shrink-0" />
      </div>

      {/* 状态条:开启=红色危险态,关闭=绿色安全态,可视化「一键开启 / 一键还原」 */}
      <div
        className={cn(
          'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm',
          nightMode
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
        )}
      >
        {nightMode ? (
          <ShieldOff className="size-4 shrink-0" />
        ) : (
          <ShieldCheck className="size-4 shrink-0" />
        )}
        {nightMode
          ? '夜间模式已开启:Claude 将执行任意操作且不询问,请确认环境安全。'
          : '已关闭:Claude 执行写入 / 命令前会正常请求权限确认。'}
      </div>

      {/* 补充说明清单 */}
      <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
        <li>· 仅作用于「打开终端」(cmd / wsl / pwsh 三种环境均生效);看板内置对话已默认无人值守。</li>
        <li>· 设置仅保存在当前浏览器(localStorage),换浏览器 / 清缓存后需重新开启。</li>
        <li>· 关闭开关即一键还原,无需其他操作。</li>
      </ul>
    </div>
  );
}
