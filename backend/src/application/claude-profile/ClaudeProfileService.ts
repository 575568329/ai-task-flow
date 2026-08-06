// backend/src/application/claude-profile/ClaudeProfileService.ts
// Claude Code settings.json 多套配置的增删改 + 一键切换。
//
// 切换语义:整份覆盖目标 settings.json,覆盖前先备份到 ~/.ai-task-flow/claude-settings-backups/。
// 写入 WSL 目标时把 hooks command 里的 Windows 绝对路径转成 /mnt 形态(否则 hook 静默失败)。
//
// ⚠️ profile 的 settings 是含密钥的明文快照:本服务对外只返回 summarize 后的脱敏视图,
// 唯一的明文出口是 applyProfile 写入目标文件(那是用户自己的 settings.json)。
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileLogger } from '../../infrastructure/logging/FileLogger.js';
import { claudeSettingsBackupDirPath } from '../../config/dataDir.js';
import {
  JsonClaudeProfileRepository,
  type StoredClaudeProfile,
} from '../../infrastructure/persistence/JsonClaudeProfileRepository.js';
import {
  findClaudeSettingsTarget,
  listClaudeSettingsTargets,
} from '../../infrastructure/system/ClaudeSettingsTargetResolver.js';
import {
  isPlainSettingsObject,
  materializeForSide,
  settingsIdentity,
  stableStringify,
  summarizeSettings,
  type ClaudeSettings,
} from '../../domain/claude-profile/settingsCodec.js';
import type {
  ClaudeProfileApplyResponse,
  ClaudeProfileListResponse,
  ClaudeProfileSummary,
  ClaudeSettingsTarget,
} from '@ai-task-flow/shared';

const logger = new FileLogger('claude-profile');

/** profile 名长度上限(纯展示用,防止 UI 被超长名撑爆) */
const MAX_NAME_LENGTH = 60;

/** 入参不合法(名称空、JSON 非对象等),路由映射 400 */
export class ClaudeProfileValidationError extends Error {}
/** profile 或目标不存在,路由映射 404 */
export class ClaudeProfileNotFoundError extends Error {}

export class ClaudeProfileService {
  constructor(private readonly repository: JsonClaudeProfileRepository) {}

  /** 可切换的目标列表(WSL 各 distro + Windows) */
  listTargets(): ClaudeSettingsTarget[] {
    return listClaudeSettingsTargets();
  }

  /**
   * 列出 profile(脱敏)+ 判定哪个当前生效。
   * @param targetKey 省略则取第一个目标(通常是 Windows 侧)
   */
  async list(targetKey?: string): Promise<ClaudeProfileListResponse> {
    const target = this.resolveTarget(targetKey);
    const stored = await this.repository.findAll();
    const activeProfileId = await this.detectActiveProfile(target, stored);

    return {
      profiles: stored.map((profile) => this.toSummary(profile)),
      activeProfileId,
      target,
    };
  }

  /** 粘贴整份 settings JSON 新建 profile */
  async create(name: string, settings: unknown): Promise<ClaudeProfileSummary> {
    const profile: StoredClaudeProfile = {
      id: randomUUID(),
      name: this.validateName(name),
      settings: this.validateSettings(settings),
      apiPresets: [],
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(profile);
    logger.info('新建 profile', { id: profile.id, name: profile.name });
    return this.toSummary(profile);
  }

  /**
   * 从某目标现有的 settings.json 导入为 profile。
   * 明文全程不经过前端——这是记录当前配置的首选路径。
   */
  async importFromTarget(name: string, targetKey: string): Promise<ClaudeProfileSummary> {
    const target = this.resolveTarget(targetKey);
    if (!target.exists) {
      throw new ClaudeProfileValidationError(`${target.label} 下还没有 settings.json,无法导入`);
    }

    let settings: unknown;
    try {
      settings = JSON.parse(await fs.readFile(target.path, 'utf-8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ClaudeProfileValidationError(`读取 ${target.path} 失败: ${message}`);
    }

    const profile: StoredClaudeProfile = {
      id: randomUUID(),
      name: this.validateName(name),
      settings: this.validateSettings(settings),
      apiPresets: [],
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(profile);
    logger.info('从目标导入 profile', {
      id: profile.id,
      name: profile.name,
      targetKey: target.key,
    });
    return this.toSummary(profile);
  }

  /** 改名 / 换内容 / 更新 API 预设(apiPresets 省略表示不改动) */
  async update(
    id: string,
    changes: { name?: string; settings?: unknown; apiPresets?: unknown },
  ): Promise<ClaudeProfileSummary> {
    const existing = await this.requireProfile(id);
    const updated: StoredClaudeProfile = {
      ...existing,
      name: changes.name === undefined ? existing.name : this.validateName(changes.name),
      settings:
        changes.settings === undefined ? existing.settings : this.validateSettings(changes.settings),
      apiPresets: Array.isArray(changes.apiPresets) ? changes.apiPresets : existing.apiPresets,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(updated);
    logger.info('更新 profile', { id, name: updated.name });
    return this.toSummary(updated);
  }

  async remove(id: string): Promise<void> {
    await this.requireProfile(id);
    await this.repository.delete(id);
    logger.info('删除 profile', { id });
  }

  /**
   * 一键切换:备份目标现有 settings.json,再整份写入 profile 内容。
   *
   * 注意:Claude Code 只在启动时读 settings.json,已开的会话不受影响——
   * 调用方(前端)必须提示「新开终端生效」。
   */
  async applyProfile(id: string, targetKey: string): Promise<ClaudeProfileApplyResponse> {
    const profile = await this.requireProfile(id);
    const target = this.resolveTarget(targetKey);

    const backupPath = await this.backupTarget(target);
    const { settings, rewritten } = materializeForSide(profile.settings, target.side);

    await fs.mkdir(path.dirname(target.path), { recursive: true });
    await fs.writeFile(target.path, `${JSON.stringify(settings, null, 2)}\n`, 'utf-8');

    logger.info('应用 profile', {
      id,
      name: profile.name,
      targetKey: target.key,
      targetPath: target.path,
      backupPath,
      rewrittenPaths: rewritten,
    });

    return {
      ok: true,
      backupPath,
      rewrittenPaths: rewritten,
      // 刚写完,文件必然存在:回一份最新的 target 供前端直接刷新状态
      target: { ...target, exists: true },
    };
  }

  /**
   * 备份目标现有文件到 claude-settings-backups/<key>-<时间戳>.json。
   * 文件不存在(首次写入)返回 null。备份失败直接抛——宁可切换失败,也不能无退路地覆盖。
   */
  private async backupTarget(target: ClaudeSettingsTarget): Promise<string | null> {
    let original: string;
    try {
      original = await fs.readFile(target.path, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    const backupDir = claudeSettingsBackupDirPath();
    await fs.mkdir(backupDir, { recursive: true });
    // ISO 里的 : 在 Windows 文件名非法,统一换成 -
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `${target.key}-${stamp}.json`);
    await fs.writeFile(backupPath, original, 'utf-8');
    return backupPath;
  }

  /**
   * 判定哪个 profile 是当前生效的。两级匹配:
   *  1) 整份内容精确比对(materializeForSide + stableStringify):与实际写入算同一份内容、
   *     忽略键序/缩进差异,切完立刻命中;
   *  2) 兜底按「API 身份」(model+baseURL+token)比对:Claude Code 常自行往 settings.json
   *     加 hooks/权限/格式化字段,整份比对会失配,但用户关心的「用的是哪套 API 配置」
   *     由这三项决定,据此仍能认出当前配置。
   */
  private async detectActiveProfile(
    target: ClaudeSettingsTarget,
    profiles: StoredClaudeProfile[],
  ): Promise<string | null> {
    let current: unknown;
    try {
      current = JSON.parse(await fs.readFile(target.path, 'utf-8'));
    } catch {
      // 文件不存在 / 内容非法 JSON:无生效 profile
      return null;
    }
    if (!isPlainSettingsObject(current)) return null;

    // 1) 整份内容精确匹配(最严谨)
    const currentKey = stableStringify(current);
    for (const profile of profiles) {
      const { settings } = materializeForSide(profile.settings, target.side);
      if (stableStringify(settings) === currentKey) return profile.id;
    }

    // 2) 兜底:API 身份匹配(容忍 Claude Code 对无关字段的重写)
    const currentIdentity = settingsIdentity(current);
    if (!currentIdentity) return null; // 当前文件无 API 身份,无法辨识
    for (const profile of profiles) {
      if (settingsIdentity(profile.settings) === currentIdentity) return profile.id;
    }
    return null;
  }

  private toSummary(profile: StoredClaudeProfile): ClaudeProfileSummary {
    return {
      id: profile.id,
      name: profile.name,
      updatedAt: profile.updatedAt,
      ...summarizeSettings(profile.settings),
      settings: profile.settings,
      apiPresets: profile.apiPresets,
    };
  }

  private resolveTarget(targetKey?: string): ClaudeSettingsTarget {
    const targets = listClaudeSettingsTargets();
    if (targets.length === 0) {
      throw new ClaudeProfileNotFoundError('未探测到任何 Claude Code settings.json 目标');
    }
    if (!targetKey) return targets[0];

    const found = targets.find((target) => target.key === targetKey);
    if (!found) throw new ClaudeProfileNotFoundError(`目标不存在: ${targetKey}`);
    return found;
  }

  private async requireProfile(id: string): Promise<StoredClaudeProfile> {
    const profile = await this.repository.findById(id);
    if (!profile) throw new ClaudeProfileNotFoundError(`profile 不存在: ${id}`);
    return profile;
  }

  private validateName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) {
      throw new ClaudeProfileValidationError('配置名称不能为空');
    }
    const trimmed = name.trim();
    if (trimmed.length > MAX_NAME_LENGTH) {
      throw new ClaudeProfileValidationError(`配置名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
    }
    return trimmed;
  }

  private validateSettings(settings: unknown): ClaudeSettings {
    if (!isPlainSettingsObject(settings)) {
      throw new ClaudeProfileValidationError('settings 必须是一个 JSON 对象');
    }
    if (Object.keys(settings).length === 0) {
      throw new ClaudeProfileValidationError('settings 不能为空对象');
    }
    return settings;
  }
}
