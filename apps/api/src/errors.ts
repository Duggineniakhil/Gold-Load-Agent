export type FieldError = { field: string; message: string };

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', fields: FieldError[] = []) {
    super(400, 'VALIDATION_ERROR', message, fields);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Route not found.', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    code = 'CONFLICT',
    fields: FieldError[] = [],
    extra: Record<string, unknown> = {},
  ) {
    super(409, code, message, fields, extra);
  }
}
