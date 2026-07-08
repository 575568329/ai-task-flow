// frontend/src/lib/speech.ts
// Web Speech API 封装。应对 Chromium speechSynthesis 已知坑:
// 1. 每次 speak 前 cancel() 清队列 —— 规避「播一次后再播失败」的 halting bug
// 2. 每次新建 SpeechSynthesisUtterance 实例(复用旧实例在部分浏览器会静默失败)
// 3. 长文本按句末标点分句逐段入队 —— 规避 Chromium #41084789 长文卡断
// 4. 按 BCP-47 lang 前缀匹配系统语音,提升朗读质量

/** 按 lang 匹配系统语音:精确 → 前缀 → 无 */
function pickVoiceByLang(lang: string): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const lower = lang.toLowerCase();
  const prefix = lower.split('-')[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === lower) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(prefix)) ??
    null
  );
}

/** 长文本(>200 字)按中英文句末标点切分;短文本原样返回 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= 200) return [trimmed];
  const parts = trimmed
    .split(/(?<=[.!?。!??…])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

/**
 * 朗读文本。lang 形如 'en'/'en-US'/'zh-CN',用于选语音。
 * 空文本或浏览器不支持时静默返回。
 */
export function speak(text: string, lang?: string): void {
  if (!text?.trim()) return;
  if (!isSpeechSupported()) return;

  speechSynthesis.cancel(); // 清队列:规避 halting bug

  for (const seg of splitSentences(text)) {
    const utter = new SpeechSynthesisUtterance(seg);
    if (lang) {
      utter.lang = lang;
      const voice = pickVoiceByLang(lang);
      if (voice) utter.voice = voice;
    }
    speechSynthesis.speak(utter);
  }
}

/** 停止朗读 */
export function stopSpeaking(): void {
  if (isSpeechSupported()) speechSynthesis.cancel();
}

/** 浏览器是否支持语音合成(SSR 安全) */
export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
