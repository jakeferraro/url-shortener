require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { customAlphabet } = require('nanoid');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Short codes: lowercases + num, 6 chars
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 6);

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', async (req, res)=> {
    try {
        // check db connection
        await pool.query('SELECT 1');

        res.json({
            status: 'healthy', 
            tier: 'application',
            timestamp: new Date().toISOString(),
            database: 'connected',
            uptime: process.uptime()
        });
    } catch (err) {
        console.error('Health check failed:', err);
        res.status(503).json({
            status: 'unhealthy',
            tier: 'application',
            timerstamp: new Date().toISOString(),
            database: 'disconnected',
            error: 'Database connection failed'
        });
    }
});

// ====== CRUD ======

// CREATE - shorten URL
app.post('/api/shorten', async (req, res) => {
    try {
        const { url } = req.body;

        // validation
        if (!url || !url.startsWith('http')) {
            return res.status(400).json({ error: 'Valid URL required (must start with http/https)' });
        }

        // check if URL already exists
        const existing = await pool.query(
            'SELECT short_code FROM urls WHERE long_url = $1',
            [url]
        );

        if (existing.rows.length > 0) {
            return res.json({
                shortCode: existing.rows[0].short_code,
                shortUrl: `${req.protocol}://${req.get('host')}/${existing.rows[0].short_code}`
            });
        }

        // generate short code
        let shortCode;
        let attempts = 0;

        while (attempts < 5) {
            shortCode = nanoid();
            const check = await pool.query(
                'SELECT if FROM urls WHERE short_code = $1',
                [shortCode]
            );

            if (check.rows.length === 0) break;
            attempts++
        }

        if (attempts === 5) {
            return res.status(500).json({ error: 'Failed to generate unique code' });
        }

        // insert into db
        await pool.query(
            'INSERT INTO urls (short_code, long_url) VALUES ($1, $2)',
            [shortCode, url]
        );

        res.status(201).json({
            shortCode,
            shortUrl: `${req.protocol}://${req.get('host')}/${shortCode}`
        });

    } catch (err) {
        console.error('Error shortening URL:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// READ - get all URLs
app.get('/api/urls', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, short_code, long_url, created_at, clicks FROM urls ORDER BY created_at DESC LIMIT 100'
        );

        res.json({
            urls: result.rows.map(row => ({
                id: row.id,
                shortCode: row.short_code,
                longUrl: row.long_url,
                createdAt: row.created_at,
                clicks: row.clicks,
                shortUrl: `${req.protocol}://${req.get('host')}/${row.short_code}`
            }))
        });

    } catch (err) {
        console.error('Error fetching URLS:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// READ - get single URL by short code
app.get('/api/urls/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        const result = await pool.query(
            'SELECT id, short_code, long_url, created_at, clicks FROM urls WHERE short_code = $1',
            [shortCode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'URL not found' });
        }

        res.json ({
            id: result.rows[0].id,
            shortCode: result.rows[0].short_code,
            longUrl: result.rows[0].long_url,
            createdAt: result.rows[0].created_at,
            clicks: result.rows[0].clicks
        });

    } catch (err) {
        console.error('Error fetching URL:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// UPDATE - Update URL
app.put('/api/urls/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;
        const{ longUrl } = req.body;

        if (!longUrl || !longUrl.startsWith('http')) {
            return res.status(400).json({ error: 'Valid URL required (must start with http/https'});
        }

        const result = await pool.query(
            'UPDATE urls SET long_url = $1 WHERE short_code = $2 RETURNING *',
            [longUrl, shortCode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'URL not found' });
        }

        res.json({
            id: result.rows[0].id,
            shortCode: result.rows[0].short_code,
            longUrl: result.rows[0].long_url,
            clicks: result.rows[0].clicks
        });

    } catch (err) {
        console.error('Error updating URL:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE - delete URL
app.delete('/api/urls/:shortCode', async (req, res) => {
    try{
        const { shortCode } = req.params;

        const result = await pool.query(
            'DELETE FROM urls WHERE short_code = $1 RETURNING short_code',
            [shortCode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'URL not found' });
        }

        res.json({ message: 'URL deleted successfully', shortCode});
    } catch (err) {
        console.error('Error deleting URL:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// REDIRECT - actual shortening functionality
app.get('/:shortCode', async (req, res) => {
    try {
        const { shortCode } = req.params;

        // skip API routes
        if (shortCode === 'api' || shortCode === 'health') {
            return;
        }

        const result = await pool.query(
            'UPDATE urls SET clicks = clicks + 1 WHERE short_code = $1 RETURNING long_url',
            [shortCode]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Short URL not found'});
        }

        res.redirect(result.rows[0].long_url);

    } catch (err) {
        console.error('Error redirecting:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// start server
const server = app.listen(PORT, '0.0.0.0', () => {
    const env = process.env.NODE_ENV || 'development';
    const hostname = process.env.HOSTNAME || require('os').hostname();

    console.log(`Tier 2 (app layer) running on port ${PORT}`);
    console.log(`Environment: ${env}`);
    console.log(`Hostname: ${hostname}`);
    console.log(`Health check: http://0.0.0.0:${PORT}/health`);

    if (env === 'development') {
        console.log(`Local access: http://localhost:${PORT}`);
    }
}); 