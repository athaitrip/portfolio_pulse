const { searchSymbols } = require('../history-service');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (query.length < 2 || query.length > 30 || !/^[A-Z0-9 .&/-]+$/i.test(query)) {
    return res.status(400).json({ error: 'Invalid symbol search query' });
  }

  try {
    const results = await searchSymbols(query, process.env.TIINGO_API_KEY);
    return res.status(200).json(results);
  } catch (error) {
    console.error(error);
    return res.status(error.statusCode || 500).json({
      error: error.publicMessage || 'Failed to search symbols'
    });
  }
};
