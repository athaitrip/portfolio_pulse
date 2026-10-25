const express = require('express');
require('dotenv').config();
const { getHistoricalData, getLatestPrice, searchSymbols } = require('./history-service');

const app = express();
const PORT = 3000;
const TIINGO_API_KEY = process.env.TIINGO_API_KEY;

// Serve static files from current directory
app.use(express.static(__dirname));

app.get('/api/history', async (req, res) => {
    const symbolsStr = req.query.symbols;
    if (!symbolsStr) return res.status(400).json({ error: 'No symbols provided' });
    const symbols = symbolsStr.split(',');
    try {
        const results = await getHistoricalData(symbols, TIINGO_API_KEY);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({
            error: err.publicMessage || 'Failed to fetch data from Tiingo'
        });
    }
});

app.get('/api/quote', async (req, res) => {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim().toUpperCase() : '';
    if (!/^[A-Z0-9.-]+$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol' });
    try {
        const quote = await getLatestPrice(symbol, TIINGO_API_KEY);
        res.json(quote);
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.publicMessage || 'Failed to fetch latest price' });
    }
});

app.get('/api/symbols', async (req, res) => {
    const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
    if (query.length < 2 || query.length > 30 || !/^[A-Z0-9 .&/-]+$/i.test(query)) {
        return res.status(400).json({ error: 'Invalid symbol search query' });
    }
    try {
        const results = await searchSymbols(query, TIINGO_API_KEY);
        res.json(results);
    } catch (err) {
        console.error(err);
        res.status(err.statusCode || 500).json({ error: err.publicMessage || 'Failed to search symbols' });
    }
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
