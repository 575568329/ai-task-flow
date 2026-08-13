// backend/src/domain/_shared/DomainError.ts
/**
 * 领域错误基类(P2-20):带 httpStatus + code,供 setErrorHandler 精准映射 4xx,
 * 避免所有业务错误默认 500(前端拿不到准确状态码,只能靠 message 字符串匹配)。
 *
 * 子类(各 context 的 NotFound/Validation/Conflict 等)继承并设 httpStatus。
 * 路由层可继续 instanceof 精细处理;漏处理(未 catch)的进 setErrorHandler 按 httpStatus 兜底。
 *
 * 迁移进度:mindmap(4 类)已迁移为示范。ClaudeProfile/Vocab/Maimemo 等其余 Error +
 * 36 处裸 `throw new Error` 逐步迁移(每次改动就近替换)。
 */
export abstract class DomainError extends Error {
  /** HTTP 状态码(4xx 业务错误 / 5xx 服务错误) */
  abstract readonly httpStatus: number;
  /** 机器可读错误码(供前端按 code 分支处理,如 'MINDMAP_NOT_FOUND') */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    // name 设为子类名(MindmapNotFoundError 等),便于日志/排查(instanceof 之外可看 name)
    this.name = this.constructor.name;
    this.code = code;
  }
}
