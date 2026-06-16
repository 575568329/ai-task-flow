// extension/src/sidepanel/views/ClipView.tsx
import { useEffect, useState } from 'react';
import type { ClipDraft } from '@ai-task-flow/shared';
import { usePageContext } from '../PageContextStore.js';
import { captureToDrafts, createTaskFromDraft } from '../api/backend.js';
import { DraftCard } from '../components/DraftCard.js';
import { ensureHostPermission } from '../permissions.js';

/** 从 crxjs 编译后的 manifest 动态读取 content script 产物路径（哈希随内容变，不可硬编码） */
function getClipPath(): string {
  const cs = chrome.runtime.getManifest().content_scripts;
  const path = cs?.[0]?.js?.[0];
  if (!path) throw new Error('未找到 content script 产物路径');
  return path;
}

interface EditableDraft extends ClipDraft {
  id: string; // 渲染 key 用
}

type Busy = 'idle' | 'capturing' | 'creating';

export function ClipView() {
  const { pageContext, setPageContext, error } = usePageContext();
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [prefix, setPrefix] = useState('WEB');
  const [busy, setBusy] = useState<Busy>('idle');
  const [msg, setMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  // 抓取按钮：注入 content script，结果经 onMessage 进 store（pageContext）
  async function handleCapture() {
    setMsg(null);
    setBusy('capturing');
    try {
      // tab.url/title 需 manifest 的 tabs 权限才能读到(否则被隐私保护置空)
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('[clip] handleCapture 开始', { tabId: tab?.id, url: tab?.url });
      if (!tab.id) throw new Error('找不到当前标签页');
      // side panel 内 executeScript 的 activeTab 不延续生效,需运行时按需请求目标站主机权限(首次弹一次框)
      await ensureHostPermission(tab.url);
      console.log('[clip] 主机权限就绪,注入 content script');
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [getClipPath()] });
      setMsg({ kind: 'info', text: '已发起抓取，等待页面返回…' });
    } catch (e) {
      setMsg({ kind: 'error', text: `抓取失败：${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy('idle');
    }
  }

  // pageContext 一更新就触发拆解（抓取结果异步经消息到达）
  useEffect(() => {
    if (!pageContext) return;
    let cancelled = false;
    setBusy('capturing');
    captureToDrafts(pageContext)
      .then((resp) => {
        if (cancelled) return;
        setDrafts(resp.drafts.map((d, i) => ({ ...d, id: `d${i}` })));
        setMsg({ kind: 'info', text: `拆解出 ${resp.drafts.length} 个任务草案` });
      })
      .catch((e) => {
        if (cancelled) return;
        setMsg({ kind: 'error', text: `拆解失败：${e instanceof Error ? e.message : String(e)}` });
      })
      .finally(() => {
        if (!cancelled) setBusy('idle');
      });
    return () => {
      cancelled = true;
    };
  }, [pageContext]);

  function updateDraft(index: number, next: ClipDraft) {
    const list = drafts.slice();
    list[index] = { ...next, id: list[index].id };
    setDrafts(list);
  }

  // 批量建任务：逐条 POST，部分失败继续，最后汇总
  async function handleCreate() {
    if (!pageContext || drafts.length === 0) return;
    setBusy('creating');
    setMsg(null);
    let ok = 0;
    for (const draft of drafts) {
      try {
        await createTaskFromDraft(draft, pageContext.sourceUrl, prefix);
        ok++;
      } catch (e) {
        setMsg({ kind: 'error', text: `建任务失败：${e instanceof Error ? e.message : String(e)}` });
      }
    }
    if (ok > 0) {
      setMsg({ kind: 'info', text: `已创建 ${ok}/${drafts.length} 个任务，看板将自动刷新` });
    }
    setBusy('idle');
    if (ok === drafts.length) {
      setDrafts([]);
      setPageContext(null);
    }
  }

  return (
    <div>
      <div className="row-between">
        <button className="btn btn-primary" onClick={handleCapture} disabled={busy !== 'idle'}>
          {busy === 'capturing' ? '抓取中…' : '✂️ 抓取本页'}
        </button>
        {drafts.length > 0 && (
          <button className="btn btn-primary" onClick={handleCreate} disabled={busy !== 'idle'}>
            {busy === 'creating' ? '创建中…' : `建任务（${drafts.length}）`}
          </button>
        )}
      </div>
      <p className="muted">划词优先（先选中内容再抓），否则自动提取正文+图片。</p>

      {drafts.length > 0 && (
        <div className="row">
          <span className="muted">任务前缀：</span>
          <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} style={{ width: 80 }} />
        </div>
      )}

      {msg && <p className={`msg msg-${msg.kind}`}>{msg.text}</p>}
      {error && <p className="msg msg-error">{error}</p>}

      {drafts.map((draft, i) => (
        <DraftCard key={draft.id} draft={draft} draftId={draft.id} onChange={(next) => updateDraft(i, next)} />
      ))}
    </div>
  );
}
