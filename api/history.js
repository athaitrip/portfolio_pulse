const { getHistoricalData } = require('../history-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbolsParam = req.query.symbols;
  if (typeof symbolsParam !== 'string' || !symbolsParam) {
    return res.status(400).json({ error: 'No symbols provided' });
  }

  const symbols = [...new Set(symbolsParam.split(','))];
  if (symbols.some(symbol => !/^[A-Z0-9.-]+$/i.test(symbol))) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  try {
    const results = await getHistoricalData(symbols, process.env.TIINGO_API_KEY);
    return res.status(200).json(results);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.publicMessage || 'Failed to fetch data from Tiingo'
    });
  }
};
