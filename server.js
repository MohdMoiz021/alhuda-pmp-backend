const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { testConnection } = require('./db');
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const casesRoutes=require('./src/routes/case.routes');
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Test database connection on startup
testConnection().then(isConnected => {
  if (isConnected) {
    console.log('🚀 Database ready for connections');
  } else {
    console.log('⚠️  Database connection issues. Server will start but DB operations may fail.');
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Routes

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.API_RATE_LIMIT || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});

app.use(limiter);

// Home route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Al Huda Authentication API',
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile'
      },
      users: 'GET /api/users (admin only)'
    }
  });
});

app.use('/api/cases', casesRoutes);


// Test database route
app.get('/api/test-db', async (req, res) => {
  try {
    const pool = require('./config/database').pool;
    const result = await pool.query('SELECT NOW() as time');
    res.json({
      success: true,
      message: 'Database connected successfully',
      time: result.rows[0].time
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message
    });
  }
});

// Handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.url}`
  });
});

app.get('/home', (req, res) => {
  res.json({
    success: true,
    message: 'Al Huda PMP Backend API',
    version: '1.0.0',
    status: 'running'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
  🚀 Al Huda Backend Server Started!
  ================================
  📍 Port: ${PORT}
  🌍 URL: http://localhost:${PORT}
  ================================
  
  📋 Available Endpoints:
  -----------------------
  GET  /                 - Welcome
  GET  /api/test-db      - Test database
  POST /api/auth/register - Register user
  POST /api/auth/login   - Login user
  GET  /api/auth/profile - Get profile (protected)
  PUT  /api/auth/profile - Update profile (protected)
  GET  /api/users        - Get all users (admin only)
  -----------------------
  `);
});