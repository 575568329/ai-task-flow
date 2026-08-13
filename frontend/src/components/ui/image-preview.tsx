// frontend/src/components/ui/image-preview.tsx
// 图片预览:全局 previewStore 驱动(open(src)/close)。
// 用 YARL(Yet Another React Lightbox)渲染,自带:点 backdrop/ESC 关闭、滚轮缩放、双击缩放、
// 拖拽平移、捏合手势、右上关闭按钮。此前手写蒙版在层级/居中/点击穿透上反复踩坑,弃用。
//
// P2-23 懒加载:Lightbox + Zoom 插件动态 import,首屏(无预览)不加载 Lightbox 库。
// styles.css 保持静态(小,且动态 CSS import 不可靠)。
//
// 关键坑(库也躲不掉):YARL 蒙版 portal 到 document.body,不在任何 Radix Dialog 的 content 树内,
// 点击它会被 Radix 判定为"点 Dialog 外部"而连带关闭抽屉。该问题必须在 Radix 这一端解决——
// 见 TaskDrawer.tsx 的 SheetContent:预览打开时 onInteractOutside/onEscapeKeyDown preventDefault。
import 'yet-another-react-lightbox/styles.css';
import { useEffect, useState } from 'react';
import { usePreviewStore } from '@/stores/previewStore';

type LightboxComp = typeof import('yet-another-react-lightbox').default;
type ZoomPlugin = typeof import('yet-another-react-lightbox/plugins/zoom').default;

// 模块级缓存:Lightbox + Zoom 只加载一次
let lazyPromise: Promise<{ Lightbox: LightboxComp; Zoom: ZoomPlugin }> | null = null;
function loadLightbox() {
  if (!lazyPromise) {
    lazyPromise = Promise.all([
      import('yet-another-react-lightbox'),
      import('yet-another-react-lightbox/plugins/zoom'),
    ]).then(([lb, zoom]) => ({ Lightbox: lb.default, Zoom: zoom.default }));
  }
  return lazyPromise;
}

export function ImagePreviewOverlay() {
  const src = usePreviewStore((s) => s.src);
  const close = usePreviewStore((s) => s.close);
  const [lazy, setLazy] = useState<{ Lightbox: LightboxComp; Zoom: ZoomPlugin } | null>(null);

  // 仅在首次 open 时加载 Lightbox 库(首屏无预览 → 不加载,减小首屏 bundle)
  useEffect(() => {
    if (src && !lazy) {
      let cancelled = false;
      loadLightbox().then((l) => {
        if (!cancelled) setLazy(l);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [src, lazy]);

  if (!lazy) return null;
  const { Lightbox, Zoom } = lazy;

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
