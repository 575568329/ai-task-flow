// backend/src/domain/worklog/errors.ts
// worklog 领域错误(P1 架构修复):承接 DomainError(P2-20)机制,替代路由层
// message 字符串匹配("不存在"→404/"已存在"→409)——文案微调不再静默错位状态码,
// 未知系统错误(磁盘满/JSON 损坏)正确落 500 而非误判 400。
import { DomainError } from '../_shared/DomainError.js';

/** 目标(条目/版本/项目)不存在 → 404 */
export class WorklogNotFoundError extends DomainError {
  readonly httpStatus = 404;
  constructor(message: string) {
    super(message, 'WORKLOG_NOT_FOUND');
  }
}

/** 重名冲突(版本/项目) → 409 */
export class WorklogConflictError extends DomainError {
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message, 'WORKLOG_CONFLICT');
  }
}

/** 入参校验失败(名称非法/缺字段/date 格式/files 非数组) → 400 */
export class WorklogValidationError extends DomainError {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message, 'WORKLOG_VALIDATION');
  }
}
