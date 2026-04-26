const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Render's free database
});

// Create table if not exists
const initDB = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS shopping_items (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        item_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        checked BOOLEAN DEFAULT FALSE
      );
    `);
    console.log('Shopping table ready');
  } finally {
    client.release();
  }
};

initDB();

module.exports = pool;