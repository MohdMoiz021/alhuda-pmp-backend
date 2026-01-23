const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
  connectionTimeoutMillis: 2000, // How long to wait for a connection
});

// Test database connection
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connected to PostgreSQL database');
    
    // Test query
    const result = await client.query('SELECT NOW() as current_time');
    console.log('📊 Database time:', result.rows[0].current_time);
    
    return true;
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Event listeners for pool
pool.on('connect', () => {
  console.log('🔗 New client connected to the pool');
});

pool.on('error', (err) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

// Export the pool and test function
module.exports = {
  pool,
  testConnection,
  
  // Helper function to execute queries
  query: (text, params) => pool.query(text, params),
  
  // Helper function to get a client from the pool
  getClient: async () => {
    const client = await pool.connect();
    const query = client.query;
    const release = client.release;
    
    // Set a timeout of 5 seconds
    const timeout = setTimeout(() => {
      console.error('⚠️  Client has been checked out for too long!');
    }, 5000);
    
    // Monkey patch the query method to track the last query executed
    client.query = (...args) => {
      client.lastQuery = args;
      return query.apply(client, args);
    };
    
    client.release = () => {
      // Clear the timeout
      clearTimeout(timeout);
      
      // Reset the methods to their original functions
      client.query = query;
      client.release = release;
      
      // Release the client back to the pool
      return release.apply(client);
    };
    
    return client;
  }
};