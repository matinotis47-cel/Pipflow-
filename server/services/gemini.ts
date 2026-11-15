import { GoogleGenAI, Type } from '@google/genai';

function getClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface AiBotStrategyResult {
  botName: string;
  symbol: string;
  tradeType: 'RISE_FALL' | 'DIGITS_OVER_UNDER' | 'EVEN_ODD' | 'ACCUMULATOR';
  directionBias: 'RISE' | 'FALL' | 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
  predictionDigit: number;
  stakeUsd: number;
  profitOnlyTargetPct: number;
  maxConcurrentTrades: number;
  rationale: string;
}

export async function generateAiBotStrategy(params: {
  prompt: string;
  symbol: string;
  currentPrice: number;
  recentDigits: number[];
}): Promise<AiBotStrategyResult> {
  const ai = getClient();
  if (!ai) {
    // Deterministic fallback when GEMINI_API_KEY isn't configured in local env
    const evenCount = params.recentDigits.filter((d) => d % 2 === 0).length;
    const isEvenFavored = evenCount <= params.recentDigits.length / 2;
    return {
      botName: 'PIPFLOW Profit-Guard Momentum Bot',
      symbol: params.symbol,
      tradeType: 'RISE_FALL',
      directionBias: isEvenFavored ? 'RISE' : 'FALL',
      predictionDigit: 4,
      stakeUsd: 5,
      profitOnlyTargetPct: 12,
      maxConcurrentTrades: 2,
      rationale: `Calibrated for ${params.symbol} near ${params.currentPrice.toFixed(2)} with strict Profit-Only Exit Guard (holds positions until unrealized P&L > 0).`,
    };
  }

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Design a safe educational trading bot configuration for PIPFLOW on symbol ${params.symbol} (current price ${params.currentPrice}, recent last digits: ${params.recentDigits.join(', ')}). User goal: ${params.prompt}. The bot uses PIPFLOW's Profit-Only Exit Guard which only closes trades once profitable.`,
    config: {
      systemInstruction:
        'You are the PIPFLOW quantitative strategy assistant. Return concise, realistic educational demo bot parameters strictly matching the JSON schema.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          botName: { type: Type.STRING },
          symbol: { type: Type.STRING },
          tradeType: { type: Type.STRING },
          directionBias: { type: Type.STRING },
          predictionDigit: { type: Type.INTEGER },
          stakeUsd: { type: Type.NUMBER },
          profitOnlyTargetPct: { type: Type.NUMBER },
          maxConcurrentTrades: { type: Type.INTEGER },
          rationale: { type: Type.STRING },
        },
        required: [
          'botName',
          'symbol',
          'tradeType',
          'directionBias',
          'predictionDigit',
          'stakeUsd',
          'profitOnlyTargetPct',
          'maxConcurrentTrades',
          'rationale',
        ],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as Partial<AiBotStrategyResult>;
  const validTradeTypes = ['RISE_FALL', 'DIGITS_OVER_UNDER', 'EVEN_ODD', 'ACCUMULATOR'] as const;
  const validDirections = ['RISE', 'FALL', 'EVEN', 'ODD', 'OVER', 'UNDER'] as const;
  return {
    botName: String(parsed.botName || 'PIPFLOW AI Profit Guard'),
    symbol: params.symbol,
    tradeType: validTradeTypes.includes(parsed.tradeType as any) ? (parsed.tradeType as AiBotStrategyResult['tradeType']) : 'RISE_FALL',
    directionBias: validDirections.includes(parsed.directionBias as any) ? (parsed.directionBias as AiBotStrategyResult['directionBias']) : 'RISE',
    predictionDigit: Math.min(9, Math.max(0, Number(parsed.predictionDigit ?? 4))),
    stakeUsd: Math.min(500, Math.max(1, Number(parsed.stakeUsd ?? 5))),
    profitOnlyTargetPct: Math.min(95, Math.max(5, Number(parsed.profitOnlyTargetPct ?? 15))),
    maxConcurrentTrades: Math.min(5, Math.max(1, Number(parsed.maxConcurrentTrades ?? 2))),
    rationale: String(parsed.rationale || 'Configured with Profit-Only exit threshold.'),
  };
}

export async function generateMarketInsight(params: {
  symbol: string;
  price: number;
  changePct: number;
  digits: number[];
}): Promise<string> {
  const ai = getClient();
  if (!ai) {
    const trend = params.changePct >= 0 ? 'upward' : 'downward';
    return `${params.symbol} is trading at ${params.price.toFixed(2)} (${params.changePct >= 0 ? '+' : ''}${params.changePct.toFixed(2)}%) showing ${trend} short-term structure. Digit distribution across the last ${params.digits.length} ticks suggests balanced volatility for Profit-Only Bot trailing entries.`;
  }

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Provide a 2-sentence educational technical market note for ${params.symbol} at price ${params.price} (${params.changePct.toFixed(2)}% move). Recent ticks ending digits: ${params.digits.slice(-15).join(', ')}. Keep it objective, educational, and mention risk discipline.`,
  });

  return (response.text ?? 'Market telemetry active. Monitor support and resistance levels before sizing positions.').trim();
}
