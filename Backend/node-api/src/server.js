import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { requireAuth } from './middleware/requireAuth.js';
import { safeErrorMessage } from './lib/apiError.js';
import courseOfferingsRouter from './routes/courseOfferings.js';
import departmentsRouter from './routes/departments.js';
import facultyRouter from './routes/faculty.js';
import facultySubjectPreferencesRouter from './routes/facultySubjectPreferences.js';
import roomsRouter from './routes/rooms.js';
import subjectsRouter from './routes/subjects.js';
import notificationsRouter from './routes/notifications.js';
import gaRouter from './routes/ga.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';
import auditLogsRouter from './routes/auditLogs.js';

const app = express();

const allowedOrigins = env.frontendOrigin
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS: origin not allowed'));
      }
    },
    credentials: false,
  })
);
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'node-api' });
});

app.use('/api/auth', authRouter);

// Give the CSV import endpoint a long timeout — large files can take several minutes
app.use('/api/course-offerings/import-csv', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000); // 10 minutes
  res.setTimeout(10 * 60 * 1000);
  next();
});

app.use('/api/faculty', requireAuth, facultyRouter);
app.use('/api/faculty', requireAuth, facultySubjectPreferencesRouter);
app.use('/api/departments', requireAuth, departmentsRouter);
app.use('/api/rooms', requireAuth, roomsRouter);
app.use('/api/course-offerings', requireAuth, courseOfferingsRouter);
app.use('/api/subjects', requireAuth, subjectsRouter);
app.use('/api/notifications', requireAuth, notificationsRouter);
app.use('/api/ga', requireAuth, gaRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/audit-logs', requireAuth, auditLogsRouter);

// Global error handler — catches any unhandled errors thrown by route handlers
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: safeErrorMessage(err) });
});

const server = app.listen(env.port, () => {
  console.log(`[node-api] listening on http://localhost:${env.port}`);
});

server.on('error', (err) => {
  console.error('[node-api] server error:', err);
});

// Client disconnections during long-running requests (e.g. GA scheduler) emit
// a socket write error that Node throws as an uncaught exception if unhandled.
// Swallow known network-disconnect codes; crash on anything else.
process.on('uncaughtException', (err) => {
  if (['EOF', 'ECONNRESET', 'EPIPE', 'ENOTCONN'].includes(err.code)) {
    console.warn(`[node-api] client disconnected prematurely (${err.code})`);
    return;
  }
  console.error('[node-api] uncaught exception:', err);
  process.exit(1);
});
