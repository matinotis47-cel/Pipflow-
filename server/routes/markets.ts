import { Router } from 'express';
import { derivMarketFeed } from '../services/derivMarketFeed.ts';
import { loadDb } from '../db/store.ts';

const router = Router();

router.get('/instruments', async (_req, res) => {
  try {
    const db = loadDb();
    const derivInstruments = await derivMarketFeed.getInstruments();
    res.json({
      configuredMarkets: db.config.markets,
      derivInstruments,
      totalDerivInstruments: derivInstruments.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to retrieve market instruments.' });
  }
});

router.get('/history', async (req, res) => {
  const symbol = String(req.query.symbol || 'R_100_1S').trim();
  const timeframe = String(req.query.timeframe || '1m').trim();
  const count = Number(req.query.count || 90);

  try {
    const data = await derivMarketFeed.fetchHistoricalData(symbol, timeframe, count);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to load market history.' });
  }
});

router.get('/status', (_req, res) => {
  res.json({
    feed: derivMarketFeed.getDiagnostics(),
  });
});

export default router;
