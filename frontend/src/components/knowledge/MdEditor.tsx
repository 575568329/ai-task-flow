// frontend/src/components/knowledge/MdEditor.tsx
// Markdown 编辑器:CodeMirror 6 封装(经 @uiw/react-codemirror)。
// 选 CM6 而非 WYSIWYG:md 由 agent+人共写,含 frontmatter / [[wiki]] 双链,
// 纯文本编辑零破坏、保真。受控组件,EditorState/View 生命周期与卸载 cleanup 交 @uiw 管理。
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';

interface MdEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function MdEditor({ value, onChange }: MdEditorProps) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      // markdown 语言(基础语法 + 通用扩展),长行换行更符合笔记编辑习惯
      extensions={[markdown({ base: markdownLanguage }), EditorView.lineWrapping]}
      height="100%"
      className="h-full text-sm"
    />
  );
}
