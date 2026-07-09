// extension/src/sidepanel/views/VocabView.tsx
// 划词翻译视图:挂载取当前页选区→自动翻译;顶部输入框手动翻译;
// 结果展示(译文/词性/释义/例句)+朗读原文/译文+存生词本;下方最近生词(朗读+收藏/掌握/删除)。
import { useCallback, useEffect, useState } from 'react';
import type { TranslateResponse, VocabDTO } from '@ai-task-flow/shared';
import { translateText, saveVocab, listVocab, updateVocab, deleteVocab } from '../api/backend.js';
import { speak, isSpeechSupported } from '../utils/speech.js';

type Msg = { kind: 'info' | 'error'; text: string } | null;
type Result = { text: string; data: TranslateResponse };

const RECENT_PAGE_SIZE = 20;

export function VocabView() {
  const [input, setInput] = useState('');
  const [translating, setTranslating] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [recent, setRecent] = useState<VocabDTO[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const supportSpeech = isSpeechSupported();

  /** 取当前激活标签页的划词选区(activeTab 已授权;chrome:// 等受限页面静默返回 null) */
  const getSelection = useCallback(async (): Promise<string | null> => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab.id) return null;
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() ?? '',
      });
      const text = res?.[0]?.result;
      return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch {
      return null;
    }
  }, []);

  const doTranslate = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setMsg(null);
    setTranslating(true);
    try {
      const data = await translateText(trimmed);
      setResult({ text: trimmed, data });
    } catch (e) {
      setResult(null);
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTranslating(false);
    }
  }, []);

  const refreshRecent = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const resp = await listVocab({ page: 1, pageSize: RECENT_PAGE_SIZE });
      setRecent(resp.items);
    } catch (e) {
      // 最近列表失败不阻塞翻译主流程,仅记录
      console.warn('[vocab] 拉取最近生词失败', e);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  // 挂载:自动取划词翻译 + 拉最近生词
  useEffect(() => {
    void (async () => {
      const sel = await getSelection();
      if (sel) {
        setInput(sel);
        void doTranslate(sel);
      }
    })();
    void refreshRecent();
  }, [getSelection, doTranslate, refreshRecent]);

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = result.data;
      await saveVocab({
        word: result.text,
        translation: r.translation,
        sourceLang: r.sourceLang || undefined,
        pos: r.pos,
        definition: r.definition,
        example: r.example,
      });
      setMsg({ kind: 'info', text: '已加入生词本' });
      setResult(null);
      setInput('');
      void refreshRecent();
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function toggle(v: VocabDTO, field: 'starred' | 'mastered') {
    try {
      const updated = await updateVocab(v.id, { [field]: !v[field] });
      setRecent((list) => list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function remove(v: VocabDTO) {
    try {
      await deleteVocab(v.id);
      setRecent((list) => list.filter((x) => x.id !== v.id));
    } catch (e) {
      setMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div>
      {/* 翻译输入 */}
      <div className="row-between" style={{ margin: 0 }}>
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void doTranslate(input);
          }}
          placeholder="输入或选中网页文本翻译"
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-primary"
          onClick={() => void doTranslate(input)}
          disabled={translating || !input.trim()}
        >
          {translating ? '翻译中…' : '翻译'}
        </button>
      </div>
      <p className="muted">打开侧栏自动翻译当前选中文本;也可在此手动输入。</p>

      {msg && <p className={`msg msg-${msg.kind}`}>{msg.text}</p>}

      {/* 翻译结果 */}
      {result && (
        <div className="draft-card">
          <div className="row-between" style={{ margin: 0 }}>
            <span className="muted">
              {result.data.sourceLang || '—'} → zh{result.data.pos ? ` · ${result.data.pos}` : ''}
            </span>
            <div className="row" style={{ margin: 0 }}>
              {supportSpeech && (
                <>
                  <button className="btn" onClick={() => speak(result.text, result.data.sourceLang || undefined)}>
                    🔊 原文
                  </button>
                  <button className="btn" onClick={() => speak(result.data.translation, 'zh')}>
                    🔊 译文
                  </button>
                </>
              )}
              <button className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
                {saving ? '保存中…' : '存生词本'}
              </button>
            </div>
          </div>
          <p style={{ fontWeight: 600, margin: '6px 0' }}>{result.data.translation}</p>
          {result.data.definition && <p className="muted">{result.data.definition}</p>}
          {result.data.example && (
            <p className="muted" style={{ fontStyle: 'italic' }}>
              例:{result.data.example}
            </p>
          )}
        </div>
      )}

      {/* 最近生词 */}
      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="muted">最近生词（{recent.length}）</span>
        <button className="btn" onClick={() => void refreshRecent()} disabled={loadingRecent} style={{ padding: '2px 8px', fontSize: 12 }}>
          {loadingRecent ? '刷新中…' : '刷新'}
        </button>
      </div>

      {recent.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: 12 }}>
          {loadingRecent ? '加载中…' : '暂无生词'}
        </p>
      ) : (
        recent.map((v) => (
          <div className="draft-card" key={v.id} style={{ padding: 8, marginBottom: 6 }}>
            <div className="row-between" style={{ margin: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{v.word}</span>
                {v.pos && <span className="muted" style={{ marginLeft: 4 }}>[{v.pos}]</span>}
                <div style={{ fontSize: 12 }}>{v.translation}</div>
              </div>
              <div className="row" style={{ margin: 0, gap: 4 }}>
                {supportSpeech && (
                  <>
                    <button
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 12 }}
                      onClick={() => speak(v.word, v.sourceLang || undefined)}
                      title="朗读原文"
                    >
                      🔊
                    </button>
                    <button
                      className="btn"
                      style={{ padding: '2px 6px', fontSize: 12 }}
                      onClick={() => speak(v.translation, v.targetLang)}
                      title="朗读译文"
                    >
                      译
                    </button>
                  </>
                )}
                <button
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 12 }}
                  onClick={() => void toggle(v, 'starred')}
                  title={v.starred ? '取消收藏' : '收藏'}
                >
                  {v.starred ? '★' : '☆'}
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 12 }}
                  onClick={() => void toggle(v, 'mastered')}
                  title={v.mastered ? '取消掌握' : '标记掌握'}
                >
                  {v.mastered ? '✓' : '○'}
                </button>
                <button
                  className="btn"
                  style={{ padding: '2px 6px', fontSize: 12 }}
                  onClick={() => void remove(v)}
                  title="删除"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
