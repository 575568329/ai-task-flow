// frontend/src/components/ui/ConfirmDialog.tsx
import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** 危险操作:确认按钮用红色 */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 通用确认弹窗(删除等不可逆操作二次确认)
 * 复用 Modal + Button,符合 Spark 规范(禁止用 window.confirm)。
 */
export function ConfirmDialog({
  open,
  title = '确认操作',
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelText}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmText}
          </Button>
        </>
      }
    >
      <div style={{ color: 'var(--text-2)', lineHeight: 1.6 }}>{message}</div>
    </Modal>
  );
}
