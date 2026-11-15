import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { loadDb, saveDb } from './server/db/store.ts';
import { generateId, verifySessionToken } from './server/security/crypto.ts';
import { USER_COOKIE_NAME } from './server/middleware/auth.ts';
import { registerSseClient } from './server/services/sse.ts';
import authRoutes from './server/routes/auth.ts';
import tradingRoutes from './server/routes/trading.ts';
import adminRoutes from './server/routes/admin.ts';

async function startServer() {
  const app = express();
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port between 1 and 65535.');
  }

  // Trust the Render / Cloud Run / AI Studio reverse proxy for HTTPS detection.
  app.set('trust proxy', 1);

  // Ensure DB initialized
  loadDb();

  app.use(express.json({ limit: '4mb' }));
  app.use(cookieParser());

  // Serve uploaded logos. In production, persist this directory on a mounted disk.
  const uploadsDir = path.resolve(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));

  // Health & Public Config endpoints
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', brand: 'PIPFLOW', timestamp: new Date().toISOString() });
  });

  app.get('/api/config', (_req, res) => {
    const db = loadDb();
    res.json({ config: db.config });
  });

  app.get('/api/events/stream', (req, res) => {
    const token = req.cookies?.[USER_COOKIE_NAME];
    const session = verifySessionToken(token, 'user');
    registerSseClient(generateId('sse'), res, session?.sub);
  });

  const contactSchema = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(254),
    subject: z.string().trim().min(2).max(160),
    message: z.string().trim().min(5).max(2000),
  });

  app.post('/api/contact', (req, res) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Please complete all contact fields accurately.' });
      return;
    }
    const db = loadDb();
    const submission = {
      id: generateId('cnt'),
      ...parsed.data,
      createdAt: new Date().toISOString(),
    };
    db.contactSubmissions.unshift(submission);
    saveDb(db);
    res.status(201).json({ ok: true, id: submission.id });
  });

  // Mount API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/trading', tradingRoutes);
  app.use('/api/admin', adminRoutes);

  // Error handler for multer / JSON
  app.use((err: any, _req: any, res: any, next: any) => {
    if (err) {
      res.status(err.status || 400).json({ error: err.message || 'Request failed' });
      return;
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`PIPFLOW server listening on 0.0.0.0:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start PIPFLOW server:', error);
  process.exitCode = 1;
});
