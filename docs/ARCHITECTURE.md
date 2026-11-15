# PIPFLOW System Architecture

## Stack Overview
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4 (`@custom-variant dark`), Lucide icons.
- **Backend**: Node.js + Express 4 (`server.ts`) running on port 3000 with Vite middleware in development and static `dist/` serving in production.
- **AI Engine**: Server-side `@google/genai` SDK (`server/services/gemini.ts`) providing strategy synthesis and market insights without exposing keys to the browser.
- **Real-Time Propagation**: Server-Sent Events (`/api/events/stream`) push `config:updated`, `account:updated`, and `notification:created` events instantaneously to connected clients.

## Key Modules
- `src/config/app.config.ts` — Central default PIPFLOW branding, 19 market definitions, currency conversion rates, and email-initial helpers.
- `src/services/marketEngine.ts` — Live multi-asset tick/candle simulator and last-digit telemetry extractor.
- `src/components/TradingChart.tsx` — HiDPI HTML5 Canvas candlestick & area chart with SMA 20, EMA 9, drawing overlays, and Accumulator range barrier box.
- `src/components/AiProfitBotDrawer.tsx` — Gemini-guided digit/momentum bot with a Profit-Only Exit Guard (`profitLoss > 0` enforced both client-side and server-side on `POST /api/trading/close`).
- `src/pages/DashboardPage.tsx` — Multi-tab trading workspace, `ROT...` (Green `R`) & `DOT...` (Blue `D`) account switcher, live open-position tracker, bottom bot strip, and 10-click hidden admin entry trigger.
- `src/pages/AdminPage.tsx` — Protected 15-section Control Centre (`/admin`).
