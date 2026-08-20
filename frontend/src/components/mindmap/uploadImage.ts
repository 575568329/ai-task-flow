// frontend/src/components/mindmap/uploadImage.ts
// 画布图片上传助手：复用 /api/upload/image（与 StepEditor 同一接口），
// 并从图片自然尺寸播种节点宽高（锁定宽高比，宽超 400px 等比缩到 400）。
import { API_BASE } from '@/api/base';

/** 默认展示宽度上限（px），超出按比例缩小 */
const MAX_DISPLAY_WIDTH = 400;

export interface UploadedImage {
  url: string;
  width: number;
  height: number;
}

/** 读图片自然尺寸（加载失败退回 240x160） */
function probeImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 240, height: 160 });
    img.src = url;
  });
}

/**
 * 上传图片文件并返回展示尺寸。非图片或上传失败返回 null。
 */
export async function uploadImageFile(file: File): Promise<UploadedImage | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/upload/image`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { url: string };
    // uTools 包形态(file://)相对路径 img src 不可用,统一拼绝对地址;同源形态 API_BASE 为空串等效相对
    const absUrl = `${API_BASE}${data.url}`;
    const natural = await probeImageSize(absUrl);
    const scale = Math.min(1, MAX_DISPLAY_WIDTH / Math.max(natural.width, 1));
    return {
      url: absUrl,
      width: Math.round(natural.width * scale),
      height: Math.round(natural.height * scale),
    };
  } catch (error) {
    console.error('[canvas] uploadImageFile failed:', error);
    return null;
  }
}
