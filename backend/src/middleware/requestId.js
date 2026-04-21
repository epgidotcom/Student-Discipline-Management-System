import crypto from 'crypto';

// Injects a request id to track logs across route/service/error layers.
// Connection: consumed by app bootstrap and logger-aware middlewares.
export function requestId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}