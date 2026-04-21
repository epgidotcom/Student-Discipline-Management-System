import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { env } from './config/env.js';
import accountsRoutes from './routes/accounts.js';
import analyticsRoutes from './routes/analytics.js';
import appealsRoutes from './routes/appeals.js';
import authRoutes from './routes/auth.js';
import messagesRoutes from './routes/messages.js';
import offensesRoutes from './routes/offenses.js';
import settingsRoutes from './routes/settings.js';
import studentsRoutes from './routes/students.js';
import violationsRoutes from './routes/violations.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFoundHandler } from './middleware/notFound.js';
import { requestId } from './middleware/requestId.js';
import healthRoutes from './routes/health.js';
import { logger } from './utils/logger.js';

const app = express();

// Parses comma-separated origin list from env for CORS enforcement.
// Connection: frontend deployments must be listed here per environment.
const allowedOrigins = env.ALLOWED_ORIGINS.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Security and body parsing middleware chain.
// Connection: runs before every route module.
app.use(helmet());
// Capture raw request body for debugging (stores in req.rawBody) while still
// allowing JSON parsing. This helps diagnose malformed payloads from clients.
app.use(requestId);
app.use(
  express.json({
    limit: '1mb',
    verify(req, _res, buf) {
      try {
        req.rawBody = buf && buf.length ? buf.toString('utf8') : '';
      } catch (e) {
        req.rawBody = '';
      }
    }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed: ${origin}`));
    }
  })
);

// HTTP log bridge that writes through central logger.
// Connection: request logs correlate with requestId from requestId middleware.
morgan.token('request-id', (req) => req.requestId || '-');
app.use(
  morgan(':method :url :status :response-time ms req=:request-id', {
    stream: {
      write(message) {
        logger.info(message.trim());
      }
    }
  })
);

// API routes mounted under /api namespace.
// Connection: future domain routers (auth/students/violations) will also be mounted here.
app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/students', studentsRoutes);
app.use('/api/offenses', offensesRoutes);
app.use('/api/violations', violationsRoutes);
app.use('/api/appeals', appealsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api', healthRoutes);

// (no development-only debug endpoints enabled)

// 404 and error pipeline must be mounted after all routes.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;