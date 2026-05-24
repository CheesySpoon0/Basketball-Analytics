#!/usr/bin/env npx tsx
import "dotenv/config";
import { Pool } from 'pg';

async function main() {
  console.log('DATABASE_URL:', process.env.DATABASE_URL);
  console.log('DIRECT_URL:', process.env.DIRECT_URL);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();
    const result = await client.query('SELECT current_database()');
    console.log('Connected to database:', result.rows[0]);
    client.release();
  } catch (error) {
    console.error('Pool connection error:', error);
  }

  try {
    const directPool = new Pool({ connectionString: process.env.DIRECT_URL });
    const client = await directPool.connect();
    const result = await client.query('SELECT current_database()');
    console.log('Direct connection to database:', result.rows[0]);
    client.release();
    await directPool.end();
  } catch (error) {
    console.error('Direct connection error:', error);
  }

  await pool.end();
}

main();