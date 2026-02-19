require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS - only allow ShipView origins
const allowedOrigins = [
  'https://shipview.pages.dev',
  'http://localhost:8080',
  'http://localhost:3000'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Auth is handled by Cloudflare Access at the network level.
// No API key middleware needed.

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Health check
app.get('/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', message: err.message });
  }
});

// Get orders for ShipView map
app.get('/api/orders',async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10000, 50000);
    const offset = parseInt(req.query.offset) || 0;

    // Build optional WHERE clauses
    const conditions = [];
    const params = [];

    if (req.query.status) {
      conditions.push('`Order_Status` = ?');
      params.push(req.query.status);
    }

    if (req.query.business_unit) {
      conditions.push('`Business Unit` = ?');
      params.push(req.query.business_unit);
    }

    if (req.query.from_date) {
      conditions.push('`Ship Date` >= ?');
      params.push(req.query.from_date);
    }

    if (req.query.to_date) {
      conditions.push('`Ship Date` <= ?');
      params.push(req.query.to_date);
    }

    if (req.query.state) {
      conditions.push('`Ship To State` = ?');
      params.push(req.query.state);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        \`Ord #\` AS ord_num,
        \`Cust Name\` AS cust_name,
        \`Ship To City\` AS ship_to_city,
        \`Ship To State\` AS ship_to_state,
        \`Ship To Zip\` AS ship_to_zip,
        \`Ship To Country\` AS ship_to_country,
        \`Ship Date\` AS ship_date,
        \`Due Date\` AS due_date,
        \`Corrected_Due_Date\` AS corrected_due_date,
        \`Order_Status\` AS order_status,
        \`Carrier\` AS carrier,
        \`Order Qty\` AS order_qty,
        \`Business Unit\` AS business_unit,
        \`Order Sub Status\` AS order_sub_status
      FROM \`Order Query\`
      ${whereClause}
      ORDER BY \`Ship Date\` DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const [rows] = await pool.query(query, params);

    // Get total count
    const countQuery = `SELECT COUNT(*) as total FROM \`Order Query\` ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params.slice(0, -2));

    res.json({
      data: rows,
      total: countResult[0].total,
      limit,
      offset
    });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: 'Database query failed', message: err.message });
  }
});

// Get distinct values for filters
app.get('/api/filters',async (req, res) => {
  try {
    const [statuses] = await pool.query('SELECT DISTINCT `Order_Status` AS value FROM `Order Query` WHERE `Order_Status` IS NOT NULL ORDER BY `Order_Status`');
    const [units] = await pool.query('SELECT DISTINCT `Business Unit` AS value FROM `Order Query` WHERE `Business Unit` IS NOT NULL ORDER BY `Business Unit`');
    const [carriers] = await pool.query('SELECT DISTINCT `Carrier` AS value FROM `Order Query` WHERE `Carrier` IS NOT NULL ORDER BY `Carrier`');

    res.json({
      statuses: statuses.map(r => r.value),
      business_units: units.map(r => r.value),
      carriers: carriers.map(r => r.value)
    });
  } catch (err) {
    console.error('Filter query error:', err);
    res.status(500).json({ error: 'Failed to load filters', message: err.message });
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`ShipView API running on http://127.0.0.1:${PORT}`);
});
