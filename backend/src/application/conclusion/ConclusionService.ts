// 结论卡应用服务:HTTP 与 MCP 的唯一业务入口。
// 事务边界:所有「读-改-写」都在 repo.mutate 内完成(文件锁内重读 + 原子写),
// 因此 next rev 必须在回调内计算,禁止 load() → 改 → 另起 save。
import type {
  Conclusion,
  ConclusionAppendRequest,
  ConclusionAppendResponse,
  ConclusionCreateRequest,
  ConclusionCreateResponse,
  ConclusionData,
  ConclusionDetail,
  ConclusionPatchRequest,
  ConclusionQueryRequest,
  ConclusionRecordRequest,
  ConclusionRecordResponse,
  ConclusionRevision,
  ConclusionSource,
  ConclusionSummary,
} from '@ai-task-flow/shared';
import type { ConclusionRepository } from '../../domain/conclusion/repositories/ConclusionRepository.js';
import {
  appendRevision,
  createConclusion,
  ensureConversationOwner,
  patchConclusionMeta,
} from '../../domain/conclusion/ConclusionRules.js';
import { ConclusionNotFoundError } from '../../domain/conclusion/errors.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const EXCERPT_LENGTH = 1500;

function excerpt(text: string): string {
  return text.length <= EXCERPT_LENGTH ? text : `${text.slice(0, EXCERPT_LENGTH)}…`;
}

function findConclusion(data: ConclusionData, cardId: string): Conclusion {
  const card = data.conclusions.find((c) => c.id === cardId);
  if (!card) throw new ConclusionNotFoundError(`结论卡 ${cardId} 不存在`);
  return card;
}

function revisionMatches(revision: ConclusionRevision, keyword: string): boolean {
  const haystack = [
    revision.decision,
    revision.data,
    revision.openItems,
    revision.changeNote,
    ...(revision.codeRefs?.map((ref) => ref.path) ?? []),
  ].filter(Boolean).join('\n').toLowerCase();
  return haystack.includes(keyword);
}

function latestOf(card: Conclusion): ConclusionRevision {
  const latest = card.revisions[card.revisions.length - 1];
  if (!latest) throw new ConclusionNotFoundError(`结论卡 ${card.id} 没有历史版本`);
  return latest;
}

/** 一对话一卡：按卡片归属找当前会话的卡；旧数据先回填归属。 */
function findConversationCard(data: ConclusionData, conversationId: string): Conclusion | undefined {
  let best: Conclusion | undefined;
  for (const card of data.conclusions) {
    ensureConversationOwner(card);
    if (card.conversationId !== conversationId) continue;
    if (!best || card.updatedAt > best.updatedAt) best = card;
  }
  return best;
}

export class ConclusionService {
  constructor(private readonly repo: ConclusionRepository) {}

  async create(
    input: ConclusionCreateRequest,
    source: ConclusionSource,
  ): Promise<ConclusionCreateResponse> {
    return this.repo.mutate((data) => {
      const card = createConclusion(input, source);
      data.conclusions.push(card);
      return {
        id: card.id,
        rev: 1,
        path: `${card.project ?? '个人'}/${card.title}#1`,
      };
    });
  }

  /**
   * MCP 自动写入入口：不传 cardId 时按当前会话自动 upsert。
   * 同一会话已有卡 → 追加新版；没有 → 新建。查找/创建/追加全部在文件锁内完成。
   */
  async record(
    input: ConclusionRecordRequest,
    source: ConclusionSource,
  ): Promise<ConclusionRecordResponse> {
    return this.repo.mutate((data) => {
      const conversationId = source.conversationId?.trim();
      const existing = conversationId ? findConversationCard(data, conversationId) : undefined;

      if (!existing) {
        const card = createConclusion({
          scope: input.scope ?? (input.project ? 'project' : 'personal'),
          project: input.project,
          version: input.version,
          title: input.title ?? '',
          tags: input.tags,
          decision: input.decision ?? '',
          data: input.data,
          openItems: input.openItems,
          codeRefs: input.codeRefs,
          date: input.date,
          changeNote: input.changeNote,
          conversationName: input.conversationName,
          stage: input.stage,
          projectId: input.projectId,
          relatedProjectIds: input.relatedProjectIds,
          relatedProjects: input.relatedProjects,
        }, source);
        data.conclusions.push(card);
        return {
          id: card.id,
          rev: 1,
          path: `${card.project ?? '个人'}/${card.title}#1`,
          created: true,
        };
      }

      const revision = appendRevision(existing, {
        expectedRev: input.expectedRev,
        allowCrossConversation: input.allowCrossConversation,
        scope: input.scope,
        project: input.project,
        version: input.version,
        title: input.title,
        tags: input.tags,
        decision: input.decision,
        data: input.data,
        openItems: input.openItems,
        codeRefs: input.codeRefs,
        date: input.date,
        changeNote: input.changeNote ?? '',
        conversationName: input.conversationName,
        stage: input.stage,
        projectId: input.projectId,
        relatedProjectIds: input.relatedProjectIds,
        relatedProjects: input.relatedProjects,
      }, source);
      return {
        id: existing.id,
        rev: revision.rev,
        path: `${existing.project ?? '个人'}/${existing.title}#${revision.rev}`,
        created: false,
      };
    });
  }

  async append(
    cardId: string,
    input: ConclusionAppendRequest,
    source: ConclusionSource,
  ): Promise<ConclusionAppendResponse> {
    return this.repo.mutate((data) => {
      const card = findConclusion(data, cardId);
      const revision = appendRevision(card, input, source);
      return { id: card.id, rev: revision.rev };
    });
  }

  async patch(cardId: string, input: ConclusionPatchRequest): Promise<Conclusion> {
    return this.repo.mutate(
      (data) => {
        const card = findConclusion(data, cardId);
        patchConclusionMeta(card, input);
        return card;
      },
      { backup: true },
    );
  }

  async delete(cardId: string): Promise<{ deleted: true }> {
    await this.repo.mutate(
      (data) => {
        const index = data.conclusions.findIndex((c) => c.id === cardId);
        if (index < 0) throw new ConclusionNotFoundError(`结论卡 ${cardId} 不存在`);
        data.conclusions.splice(index, 1);
      },
      { backup: true },
    );
    return { deleted: true };
  }

  async get(cardId: string): Promise<Conclusion> {
    const data = await this.repo.load();
    const card = findConclusion(data, cardId);
    ensureConversationOwner(card);
    return card;
  }

  async getDetail(cardId: string, includeHistory = false): Promise<ConclusionDetail> {
    const card = await this.get(cardId);
    const latest = latestOf(card);
    return {
      id: card.id,
      scope: card.scope,
      project: card.project,
      version: card.version,
      conversationId: card.conversationId,
      conversationName: card.conversationName,
      title: card.title,
      tags: card.tags,
      rev: latest.rev,
      stage: latest.stage,
      projectId: card.projectId,
      relatedProjects: card.relatedProjects,
      relatedProjectIds: card.relatedProjectIds,
      latest,
      revisions: card.revisions.map((revision) => ({
        rev: revision.rev,
        date: revision.date,
        changeNote: revision.changeNote,
        createdAt: revision.createdAt,
        tool: revision.source.tool,
        conversationId: revision.source.conversationId,
        conversationName: revision.source.conversationName,
        stage: revision.stage,
      })),
      ...(includeHistory ? { history: card.revisions } : {}),
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
  }

  async query(input: ConclusionQueryRequest): Promise<ConclusionSummary[]> {
    const data = await this.repo.load();
    const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const keyword = input.keyword?.trim().toLowerCase();

    const matches: Array<{
      card: Conclusion;
      latest: ConclusionRevision;
      matchedRev?: number;
    }> = [];

    for (const card of data.conclusions) {
      ensureConversationOwner(card);
      if (input.cardId && card.id !== input.cardId) continue;
      if (input.scope && card.scope !== input.scope) continue;
      if (input.project && card.project !== input.project) continue;
      if (input.version && card.version !== input.version) continue;
      if (input.tags?.length && !card.tags?.some((tag) => input.tags!.includes(tag))) continue;

      const latest = latestOf(card);
      if (input.stage && latest.stage !== input.stage) continue;
      if (input.dateFrom && latest.date < input.dateFrom) continue;
      if (input.dateTo && latest.date > input.dateTo) continue;

      let matchedRev: number | undefined;
      if (keyword) {
        const inTitle = card.title.toLowerCase().includes(keyword);
        const matched = card.revisions.filter((revision) => revisionMatches(revision, keyword));
        if (!inTitle && matched.length === 0) continue;
        // 摘要本身已展示最新版内容,matchedRev 只用于提示「命中历史版本」
        const newestMatch = matched[matched.length - 1];
        if (newestMatch && newestMatch.rev !== latest.rev) matchedRev = newestMatch.rev;
      }

      matches.push({ card, latest, matchedRev });
    }

    return matches
      .sort((a, b) =>
        b.latest.date.localeCompare(a.latest.date) || b.card.updatedAt - a.card.updatedAt)
      .slice(0, limit)
      .map(({ card, latest, matchedRev }) => ({
        id: card.id,
        scope: card.scope,
        project: card.project,
        version: card.version,
        title: card.title,
        tags: card.tags,
        rev: latest.rev,
        projectId: card.projectId,
        relatedProjects: card.relatedProjects,
        relatedProjectIds: card.relatedProjectIds,
        latestDate: latest.date,
        latestDecisionExcerpt: excerpt(latest.decision),
        stage: latest.stage,
        source: {
          tool: latest.source.tool,
          conversationId: card.conversationId ?? latest.source.conversationId,
          conversationName: card.conversationName ?? latest.source.conversationName,
        },
        matchedRev,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      }));
  }
}
