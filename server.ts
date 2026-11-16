import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { flushDb, initializeStorage, loadDb, saveDb } from './server/db/store.ts';
import { generateId, verifySessionToken } from './server/security/crypto.ts';
import { USER_COOKIE_NAME } from './server/middleware/auth.ts';
import { registerSseClient } from './server/services/sse.ts';
import authRoutes from './server/routes/auth.ts';
import tradingRoutes from './server/routes/trading.ts';
import adminRoutes from './server/routes/admin.ts';
import integrationRoutes from './server/routes/integrations.ts';

async function startServer() {
  if (process.env.NODE_ENV === 'production' && (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32)) {
    throw new Error('AUTH_SECRET must be configured with at least 32 characters in production.');
  }
  await initializeStorage();
  const app = express();
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port between 1 and 65535.');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use('/uploads', express.static(uploadsDir));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', brand: 'PIPFLOW', timestamp: new Date().toISOString() }));
  app.get('/api/events/stream', (req, res) => {
    const session = verifySessionToken(req.cookies?.[USER_COOKIE_NAME], 'user');
    registerSseClient(generateId('sse'), res, session?.sub);
  });

  app.use('/api', (_req, res, next) => {
    const originalEnd = res.end.bind(res);
    let ending = false;
    res.end = ((...args: any[]) => {
      if (ending) return res;
      ending = true;
      void flushDb().then(() => originalEnd(...args)).catch((error) => {
        console.error('Database write did not commit before response:', error);
        if (!res.headersSent) res.statusCode = 503;
        originalEnd();
      });
      return res;
    }) as typeof res.end;
    next();
  });
  app.get('/api/config', (_req, res) => res.json({ config: loadDb().config }));

  const contactSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), subject: z.string().trim().min(2).max(160), message: z.string().trim().min(5).max(2000) });
  app.post('/api/contact', (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Please complete all contact fields accurately.' });
    const db = loadDb();
    const submission = { id: generateId('cnt'), ...parsed.data, createdAt: new Date().toISOString() };
    db.contactSubmissions.unshift(submission);
    saveDb(db);
    return res.status(201).json({ ok: true, id: submission.id });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/trading', tradingRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/integrations', integrationRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Request failed:', err);
    if (!res.headersSent) res.status(err.status || 400).json({ error: err.message || 'Request failed' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (!fs.existsSync(path.join(distDir, 'index.html'))) throw new Error('Production frontend build missing. Run npm run build.');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  const server = app.listen(port, '0.0.0.0', () => console.log(`PIPFLOW server listening on 0.0.0.0:${port}`));
  const shutdown = () => server.close(() => void flushDb().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((error) => {
  console.error('Failed to start PIPFLOW server:', error);
  process.exitCode = 1;
});
