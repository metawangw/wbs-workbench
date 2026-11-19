import type { Request, Response } from 'express';

const clients = new Set<Response>();

export function sseHandler(req: Request, res: Response): void {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.add(res);

  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 25_000);

  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    res.end();
  });
}

export function broadcast(payload: unknown): void {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(frame);
  }
}
