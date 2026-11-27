// 知识库导入/导出:多选文件按相对路径提交、导出走 blob 下载并回显摘要。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { KnowledgeManifest } from '@ai-task-flow/shared';
import { exportKnowledge, fetchManifest, importKnowledgeFiles } from '@/api/knowledge';
import { worklogApi } from '@/api/worklog';
import { toast } from '@/components/ui/toaster';
import { KnowledgeView } from '../KnowledgeView';

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="handle" />,
}));

vi.mock('@/components/knowledge/KnowledgeTree', () => ({
  KnowledgeTree: () => <div data-testid="tree" />,
}));

vi.mock('@/components/knowledge/KnowledgeViewer', () => ({
  KnowledgeViewer: () => <div data-testid="viewer" />,
}));

vi.mock('@/api/knowledge', () => ({
  fetchManifest: vi.fn(),
  importKnowledgeFiles: vi.fn(),
  exportKnowledge: vi.fn(),
}));

vi.mock('@/api/worklog', () => ({
  worklogApi: { getTree: vi.fn() },
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: <T,>(selector: (state: { localAccess: boolean }) => T): T =>
    selector({ localAccess: true }),
}));

vi.mock('@/hooks/useNarrowViewport', () => ({ useNarrowViewport: () => false }));

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// Radix Popover 会引入 portal/焦点管理;测试只关心导入动作,用轻量替身
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const manifest: KnowledgeManifest = {
  tree: { type: 'dir', name: 'knowledge-base', title: '知识库', children: [] },
  flatDocs: [],
  tags: [],
  backlinks: {},
  generatedAt: 0,
  basePath: '/kb',
};

const mockedFetchManifest = vi.mocked(fetchManifest);
const mockedImportFiles = vi.mocked(importKnowledgeFiles);
const mockedExport = vi.mocked(exportKnowledge);
const mockedGetTree = vi.mocked(worklogApi.getTree);

/** 给 file input 塞 FileList(jsdom 里 files 只读,只能 defineProperty) */
function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: files });
}

/** jsdom 的 File 没实现 text();浏览器(含 uTools/Chromium 132)都有,测试里补上 */
function textFile(content: string, name: string): File {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetchManifest.mockResolvedValue(manifest);
  mockedGetTree.mockResolvedValue({ projects: [], programs: [], versions: [] });
  mockedImportFiles.mockResolvedValue({ copied: 2, skipped: 0, conflicts: [], errors: [] });
});

afterEach(cleanup);

describe('KnowledgeView 导入/导出', () => {
  it('imports multiple picked files (text + binary) and reports the result', async () => {
    mockedImportFiles.mockResolvedValue({ copied: 3, skipped: 0, conflicts: [], errors: [] });
    const { container } = render(<KnowledgeView />);
    const fileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];
    expect(fileInput.multiple).toBe(true);

    setFiles(fileInput, [
      textFile('# a', 'a.md'),
      textFile('# b', 'b.md'),
      // 二进制按 base64 提交(与导出对称):1,2,3 → AQID
      new File([new Uint8Array([1, 2, 3])], 'pic.png'),
    ]);
    fireEvent.change(fileInput);

    await waitFor(() => expect(mockedImportFiles).toHaveBeenCalledTimes(1));
    expect(mockedImportFiles).toHaveBeenCalledWith([
      { path: 'a.md', content: '# a' },
      { path: 'b.md', content: '# b' },
      { path: 'pic.png', content: 'AQID', encoding: 'base64' },
    ]);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('新增 3 篇'));
  });

  it('skips unsupported files with a warning', async () => {
    const { container } = render(<KnowledgeView />);
    const fileInput = container.querySelectorAll<HTMLInputElement>('input[type="file"]')[0];

    setFiles(fileInput, [textFile('# a', 'a.md'), new File(['MZ'], 'setup.exe')]);
    fireEvent.change(fileInput);

    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith('已跳过 1 个不支持的类型或超过 5MB 的文件'),
    );
    expect(mockedImportFiles).toHaveBeenCalledWith([{ path: 'a.md', content: '# a' }]);
  });

  it('downloads the exported zip through a blob link', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockedExport.mockResolvedValue({
      blob: new Blob(['PK']),
      filename: 'knowledge-base-20261127-1530.zip',
    });

    render(<KnowledgeView />);
    fireEvent.click(screen.getByRole('button', { name: /导出/ }));

    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('已导出 knowledge-base-20261127-1530.zip'),
    );

    clickSpy.mockRestore();
  });
});
