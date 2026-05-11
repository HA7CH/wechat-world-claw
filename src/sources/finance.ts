export interface FinanceData {
  btcPrice: number;
  btcChange: number;
  ethPrice: number;
  ethChange: number;
}

interface BinanceTicker {
  lastPrice?: string;
  priceChangePercent?: string;
}

async function fetchTicker(symbol: string, signal: AbortSignal): Promise<BinanceTicker | null> {
  try {
    const resp = await fetch(
      `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`,
      { signal }
    );
    if (!resp.ok) { console.error(`[finance] ${symbol} HTTP`, resp.status); return null; }
    return (await resp.json()) as BinanceTicker;
  } catch (err) {
    console.error(`[finance] ${symbol} failed:`, err);
    return null;
  }
}

export async function fetchFinanceData(): Promise<FinanceData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const [btc, eth] = await Promise.all([
      fetchTicker("BTCUSDT", controller.signal),
      fetchTicker("ETHUSDT", controller.signal),
    ]);

    if (!btc?.lastPrice) return null;

    return {
      btcPrice: parseFloat(btc.lastPrice),
      btcChange: parseFloat(btc.priceChangePercent ?? "0"),
      ethPrice: parseFloat(eth?.lastPrice ?? "0"),
      ethChange: parseFloat(eth?.priceChangePercent ?? "0"),
    };
  } finally {
    clearTimeout(timer);
  }
}
