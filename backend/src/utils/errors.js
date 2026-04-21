// Shared typed error model.
// Connection: thrown in routes/services and interpreted by errorHandler middleware.

export class AppError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.details = options.details ?? null;
  }
}

export function badRequest(message, details = null) {
  return new AppError(message, {
    statusCode: 400,
    code: 'BAD_REQUEST',
    details
  });
}

export function unauthorized(message = 'Unauthorized') {
  return new AppError(message, {
    statusCode: 401,
    code: 'UNAUTHORIZED'
  });
}

export function forbidden(message = 'Forbidden') {
  return new AppError(message, {
    statusCode: 403,
    code: 'FORBIDDEN'
  });
}

export function notFound(message = 'Not found') {
  return new AppError(message, {
    statusCode: 404,
    code: 'NOT_FOUND'
  });
}

export function tooManyRequests(message = 'Too many requests', details = null) {
  return new AppError(message, {
    statusCode: 429,
    code: 'TOO_MANY_REQUESTS',
    details
  });
}