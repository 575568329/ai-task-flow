import { DomainError } from '../_shared/DomainError.js';

export class ConclusionNotFoundError extends DomainError {
  readonly httpStatus = 404;
  constructor(message: string) {
    super(message, 'CONCLUSION_NOT_FOUND');
  }
}

export class ConclusionValidationError extends DomainError {
  readonly httpStatus = 400;
  constructor(message: string) {
    super(message, 'CONCLUSION_VALIDATION');
  }
}

export class ConclusionConflictError extends DomainError {
  readonly httpStatus = 409;
  constructor(message: string) {
    super(message, 'CONCLUSION_CONFLICT');
  }
}

export class ConclusionStorageError extends DomainError {
  readonly httpStatus = 500;
  constructor(message: string) {
    super(message, 'CONCLUSION_STORAGE');
  }
}
