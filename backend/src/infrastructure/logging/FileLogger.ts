// backend/src/infrastructure/logging/FileLogger.ts
// 轻量文件日志器:把关键链路(如聊天/LLM 调用)的全量日志追加到数据目录 logs/ 下,
// 同时镜像到 console,方便实时观察与事后排查。
// 设计取舍(KISS):不引第三方日志库,同步 appendFileSync 足够 MVP;
// 单文件按需创建,失败降级到仅 console,绝不因日志异常影响主流程。
import fs from 'node:fs';
import path from 'node:path';
import { logsDirPath } from '../../config/dataDir.js';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** 敏感字段脱敏:apiKey/authorization 仅保留首尾,中间打码 */
function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-2)}`;
}

export class FileLogger {
  private readonly logFile: string;
  private dirReady = false;

  /**
   * @param moduleName 模块标签,出现在每行日志前缀,如 'chat'
   * @param fileName   日志文件名,默认 {module}.log
   */
  constructor(
    private readonly moduleName: string,
    fileName?: string,
  ) {
    this.logFile = path.join(logsDirPath(), fileName ?? `${moduleName}.log`);
  }

  /** 懒创建日志目录;失败只告警一次,不阻断 */
  private ensureDir(): void {
    if (this.dirReady) return;
    try {
      fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
      this.dirReady = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[logger] 无法创建日志目录,降级为仅 console: ${message}`);
    }
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level}] [${this.moduleName}] ${message}${metaStr}`;

    // 1. 镜像到 console(沿用级别)
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);

    // 2. 追加到文件(失败不抛,避免日志拖垮主流程)
    this.ensureDir();
    if (!this.dirReady) return;
    try {
      fs.appendFileSync(this.logFile, line + '\n', 'utf-8');
    } catch {
      // 落盘失败已在 console 留痕,静默
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('INFO', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('WARN', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('ERROR', message, meta);
  }
}

/** 脱敏工具导出,供调用方记录请求头等 */
export { maskSecret };
