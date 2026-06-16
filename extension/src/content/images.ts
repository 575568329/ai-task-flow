// extension/src/content/images.ts
import type { ClipImage } from '@ai-task-flow/shared';

/** 单张图片 URL → base64 data URL；失败（跨域/CORS）抛错由调用方跳过 */
async function imgToBase64(src: string): Promise<string> {
  const response = await fetch(src);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error(`读取图片失败: ${src}`));
    reader.readAsDataURL(blob);
  });
}

/**
 * 采集 root 范围内的 <img>，按 DOM 顺序命名 img-1..N，fetch→base64。
 * 跨域/失败的单张跳过（不产生条目），不阻断整体采集（设计 §6）。
 * 名字按「原始 DOM 位置序号」给，失败图留空号 → manifest 不会误导 LLM 引用不存在的图。
 */
export async function collectImages(root: ParentNode): Promise<ClipImage[]> {
  const imgs = Array.from(root.querySelectorAll('img'));
  const seen = new Set<string>();
  const srcs: string[] = [];
  for (const img of imgs) {
    const src = img.currentSrc || img.src;
    if (src && !seen.has(src)) {
      seen.add(src);
      srcs.push(src);
    }
  }

  const settled = await Promise.all(
    srcs.map(async (src, index) => {
      try {
        return { name: `img-${index + 1}`, base64: await imgToBase64(src) } as ClipImage;
      } catch {
        return null; // 跨域/读取失败：跳过该图
      }
    }),
  );
  return settled.filter((x): x is ClipImage => x !== null);
}
