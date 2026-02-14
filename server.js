const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { testConnection } = require('./db');
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const conversationRoutes = require('./src/routes/conversationRoutes');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webbhookRoutes = require('./src/routes/webhookRoutes');
const casesRoutes = require('./src/routes/case.routes');
const twilioRoutes = require('./src/routes/twilioRoutes');
const teamRoutes = require('./src/routes/team.routes');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.io setup for real-time communication
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:3000", "http://localhost:5000"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Make io accessible to routes
app.set('io', io);

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('🔌 New client connected:', socket.id);
  
  // Join a case room to receive messages for specific case
  socket.on('join_case', (caseId) => {
    socket.join(`case_${caseId}`);
    console.log(`Socket ${socket.id} joined case_${caseId}`);
  });
  
  // Leave a case room
  socket.on('leave_case', (caseId) => {
    socket.leave(`case_${caseId}`);
    console.log(`Socket ${socket.id} left case_${caseId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

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
app.use('/api/conversations', conversationRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/webhook', webbhookRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/team', teamRoutes);

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

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
server.listen(PORT, () => {
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
  
  🔌 WebSocket Server: Running on port ${PORT}
  -----------------------
  `);
});