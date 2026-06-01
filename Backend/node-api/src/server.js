import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
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

app.use(
  cors({
    origin: [env.frontendOrigin, 'http://localhost:3002', 'http://localhost:3001', 'http://localhost:3000'],
    credentials: false,
  })
);
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'node-api' });
});

// Give the CSV import endpoint a long timeout — large files can take several minutes
app.use('/api/course-offerings/import-csv', (req, res, next) => {
  req.setTimeout(10 * 60 * 1000); // 10 minutes
  res.setTimeout(10 * 60 * 1000);
  next();
});

app.use('/api/faculty', facultyRouter);
app.use('/api/faculty', facultySubjectPreferencesRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/course-offerings', courseOfferingsRouter);
app.use('/api/subjects', subjectsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/ga', gaRouter);
app.use('/api/users', usersRouter);
app.use('/api/auth', authRouter);
app.use('/api/audit-logs', auditLogsRouter);

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
