import type { Response } from 'express';

interface SseClient {
  id: string;
  userId?: string;
  res: Response;
}

const clients = new Map<string, SseClient>();

export function registerSseClient(id: string, res: Response, userId?: string): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  clients.set(id, { id, userId, res });
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, timestamp: new Date().toISOString() })}\n\n`);

  const keepAlive = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(keepAlive);
      clients.delete(id);
    }
  }, 25000);

  res.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(id);
  });
}

export function broadcastEvent(event: string, data: unknown, targetUserId?: string): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, client] of clients.entries()) {
    if (targetUserId && client.userId && client.userId !== targetUserId) {
      continue;
    }
    if (targetUserId && !client.userId) {
      continue;
    }
    try {
      client.res.write(payload);
    } catch {
      clients.delete(id);
    }
  }
}
