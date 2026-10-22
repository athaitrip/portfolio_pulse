const cache = new Map();

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
    const cleanData = data.map(item => ({ date: item.date, close: item.adjClose }));
    cache.set(symbol, { date: today, data: cleanData });
    results[symbol] = cleanData;
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  return results;
}

module.exports = { getHistoricalData };
