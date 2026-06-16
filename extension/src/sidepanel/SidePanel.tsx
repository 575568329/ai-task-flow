// extension/src/sidepanel/SidePanel.tsx
import { useEffect, useState } from 'react';
import { VIEWS } from './views/registry.js';

const TAB_KEY = 'atf-sidepanel-tab';

export function SidePanel() {
  const [activeId, setActiveId] = useState<string>(VIEWS[0].id);

  // 记忆当前 Tab（chrome.storage）
  useEffect(() => {
    chrome.storage?.local
      .get(TAB_KEY)
      .then((r) => {
        if (r[TAB_KEY]) setActiveId(r[TAB_KEY] as string);
      })
      .catch(() => {});
  }, []);

  function switchTab(id: string) {
    setActiveId(id);
    chrome.storage?.local.set({ [TAB_KEY]: id }).catch(() => {});
  }

  const Active = VIEWS.find((v) => v.id === activeId)?.component ?? VIEWS[0].component;

  return (
    <div className="sp-root">
      <nav className="sp-tabs">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`sp-tab${activeId === v.id ? ' active' : ''}`}
            onClick={() => switchTab(v.id)}
          >
            {v.icon} {v.title}
          </button>
        ))}
      </nav>
      <main className="sp-main">
        <Active />
      </main>
      <footer className="sp-footer">AI Task Flow 剪藏 · 调用 localhost:3000</footer>
    </div>
  );
}
