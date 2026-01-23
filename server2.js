// require("dotenv").config();
// const express = require("express");
// const cors = require("cors");
// const pool = require("./db");
// const { exec } = require('child_process'); 

// const swaggerUI = require('swagger-ui-express');
// const swaggerSpec = require('./config/swagger');
// const authRoutes = require("./src/routes/auth.routes");
// const app = express();

// app.use(cors());
// app.use(express.json());
// app.use("/api/auth", authRoutes);
// app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerSpec));

// app.get('/swagger.json', (req, res) => {
//   res.setHeader('Content-Type', 'application/json');
//   res.send(swaggerSpec);
// });

// pool.query("SELECT NOW()", (err, res) => {
//   if (err) {
//     console.error("DB connection failed", err);
//   } else {
//     console.log("DB connected:", res.rows[0]);
//   }
// });

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   const url = `http://localhost:${PORT}`;
  
//   console.log(`✅ Server running at ${url}`);
//   console.log(`📚 Swagger UI: ${url}/api-docs`);
  

//   // const command = process.platform === 'win32' 
//   //   ? `start ${url}/api-docs` 
//   //   : process.platform === 'darwin' 
//   //     ? `open ${url}/api-docs` 
//   //     : `xdg-open ${url}/api-docs`;
  
//   // exec(command, (error) => {
//   //   if (error) {
//   //     console.log('⚠️  Could not open browser. Please visit manually:', `${url}/api-docs`);
//   //   }
//   // });
// });


// src/server.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Import routes
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');

// Import middleware
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Import database connection
require('./db');

// Initialize Express app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Request logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Welcome route
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'APRCS Backend API',
    version: '1.0.0',
    documentation: `${req.protocol}://${req.get('host')}/api/docs`,
    endpoints: {
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        profile: 'GET /api/auth/profile'
      },
      users: {
        getAll: 'GET /api/users',
        getById: 'GET /api/users/:id',
        stats: 'GET /api/users/stats'
      }
    },
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// API Documentation route
app.get('/api/docs', (req, res) => {
  res.json({
    title: 'APRCS API Documentation',
    description: 'Alhuda Partner Referral & Commission System',
    version: '1.0.0',
    baseUrl: `${req.protocol}://${req.get('host')}/api`,
    endpoints: {
      auth: {
        register: {
          method: 'POST',
          path: '/auth/register',
          description: 'Register new user',
          body: {
            email: 'string',
            password: 'string',
            first_name: 'string (optional)',
            last_name: 'string (optional)',
            phone: 'string (optional)',
            company_name: 'string (optional)',
            role: "'admin_a', 'admin_b', or 'admin_c'"
          }
        },
        login: {
          method: 'POST',
          path: '/auth/login',
          description: 'User login',
          body: {
            email: 'string',
            password: 'string'
          }
        }
      }
    }
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// 404 Handler
app.use(notFoundHandler);

// Error Handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`
  🚀 APRCS Backend Server Started!
  ---------------------------------
  📍 Port: ${PORT}
  🌍 Environment: ${process.env.NODE_ENV}
  🗄️ Database: ${process.env.DB_HOST}
  🔗 API URL: http://localhost:${PORT}/api
  📚 Docs: http://localhost:${PORT}/api/docs
  ---------------------------------
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(' Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('💤 Process terminated.');
  });
});

module.exports = app;