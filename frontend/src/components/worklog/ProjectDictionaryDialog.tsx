// frontend/src/components/worklog/ProjectDictionaryDialog.tsx
// 项目字典(从旧树移出的项目设置):项目用于路径归属与筛选,不再是树根。
// 每个项目展示路径三态:已绑定尾段(+N)/未绑定/路径不存在标红;可就地打开路径绑定弹窗。
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { WorklogProject } from '@ai-task-flow/shared';
import { ProjectPathDialog } from './ProjectPathDialog';

/** 路径尾两段(统一用 \ 展示):D:\xunfei\资源加工平台 → …\xunfei\资源加工平台 */
export function formatPathTail(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.length === 0) return path;
  const tail = segments.slice(-2).join('\\');
  return segments.length > 2 ? `…\\${tail}` : tail;
}

interface ProjectDictionaryDialogProps {
  projects: WorklogProject[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 路径绑定/解绑成功后通知父组件重拉(不传则只在弹窗内提示) */
  onPathsChanged?: () => void | Promise<void>;
}

export function ProjectDictionaryDialog({
  projects, open, onOpenChange, onPathsChanged,
}: ProjectDictionaryDialogProps) {
  /** 正在绑定路径的项目名(嵌套弹窗挂载即 open;关闭置空) */
  const [bindingProject, setBindingProject] = useState<string | null>(null);
  const bindingTarget = bindingProject
    ? projects.find((p) => p.name === bindingProject)
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>项目字典</DialogTitle>
          <DialogDescription>
            项目用于记录路径归属与筛选;同一路径只能被一个项目占用。绑定后 AI 记录会按所在目录自动归属。
          </DialogDescription>
        </DialogHeader>

        {projects.length === 0 ? (
          <p className="text-muted-foreground text-xs leading-relaxed">
            还没有项目。绑定路径或记录时显式传入项目后会自动出现。
          </p>
        ) : (
          <div className="space-y-1">
            {projects.map((project) => {
              const boundPaths = project.paths ?? [];
              const missingSet = new Set(project.missingPaths ?? []);
              const missingCount = boundPaths.filter((p) => missingSet.has(p)).length;
              const firstPathMissing = boundPaths.length > 0 && missingSet.has(boundPaths[0]);
              return (
                <div
                  key={project.id}
                  className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
                >
                  <span className="shrink-0 font-medium">{project.name}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {boundPaths.length > 0 ? (
                      <>
                        <span
                          className={cn(
                            'truncate',
                            firstPathMissing ? 'text-destructive' : 'text-muted-foreground',
                          )}
                          title={firstPathMissing ? '路径不存在' : boundPaths[0]}
                        >
                          {formatPathTail(boundPaths[0])}
                        </span>
                        {boundPaths.length > 1 && (
                          <span className="text-muted-foreground shrink-0">+{boundPaths.length - 1}</span>
                        )}
                        {/* 多路径时明确失效条数,避免 +N 里藏着坏路径却看不出来 */}
                        {boundPaths.length > 1 && missingCount > 0 && (
                          <span className="text-destructive shrink-0" title="其中部分路径不存在">
                            {missingCount} 条失效
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground/70">未绑定路径</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 px-2 text-xs"
                    onClick={() => setBindingProject(project.name)}
                  >
                    <Link2 className="size-3" /> 绑定路径…
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {bindingTarget && (
          <ProjectPathDialog
            project={bindingTarget.name}
            paths={bindingTarget.paths ?? []}
            missingPaths={bindingTarget.missingPaths}
            open
            onOpenChange={(value) => { if (!value) setBindingProject(null); }}
            onChanged={onPathsChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
