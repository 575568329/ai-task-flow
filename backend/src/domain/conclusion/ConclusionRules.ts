import { randomUUID } from 'node:crypto';
import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionCodeRef,
  ConclusionCreateRequest,
  ConclusionPatchRequest,
  ConclusionRevision,
  ConclusionSource,
  ProblemScope,
} from '@ai-task-flow/shared';
import {
  ConclusionConflictError,
  ConclusionValidationError,
} from './errors.js';

const NAME_MAX = 60;
const TITLE_MAX = 200;
const SECTION_MAX = 100_000;
const CHANGE_NOTE_MAX = 1_000;
const TAG_MAX = 20;

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newConclusionId(): string {
  return `c_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function requiredText(value: string | undefined, label: string, max = SECTION_MAX): string {
  const text = value?.trim() ?? '';
  if (!text) throw new ConclusionValidationError(`${label}不能为空`);
  if (text.length > max) throw new ConclusionValidationError(`${label}长度不能超过 ${max}`);
  return text;
}

function optionalText(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length > SECTION_MAX) throw new ConclusionValidationError(`${label}长度不能超过 ${SECTION_MAX}`);
  return value;
}

function validateName(value: string | undefined, label: string): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  if (text.includes('/')) throw new ConclusionValidationError(`${label}不能包含 "/"`);
  if (text.length > NAME_MAX) throw new ConclusionValidationError(`${label}长度不能超过 ${NAME_MAX}`);
  return text;
}

export function validateScope(
  scope: ProblemScope | undefined,
  project?: string,
  version?: string,
): { project?: string; version?: string } {
  if (scope !== 'project' && scope !== 'personal') {
    throw new ConclusionValidationError('scope 必须为 project 或 personal');
  }
  const p = validateName(project, '项目名');
  const v = validateName(version, '版本名');
  if (scope === 'personal') {
    if (p) throw new ConclusionValidationError('个人问题不能填写项目');
    if (v) throw new ConclusionValidationError('个人问题不能填写版本');
    return {};
  }
  if (!p) throw new ConclusionValidationError('项目问题必须填写项目名');
  return { project: p, version: v };
}

function validateTags(tags?: string[]): string[] | undefined {
  if (tags === undefined) return undefined;
  if (!Array.isArray(tags)) throw new ConclusionValidationError('tags 必须为字符串数组');
  const normalized = tags.map((t) => String(t).trim()).filter(Boolean);
  if (normalized.length > TAG_MAX) throw new ConclusionValidationError(`标签不能超过 ${TAG_MAX} 个`);
  return normalized.length ? normalized : undefined;
}

function validateCodeRefs(refs?: ConclusionCodeRef[]): ConclusionCodeRef[] | undefined {
  if (refs === undefined) return undefined;
  if (!Array.isArray(refs)) throw new ConclusionValidationError('codeRefs 必须为数组');
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object' || typeof ref.path !== 'string' || !ref.path.trim()) {
      throw new ConclusionValidationError('codeRefs 每项必须包含非空 path');
    }
    return { ...ref, path: ref.path.trim() };
  });
}

export function validateDate(date: string | undefined): string {
  const value = date?.trim() || localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConclusionValidationError('date 必须为 YYYY-MM-DD 格式');
  }
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
    throw new ConclusionValidationError('date 不是合法日期');
  }
  return value;
}

function normalizeTitle(title: string | undefined): string {
  return requiredText(title, '标题', TITLE_MAX);
}

function resolveMeta(
  current: Pick<Conclusion, 'scope' | 'project' | 'version'>,
  patch: { scope?: ProblemScope; project?: string; version?: string },
): Pick<Conclusion, 'scope' | 'project' | 'version'> {
  const scope = patch.scope ?? current.scope;
  const project = patch.project !== undefined
    ? patch.project
    : scope === 'personal' ? undefined : current.project;
  const version = patch.version !== undefined
    ? patch.version
    : scope === 'personal' ? undefined : current.version;
  return { scope, ...validateScope(scope, project, version) };
}

export function createConclusion(
  input: ConclusionCreateRequest,
  source: ConclusionSource,
  now = Date.now(),
): Conclusion {
  const meta = validateScope(input.scope, input.project, input.version);
  const conversationId = source.conversationId?.trim() || undefined;
  const conversationName = input.conversationName?.trim() || source.conversationName?.trim() || undefined;
  const revisionSource: ConclusionSource = { ...source };
  if (conversationId) revisionSource.conversationId = conversationId;
  else delete revisionSource.conversationId;
  if (conversationName) revisionSource.conversationName = conversationName;
  else delete revisionSource.conversationName;

  const revision: ConclusionRevision = {
    rev: 1,
    decision: requiredText(input.decision, '结论/决策'),
    data: optionalText(input.data, '关键数据'),
    openItems: optionalText(input.openItems, '待办/未决'),
    codeRefs: validateCodeRefs(input.codeRefs),
    changeNote: input.changeNote
      ? requiredText(input.changeNote, '变更说明', CHANGE_NOTE_MAX)
      : undefined,
    source: revisionSource,
    date: validateDate(input.date),
    createdAt: now,
  };
  return {
    id: newConclusionId(),
    scope: input.scope,
    project: meta.project,
    version: meta.version,
    conversationId,
    conversationName,
    title: normalizeTitle(input.title),
    tags: validateTags(input.tags),
    revisions: [revision],
    createdAt: now,
    updatedAt: now,
  };
}

/** 旧数据/人工先建的卡没有卡片级归属，从第一版带 ID 的 revision 回填。 */
export function ensureConversationOwner(conclusion: Conclusion): void {
  if (conclusion.conversationId) {
    if (!conclusion.conversationName) {
      const name = conclusion.revisions
        .find((r) => r.source.conversationName?.trim())
        ?.source.conversationName?.trim();
      if (name) conclusion.conversationName = name;
    }
    return;
  }
  const firstWithId = conclusion.revisions.find((r) => r.source.conversationId?.trim())?.source;
  if (!firstWithId?.conversationId) return;
  conclusion.conversationId = firstWithId.conversationId.trim();
  if (firstWithId.conversationName?.trim()) {
    conclusion.conversationName = firstWithId.conversationName.trim();
  }
}

export function appendRevision(
  conclusion: Conclusion,
  input: ConclusionAppendRequest,
  source: ConclusionSource,
  now = Date.now(),
): ConclusionRevision {
  const latest = conclusion.revisions[conclusion.revisions.length - 1];
  if (!latest) throw new ConclusionValidationError('结论卡没有历史版本');
  ensureConversationOwner(conclusion);
  if (input.expectedRev !== undefined && input.expectedRev !== latest.rev) {
    throw new ConclusionConflictError(
      `版本已更新：期望 rev ${input.expectedRev}，当前 rev ${latest.rev}`,
    );
  }

  // 默认一对话一卡：归属看卡片级 owner，而不是 latest——
  // 否则一次人工编辑（无 conversationId）就会把边界重置。
  const ownerConversationId = conclusion.conversationId;
  const incomingConversationId = source.conversationId?.trim() || undefined;
  if (
    !input.allowCrossConversation
    && ownerConversationId
    && incomingConversationId
    && ownerConversationId !== incomingConversationId
  ) {
    throw new ConclusionConflictError(
      `该结论卡属于对话 ${ownerConversationId}，当前对话是 ${incomingConversationId}。`
      + '默认一对话一卡，请新建结论卡；如确认要在同一张卡跨对话续写，请显式传 allowCrossConversation=true。',
    );
  }

  // 人工先建的卡还没有归属：第一次由 AI 追加时补上（人工编辑不会改变已有归属）。
  if (!conclusion.conversationId && incomingConversationId) {
    conclusion.conversationId = incomingConversationId;
    if (source.conversationName?.trim()) {
      conclusion.conversationName = source.conversationName.trim();
    }
  }

  const changeNote = requiredText(input.changeNote, '变更说明', CHANGE_NOTE_MAX);
  const beforeMeta = JSON.stringify({
    scope: conclusion.scope,
    project: conclusion.project,
    version: conclusion.version,
    title: conclusion.title,
    tags: conclusion.tags,
  });

  const meta = resolveMeta(conclusion, input);
  conclusion.scope = meta.scope;
  conclusion.project = meta.project;
  conclusion.version = meta.version;
  if (input.title !== undefined) conclusion.title = normalizeTitle(input.title);
  if (input.tags !== undefined) conclusion.tags = validateTags(input.tags);

  const afterMeta = JSON.stringify({
    scope: conclusion.scope,
    project: conclusion.project,
    version: conclusion.version,
    title: conclusion.title,
    tags: conclusion.tags,
  });
  const metaChanged = beforeMeta !== afterMeta;

  const merged = {
    decision: input.decision !== undefined
      ? requiredText(input.decision, '结论/决策')
      : latest.decision,
    data: input.data !== undefined ? optionalText(input.data, '关键数据') : latest.data,
    openItems: input.openItems !== undefined ? optionalText(input.openItems, '待办/未决') : latest.openItems,
    codeRefs: input.codeRefs !== undefined ? validateCodeRefs(input.codeRefs) : latest.codeRefs,
  };
  const contentChanged = (['decision', 'data', 'openItems', 'codeRefs'] as const)
    .some((key) => JSON.stringify(merged[key]) !== JSON.stringify(latest[key]));
  if (!contentChanged && !metaChanged) {
    throw new ConclusionValidationError('没有任何变化，未生成新版本');
  }

  const revisionConversationName = input.conversationName?.trim() || source.conversationName?.trim() || undefined;
  const revisionSource: ConclusionSource = { ...source };
  if (incomingConversationId) revisionSource.conversationId = incomingConversationId;
  else delete revisionSource.conversationId;
  if (revisionConversationName) revisionSource.conversationName = revisionConversationName;
  else delete revisionSource.conversationName;

  const revision: ConclusionRevision = {
    rev: latest.rev + 1,
    decision: merged.decision,
    data: merged.data,
    openItems: merged.openItems,
    codeRefs: merged.codeRefs,
    changeNote,
    source: revisionSource,
    date: validateDate(input.date),
    createdAt: now,
  };
  if (revision.data === '') delete revision.data;
  if (revision.openItems === '') delete revision.openItems;
  if (revision.codeRefs && revision.codeRefs.length === 0) delete revision.codeRefs;

  conclusion.revisions.push(revision);
  conclusion.updatedAt = now;
  return revision;
}

export function patchConclusionMeta(conclusion: Conclusion, patch: ConclusionPatchRequest): void {
  const meta = resolveMeta(conclusion, patch);
  conclusion.scope = meta.scope;
  conclusion.project = meta.project;
  conclusion.version = meta.version;
  if (patch.title !== undefined) conclusion.title = normalizeTitle(patch.title);
  if (patch.tags !== undefined) conclusion.tags = validateTags(patch.tags);
  conclusion.updatedAt = Date.now();
}
