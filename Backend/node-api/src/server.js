import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import courseOfferingsRouter from './routes/courseOfferings.js';
import departmentsRouter from './routes/departments.js';
import facultyRouter from './routes/faculty.js';
import roomsRouter from './routes/rooms.js';
import subjectsRouter from './routes/subjects.js';
import notificationsRouter from './routes/notifications.js';
import gaRouter from './routes/ga.js';
import facultySubjectPreferencesRouter from './routes/facultySubjectPreferences.js';
import usersRouter from './routes/users.js';
import authRouter from './routes/auth.js';

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

app.listen(env.port, () => {
  console.log(`[node-api] listening on http://localhost:${env.port}`);
});
