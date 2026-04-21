import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

// Central error response middleware.
// Connection: receives errors from all route/service layers and serializes a stable API shape.
export function errorHandler(err, req, res, _next) {
  const requestId = req.requestId || 'unknown';

  if (err instanceof AppError) {
    logger.warn('Handled application error', {
      requestId,
      code: err.code,
      message: err.message
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        requestId
      }
    });
    return;
  }

  logger.error('Unhandled server error', {
    requestId,
    message: err?.message || 'Unknown error',
    stack: err?.stack || null
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId
    }
  });
}