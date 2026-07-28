// frontend/src/api/claudeProfile.ts
// Claude Code settings.json 多套配置切换的 API 封装
import { http } from './http';
import type {
  ClaudeSettingsTarget,
  ClaudeProfileSummary,
  ClaudeProfileListResponse,
  ClaudeProfileApplyResponse,
  ClaudeProfileCreateRequest,
  ClaudeProfileImportRequest,
  ClaudeProfileUpdateRequest,
} from '@ai-task-flow/shared';

/** GET /api/claude-profiles/targets — 可切换的目标列表 */
async function listTargets() {
  const res = await http.get<{ targets: ClaudeSettingsTarget[] }>('/claude-profiles/targets');
  return res.targets;
}

/** GET /api/claude-profiles?target=<key> — profile 列表 + 当前生效项 */
function list(targetKey?: string) {
  const query = targetKey ? `?target=${encodeURIComponent(targetKey)}` : '';
  return http.get<ClaudeProfileListResponse>(`/claude-profiles${query}`);
}

/** POST /api/claude-profiles — 粘贴 JSON 新建 */
function create(body: ClaudeProfileCreateRequest) {
  return http.post<ClaudeProfileSummary>('/claude-profiles', body);
}

/** POST /api/claude-profiles/import — 从目标文件导入(明文不经前端) */
function importFromTarget(body: ClaudeProfileImportRequest) {
  return http.post<ClaudeProfileSummary>('/claude-profiles/import', body);
}

/** PUT /api/claude-profiles/:id — 改名 / 换内容 */
function update(id: string, body: ClaudeProfileUpdateRequest) {
  return http.put<ClaudeProfileSummary>(`/claude-profiles/${encodeURIComponent(id)}`, body);
}

/** DELETE /api/claude-profiles/:id */
function remove(id: string) {
  return http.delete(`/claude-profiles/${encodeURIComponent(id)}`);
}

/** POST /api/claude-profiles/:id/apply — 一键切换 */
function apply(id: string, targetKey: string) {
  return http.post<ClaudeProfileApplyResponse>(`/claude-profiles/${encodeURIComponent(id)}/apply`, {
    targetKey,
  });
}

export const claudeProfileApi = {
  listTargets,
  list,
  create,
  importFromTarget,
  update,
  remove,
  apply,
};
