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
app.get('/health', (req, res)=> {
    res.json({ status: 'healthy', tier: 'application '});
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
