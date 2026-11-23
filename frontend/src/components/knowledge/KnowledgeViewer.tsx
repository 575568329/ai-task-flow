// frontend/src/components/knowledge/KnowledgeViewer.tsx
// 文档查看器:按 kind 分流(md 可编辑/预览 / img / pdf·html iframe / docx 下载)。
// md 支持:编辑/预览切换、Ctrl+S 保存(PUT saveDoc)、关联徽标与「编辑关联」弹窗(PUT doc/meta)。
// 新建入口在 KnowledgeTree(目录树顶部)。
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Printer, Download, Pencil, Eye, Save, Star, Copy, Link2 } from 'lucide-react';
import { WORK_STAGES, WORK_STAGE_LABELS, isWorkStage } from '@ai-task-flow/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useKnowledgeStore } from '@/stores/knowledgeStore';
import { stageLabel } from '@/lib/knowledgeViews';
import {
  fetchDoc,
  getRawUrl,
  deleteDoc,
  fetchManifest,
  saveDoc,
  updateDocMeta,
} from '@/api/knowledge';
import { MessageContent } from '@/components/common/MessageContent';
import { MdEditor } from './MdEditor';
import { toast } from '@/components/ui/toaster';
import { useConfirm } from '@/components/ui/confirm';
import { usePreviewStore } from '@/stores/previewStore';
import { exportElementToPdf } from '@/lib/docExport';
import { copyDiskPath } from '@/lib/copyPath';
import { cn } from '@/lib/utils';

export function KnowledgeViewer() {
  const getCurrentDoc = useKnowledgeStore((s) => s.getCurrentDoc);
  const currentPath = useKnowledgeStore((s) => s.currentPath);
  const setCurrentPath = useKnowledgeStore((s) => s.setCurrentPath);
  const setManifest = useKnowledgeStore((s) => s.setManifest);
  const mode = useKnowledgeStore((s) => s.mode);
  const setMode = useKnowledgeStore((s) => s.setMode);
  const toggleFavorite = useKnowledgeStore((s) => s.toggleFavorite);
  const favorites = useKnowledgeStore((s) => s.favorites);
  const { confirm } = useConfirm();

  // 订阅 manifest:关联编辑/保存后 setManifest 能触发重渲染,徽标随之更新
  const manifest = useKnowledgeStore((s) => s.manifest);
  const worklogIndex = useKnowledgeStore((s) => s.worklogIndex);
  const doc = getCurrentDoc();
  const isFav = doc ? favorites.includes(doc.path) : false;
  const basePath = manifest?.basePath ?? '';
  const [draft, setDraft] = useState('');
  const [original, setOriginal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // 编辑关联弹窗
  const [metaOpen, setMetaOpen] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaForm, setMetaForm] = useState({
    versionId: '',
    requirementId: '',
    projectId: '',
    stage: '',
  });

  const isMd = doc?.kind === 'md';
  const dirty = isMd && draft !== original;

  // 关联徽标:有字段则逐个展示名称,全部为空显示「未关联」
  const associationItems: Array<{ key: string; label: string; value: string }> = [];
  if (doc?.frontmatter) {
    const fm = doc.frontmatter;
    if (fm.versionId) {
      associationItems.push({
        key: 'versionId',
        label: '版本',
        value: worklogIndex.versionNames.get(fm.versionId) ?? fm.versionId,
      });
    }
    if (fm.requirementId) {
      associationItems.push({
        key: 'requirementId',
        label: '需求',
        value: worklogIndex.requirementNames.get(fm.requirementId) ?? fm.requirementId,
      });
    }
    if (fm.projectId) {
      associationItems.push({
        key: 'projectId',
        label: '项目',
        value: worklogIndex.projectNames.get(fm.projectId) ?? fm.projectId,
      });
    }
    if (fm.stage) {
      associationItems.push({ key: 'stage', label: '阶段', value: stageLabel(fm.stage) });
    }
  }

  /** 需求下拉:只列出所选版本下的需求;未选版本时置灰 */
  const requirementOptions = worklogIndex.requirements.filter(
    (requirement) => requirement.versionId === metaForm.versionId,
  );

  const openMetaDialog = () => {
    const fm = doc?.frontmatter;
    setMetaForm({
      versionId: fm?.versionId ?? '',
      requirementId: fm?.requirementId ?? '',
      projectId: fm?.projectId ?? '',
      stage: fm?.stage ?? '',
    });
    setMetaOpen(true);
  };

  /** 切换版本时:cursor 需求不属于新版本则清空,避免写出跨版本的悬空需求 */
  const onMetaVersionChange = (versionId: string) => {
    setMetaForm((prev) => {
      const keep =
        versionId !== '' &&
        worklogIndex.requirements.some(
          (requirement) =>
            requirement.id === prev.requirementId && requirement.versionId === versionId,
        );
      return { ...prev, versionId, requirementId: keep ? prev.requirementId : '' };
    });
  };

  const onSaveMeta = async () => {
    if (!doc) return;
    setSavingMeta(true);
    try {
      await updateDocMeta({
        path: doc.path,
        versionId: metaForm.versionId,
        requirementId: metaForm.requirementId,
        projectId: metaForm.projectId,
        stage: metaForm.stage,
      });
      setManifest(await fetchManifest());
      setMetaOpen(false);
      toast.success('关联已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新关联失败');
    } finally {
      setSavingMeta(false);
    }
  };

  // 文档切换:拉取正文 + 重置基线(mode 由 store 管:切文档自动 view,新建后 edit)
  useEffect(() => {
    if (!currentPath || !doc || doc.kind !== 'md') {
      setDraft('');
      setOriginal('');
      return;
    }
    setLoading(true);
    fetchDoc(currentPath)
      .then((res) => {
        const c = res.content ?? '';
        setDraft(c);
        setOriginal(c);
      })
      .catch(() => {
        setDraft('');
        setOriginal('');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  const refreshManifest = async () => {
    setManifest(await fetchManifest());
  };

  // 保存(覆盖已有文档)
  const onSave = useCallback(async () => {
    if (!currentPath || !isMd) return;
    setSaving(true);
    try {
      await saveDoc(currentPath, draft);
      setOriginal(draft);
      await refreshManifest();
      toast.success('已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, draft, isMd]);

  // Ctrl/Cmd+S 快捷保存(仅编辑态)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && mode === 'edit' && isMd) {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, isMd, onSave]);

  const onDelete = async () => {
    if (!doc) return;
    if (
      !(await confirm({
        title: '删除文档',
        description: `确认删除「${doc.title}」?`,
        variant: 'destructive',
      }))
    )
      return;
    try {
      await deleteDoc(doc.path);
      setManifest(await fetchManifest());
      setCurrentPath(null);
      toast.success('已删除');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败');
    }
  };

  /** md 导出 PDF:渲染区 → 新窗口打印(逻辑抽到 docExport,与 TaskDocsView 共用) */
  const onExportPdf = () => {
    const el = contentRef.current;
    if (!el) return;
    if (!exportElementToPdf(el, doc?.title ?? '')) {
      toast.error('请允许弹窗以导出 PDF');
    }
  };

  /** 下载原始文件(fetch→blob→a[download],避免浏览器内联打开 pdf/html/img) */
  const onDownload = async () => {
    if (!doc) return;
    try {
      const res = await fetch(getRawUrl(doc.path));
      if (!res.ok) throw new Error('下载失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败');
    }
  };

  const isFrame = doc?.kind === 'pdf' || doc?.kind === 'html';

  return (
    <div className="bg-card flex h-full flex-col rounded-md border">
      <header className="flex items-center gap-1.5 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {doc?.title ?? '未选择文档'}
        </span>
        {doc?.tags?.map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-[10px]">
            {tag}
          </Badge>
        ))}

        {/* 关联徽标:版本/需求/项目/阶段;全部为空时显示「未关联」 */}
        {isMd &&
          (associationItems.length > 0 ? (
            associationItems.map((item) => (
              <Badge key={item.key} variant="outline" className="px-1.5 py-0 text-[10px]">
                {item.label} · {item.value}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="text-muted-foreground px-1.5 py-0 text-[10px]">
              未关联
            </Badge>
          ))}

        {/* 收藏(所有文档类型均可;点击切换,已收藏=实心黄星) */}
        {doc && (
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            onClick={() => toggleFavorite(doc.path)}
            aria-label={isFav ? '取消收藏' : '收藏'}
            title={isFav ? '取消收藏' : '收藏'}
          >
            <Star className={cn('size-3.5', isFav && 'fill-amber-400 text-amber-400')} />
          </Button>
        )}

        {/* md 编辑/预览切换 + 保存(仅当前文档操作,新建在左侧目录树) */}
        {isMd && mode === 'view' && (
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground size-7"
            onClick={() => setMode('edit')}
            aria-label="编辑"
            title="编辑"
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        {isMd && mode === 'edit' && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={() => setMode('view')}
              aria-label="预览"
              title="预览"
            >
              <Eye className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant={dirty ? 'default' : 'ghost'}
              className="size-7"
              onClick={() => void onSave()}
              disabled={saving || !dirty}
              aria-label="保存"
              title="保存 (Ctrl+S)"
            >
              <Save className="size-3.5" />
            </Button>
          </>
        )}

        {doc && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={() => void copyDiskPath(`${basePath}/${doc.path}`)}
              aria-label="复制磁盘路径"
              title="复制磁盘路径"
            >
              <Copy className="size-3.5" />
            </Button>
            {isMd && (
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-7"
                onClick={openMetaDialog}
                aria-label="编辑关联"
                title="编辑关联"
              >
                <Link2 className="size-3.5" />
              </Button>
            )}
            {isMd && mode === 'view' && (
              <Button
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-7"
                onClick={onExportPdf}
                aria-label="导出 PDF"
                title="导出 PDF"
              >
                <Printer className="size-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground size-7"
              onClick={() => void onDownload()}
              aria-label="下载原文件"
              title="下载原文件"
            >
              <Download className="size-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive size-7"
              onClick={() => void onDelete()}
              aria-label="删除文档"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </header>

      {/* body:按类型分流 */}
      {!doc ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-sm">
          选择左侧文档查看,或点左上角 + 新建笔记
        </div>
      ) : isFrame ? (
        <iframe src={getRawUrl(doc.path)} title={doc.title} className="flex-1 border-0" />
      ) : isMd && mode === 'edit' ? (
        <div className="flex-1 overflow-hidden">
          <MdEditor value={draft} onChange={setDraft} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4" ref={contentRef}>
            {isMd &&
              (loading ? (
                <div className="text-muted-foreground text-sm">加载中…</div>
              ) : (
                <MessageContent content={draft} />
              ))}
            {doc.kind === 'img' && (
              <img
                src={getRawUrl(doc.path)}
                alt={doc.title}
                className="max-w-full cursor-zoom-in rounded"
                onClick={() => usePreviewStore.getState().open(getRawUrl(doc.path))}
              />
            )}
            {doc.kind === 'docx' && (
              <div className="text-muted-foreground flex flex-col items-center gap-2 py-10 text-sm">
                <p>docx 暂不支持在线预览</p>
                <button
                  type="button"
                  className="text-primary underline"
                  onClick={() => void onDownload()}
                >
                  下载查看
                </button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* 编辑关联:四个下拉;空 = 未关联(保存时清除对应字段) */}
      <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑关联</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">版本</span>
              <select
                value={metaForm.versionId}
                onChange={(e) => onMetaVersionChange(e.target.value)}
                aria-label="关联版本"
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              >
                <option value="">未关联</option>
                {metaForm.versionId &&
                  !worklogIndex.versions.some((version) => version.id === metaForm.versionId) && (
                    <option value={metaForm.versionId}>{metaForm.versionId}(未找到)</option>
                  )}
                {worklogIndex.versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">需求</span>
              <select
                value={metaForm.requirementId}
                onChange={(e) =>
                  setMetaForm((prev) => ({ ...prev, requirementId: e.target.value }))
                }
                disabled={!metaForm.versionId}
                aria-label="关联需求"
                className="border-input bg-background h-8 rounded-md border px-2 text-sm disabled:opacity-50"
              >
                <option value="">{metaForm.versionId ? '未选择需求' : '先选择版本'}</option>
                {metaForm.requirementId &&
                  !requirementOptions.some(
                    (requirement) => requirement.id === metaForm.requirementId,
                  ) && (
                    <option value={metaForm.requirementId}>
                      {worklogIndex.requirementNames.get(metaForm.requirementId) ??
                        metaForm.requirementId}
                      (未找到)
                    </option>
                  )}
                {requirementOptions.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirement.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">项目</span>
              <select
                value={metaForm.projectId}
                onChange={(e) => setMetaForm((prev) => ({ ...prev, projectId: e.target.value }))}
                aria-label="关联项目"
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              >
                <option value="">未关联</option>
                {metaForm.projectId &&
                  !worklogIndex.projects.some((project) => project.id === metaForm.projectId) && (
                    <option value={metaForm.projectId}>{metaForm.projectId}(未找到)</option>
                  )}
                {worklogIndex.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">阶段</span>
              <select
                value={metaForm.stage}
                onChange={(e) => setMetaForm((prev) => ({ ...prev, stage: e.target.value }))}
                aria-label="关联阶段"
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              >
                <option value="">未标注</option>
                {metaForm.stage && !isWorkStage(metaForm.stage) && (
                  <option value={metaForm.stage}>{metaForm.stage}</option>
                )}
                {WORK_STAGES.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {WORK_STAGE_LABELS[stage.id]}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-muted-foreground text-xs">
              关联只写入文档 frontmatter,不修改文档正文;清除后即变为「未关联」。
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                取消
              </Button>
            </DialogClose>
            <Button size="sm" onClick={() => void onSaveMeta()} disabled={savingMeta}>
              {savingMeta ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
