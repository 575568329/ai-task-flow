// frontend/src/components/chat/CustomPromptPanel.tsx
// 会话级「自定义需求」编辑:追加到系统提示,每轮带上。updateConversation 持久化 + 本地 patch。
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/stores/chatStore';
import { updateConversation } from '@/api/chat';
import { toast } from '@/components/ui/Toaster';

interface CustomPromptPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string | null;
}

export function CustomPromptPanel({
  open,
  onOpenChange,
  conversationId,
}: CustomPromptPanelProps) {
  const conversations = useChatStore((s) => s.conversations);
  const patchConversation = useChatStore((s) => s.patchConversation);
  const conversation = conversations.find((c) => c.id === conversationId);

  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  // 打开或切换会话时同步当前值
  useEffect(() => {
    if (open) setValue(conversation?.customPrompt ?? '');
  }, [open, conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!conversationId) return;
    setSaving(true);
    try {
      await updateConversation(conversationId, { customPrompt: value });
      patchConversation(conversationId, { customPrompt: value });
      toast.success('自定义需求已保存');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>自定义需求</DialogTitle>
          <DialogDescription>
            为该对话追加系统提示,后续每轮都会带上。留空则不追加。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="如:用中文回答,侧重工程实践,给出可运行代码…"
          className="min-h-32"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
