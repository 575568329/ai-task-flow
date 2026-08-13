// frontend/src/components/knowledge/MdEditor.tsx
// Markdown 编辑器:CodeMirror 6 封装(经 @uiw/react-codemirror)。
// 选 CM6 而非 WYSIWYG:md 由 agent+人共写,含 frontmatter / [[wiki]] 双链,
// 纯文本编辑零破坏、保真。受控组件,EditorState/View 生命周期与卸载 cleanup 交 @uiw 管理。
//
// P2-23 懒加载:CodeMirror + lang-markdown + view 动态 import,避免 codemirror 进首屏 bundle
// (MdEditor 仅在知识库视图用,非首屏)。加载中用 textarea 占位(可编辑,加载后切 CM,value 受控同步)。
import { useEffect, useState } from 'react';

type CodeMirrorComp = typeof import('@uiw/react-codemirror').default;
type Extension = import('@codemirror/state').Extension;
interface CMLoaded {
  CodeMirror: CodeMirrorComp;
  extensions: Extension[];
}

// 模块级缓存:CodeMirror + 扩展只加载一次
let cmPromise: Promise<CMLoaded> | null = null;
function loadCM(): Promise<CMLoaded> {
  if (!cmPromise) {
    cmPromise = Promise.all([
      import('@uiw/react-codemirror'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/view'),
    ]).then(([cm, md, view]) => ({
      CodeMirror: cm.default,
      // markdown 语言(基础语法 + 通用扩展) + 长行换行
      extensions: [md.markdown({ base: md.markdownLanguage }), view.EditorView.lineWrapping],
    }));
  }
  return cmPromise;
}

interface MdEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function MdEditor({ value, onChange }: MdEditorProps) {
  const [cm, setCm] = useState<CMLoaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCM().then((loaded) => {
      if (!cancelled) setCm(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!cm) {
    // CodeMirror 加载中:textarea 占位(可编辑,value 受控同步,加载后无缝切 CM)
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full resize-none p-2 text-sm"
      />
    );
  }

  return (
    <cm.CodeMirror
      value={value}
      onChange={onChange}
      extensions={cm.extensions}
      height="100%"
      className="h-full text-sm"
    />
  );
}
