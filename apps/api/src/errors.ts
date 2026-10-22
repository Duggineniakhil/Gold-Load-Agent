export type FieldError = { field: string; message: string };

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields: FieldError[] = [],
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
  constructor(message = 'Route not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, fields: FieldError[] = []) {
    super(409, 'CONFLICT', message, fields);
  }
}
