const cache = new Map();
const symbolSearchCache = new Map();
const symbolSearchRequests = new Map();

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

async function getHistoricalData(symbols, apiKey) {
  if (!apiKey || apiKey === 'your_tiingo_api_key_here') {
    const error = new Error('TIINGO_API_KEY is not set');
    error.statusCode = 500;
    error.publicMessage = 'TIINGO_API_KEY is not set';
    throw error;
  }

  const today = getTodayStr();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 3);
  const startDateStr = startDate.toISOString().split('T')[0];
  const results = {};

  for (const symbol of symbols) {
    const cached = cache.get(symbol);
    if (cached && cached.date === today) {
      results[symbol] = cached.data;
      continue;
    }

    const url = `https://api.tiingo.com/tiingo/daily/${symbol}/prices?startDate=${startDateStr}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429) {
        const error = new Error('Tiingo API Rate Limit Exceeded (429)');
        error.statusCode = 429;
        error.publicMessage = error.message;
        throw error;
      }
      console.error(`Failed to fetch ${symbol}:`, response.status);
      continue;
    }

    const data = await response.json();
    const cleanData = data.map(item => ({
      date: item.date,
      close: item.adjClose,
      price: item.close,
      dividend: Number(item.divCash) || 0
    }));
    cache.set(symbol, { date: today, data: cleanData });
    results[symbol] = cleanData;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return results;
}

async function getLatestPrice(symbol, apiKey) {
  const history = await getHistoricalData([symbol], apiKey);
  const prices = history[symbol];
  if (!prices || !prices.length) {
    const error = new Error(`No price data found for ${symbol}`);
    error.statusCode = 404;
    error.publicMessage = error.message;
    throw error;
  }

  const latest = prices[prices.length - 1];
  if (!Number.isFinite(latest.price) || latest.price <= 0) {
    const error = new Error(`No valid latest price found for ${symbol}`);
    error.statusCode = 404;
    error.publicMessage = error.message;
    throw error;
  }
  const previous = prices[prices.length - 2];
  return {
    symbol,
    price: latest.price,
    change: previous && Number.isFinite(previous.price) ? latest.price - previous.price : 0,
    date: latest.date
  };
}

async function searchSymbols(query, apiKey) {
  if (!apiKey || apiKey === 'your_tiingo_api_key_here') {
    const error = new Error('TIINGO_API_KEY is not set');
    error.statusCode = 500;
    error.publicMessage = error.message;
    throw error;
  }

  const cacheKey = query.trim().toUpperCase();
  const cached = symbolSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1000) return cached.results;
  if (symbolSearchRequests.has(cacheKey)) return symbolSearchRequests.get(cacheKey);

  const request = (async () => {
    const url = `https://api.tiingo.com/tiingo/utilities/search?query=${encodeURIComponent(query)}&token=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(response.status === 429
        ? 'Tiingo API Rate Limit Exceeded (429)'
        : `Tiingo symbol search failed (${response.status})`);
      error.statusCode = response.status === 429 ? 429 : 502;
      error.publicMessage = error.message;
      throw error;
    }

    const results = await response.json();
    if (!Array.isArray(results)) {
      throw new Error('Tiingo returned an invalid symbol search response');
    }
    return results
      .filter(item => item && typeof item.ticker === 'string')
      .slice(0, 10)
      .map(item => ({ symbol: item.ticker, name: item.name || '' }));
  })();
  symbolSearchRequests.set(cacheKey, request);

  try {
    const results = await request;
    symbolSearchCache.set(cacheKey, { results, cachedAt: Date.now() });
    if (symbolSearchCache.size > 100) {
      symbolSearchCache.delete(symbolSearchCache.keys().next().value);
    }
    return results;
  } finally {
    symbolSearchRequests.delete(cacheKey);
  }
}

module.exports = { getHistoricalData, getLatestPrice, searchSymbols };
