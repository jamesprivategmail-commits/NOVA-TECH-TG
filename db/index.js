const { Pool } = require('pg');

// Railway injects DATABASE_URL automatically when you add a Postgres plugin.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false)
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool
};