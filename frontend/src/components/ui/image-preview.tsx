// frontend/src/components/ui/image-preview.tsx
// 图片预览:全局 previewStore 驱动(open(src)/close)。
// 用成熟库 Yet Another React Lightbox(YARL)渲染,自带:点 backdrop/ESC 关闭、滚轮缩放、
// 双击缩放、拖拽平移、捏合手势、右上关闭按钮。此前手写蒙版在层级/居中/点击穿透上反复踩坑,弃用。
//
// 关键坑(库也躲不掉):YARL 蒙版 portal 到 document.body,不在任何 Radix Dialog 的 content 树内,
// 点击它会被 Radix 判定为"点 Dialog 外部"而连带关闭抽屉。该问题必须在 Radix 这一端解决——
// 见 TaskDrawer.tsx 的 SheetContent:预览打开时 onInteractOutside/onEscapeKeyDown preventDefault。
import Lightbox from 'yet-another-react-lightbox';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import { usePreviewStore } from '@/stores/previewStore';

export function ImagePreviewOverlay() {
  const src = usePreviewStore((s) => s.src);
  const close = usePreviewStore((s) => s.close);

  return (
    <Lightbox
      open={!!src}
      close={close}
      slides={src ? [{ src }] : []}
      index={0}
      plugins={[Zoom]}
      // 单图预览:禁用翻页,并隐藏上一张/下一张按钮。
      carousel={{ finite: true }}
      render={{ buttonPrev: () => null, buttonNext: () => null }}
      zoom={{ scrollToZoom: true, maxZoomPixelRatio: 5 }}
      labels={{ Close: '关闭(ESC)' }}
    />
  );
}
