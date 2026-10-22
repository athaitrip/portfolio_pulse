const express = require('express');
require('dotenv').config();
const { getHistoricalData } = require('./history-service');

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

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
