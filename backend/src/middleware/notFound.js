import { notFound } from '../utils/errors.js';

// Converts unmatched routes into typed 404 errors.
// Connection: mounted after all route modules in app bootstrap.
export function notFoundHandler(req, _res, next) {
  next(notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}