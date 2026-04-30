import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import courseOfferingsRouter from './routes/courseOfferings.js';
import facultyRouter from './routes/faculty.js';
import subjectsRouter from './routes/subjects.js';

const app = express();

app.use(
  cors({
    origin: env.frontendOrigin,
    credentials: false,
  })
);
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'node-api' });
});

app.use('/api/course-offerings', courseOfferingsRouter);
app.use('/api/faculty', facultyRouter);
app.use('/api/subjects', subjectsRouter);

app.listen(env.port, () => {
  console.log(`[node-api] listening on http://localhost:${env.port}`);
});
