const { getLatestPrice } = require('../history-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9.-]+$/.test(symbol)) {
    return res.status(400).json({ error: 'Invalid symbol' });
  }

  try {
    const quote = await getLatestPrice(symbol, process.env.TIINGO_API_KEY);
    return res.status(200).json(quote);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.publicMessage || 'Failed to fetch latest price'
    });
  }
};
