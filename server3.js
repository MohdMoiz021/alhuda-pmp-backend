const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { testConnection } = require('./db');
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');

const casesRoutes = require('./src/routes/case.routes');
const conversationRoutes = require('./src/routes/conversationRoutes');

const app = express();

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const allowedOrigins = [
    'http://localhost:5173', // Vite default
    'http://localhost:3000', // Create React App default
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    process.env.FRONTEND_URL
].filter(Boolean);

// Configure CORS middleware
const corsOptions = {
    origin: [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:3000',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes - FIXED
// app.options('/:path(*)', (req, res) => {
//     const origin = req.headers.origin;
//     if (allowedOrigins.includes(origin)) {
//         res.header('Access-Control-Allow-Origin', origin);
//     }
//     res.header('Access-Control-Allow-Credentials', 'true');
//     res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
//     res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
//     res.status(200).end();
// });

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

// Store connected users
const connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    // User joins their personal room
    socket.on('register_user', (userId) => {
        socket.join(`user_${userId}`);
        connectedUsers.set(userId, socket.id);
        console.log(`User ${userId} registered with socket ${socket.id}`);
    });

    // Join conversation room
    socket.on('join_conversation', (conversationId) => {
        socket.join(`conversation_${conversationId}`);
        console.log(`Socket ${socket.id} joined conversation ${conversationId}`);
    });

    // Leave conversation room
    socket.on('leave_conversation', (conversationId) => {
        socket.leave(`conversation_${conversationId}`);
    });

    // Typing indicator
    socket.on('typing', (data) => {
        const { conversationId, userId, isTyping } = data;
        socket.to(`conversation_${conversationId}`).emit('user_typing', {
            userId,
            isTyping,
            conversationId
        });
    });

    // Message read receipt
    socket.on('message_read', (data) => {
        const { conversationId, messageId, userId } = data;
        socket.to(`conversation_${conversationId}`).emit('message_read_receipt', {
            messageId,
            userId,
            readAt: new Date(),
            conversationId
        });
    });

    // Disconnect
    socket.on('disconnect', () => {
        // Remove user from connected users
        for (const [userId, socketId] of connectedUsers.entries()) {
            if (socketId === socket.id) {
                connectedUsers.delete(userId);
                console.log(`User ${userId} disconnected`);
                break;
            }
        }
        console.log(`Client disconnected: ${socket.id}`);
    });

    // Error handling
    socket.on('error', (error) => {
        console.error('Socket error:', error);
    });
});

// Make io accessible to routes
app.set('io', io);

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - Origin: ${req.headers.origin || 'No Origin'}`);
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
    });
    
    next();
});

// Rate limiting - different limits for different routes
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.API_RATE_LIMIT || 100,
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: {
        success: false,
        message: 'Too many authentication attempts, please try again later.'
    }
});

// Apply rate limiting
app.use(generalLimiter);
app.use('/api/auth', authLimiter);

// Test database connection on startup
testConnection().then(isConnected => {
    if (isConnected) {
        console.log('✅ Database connected successfully');
    } else {
        console.log('⚠️ Database connection issues. Some features may not work properly.');
    }
});

// Static files for uploads
app.use('/uploads', express.static('uploads'));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cases', casesRoutes);
app.use('/api/conversations', conversationRoutes);

// ====================
// API Documentation Routes
// ====================

// Home route
app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Al Huda PMP Backend API',
        version: '1.0.0',
        status: 'running',
        cors: {
            allowed_origins: allowedOrigins,
            credentials: true
        },
        endpoints: {
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/profile',
                refresh_token: 'POST /api/auth/refresh-token',
                logout: 'POST /api/auth/logout'
            },
            users: {
                list: 'GET /api/users',
                get: 'GET /api/users/:id',
                update: 'PUT /api/users/:id',
                delete: 'DELETE /api/users/:id'
            },
            cases: {
                create: 'POST /api/cases',
                list: 'GET /api/cases',
                get: 'GET /api/cases/:id',
                update: 'PUT /api/cases/:id',
                update_status: 'PATCH /api/cases/:id/status',
                delete: 'DELETE /api/cases/:id'
            },
            conversations: {
                create: 'POST /api/conversations',
                case_conversations: 'GET /api/conversations/case/:caseId',
                get: 'GET /api/conversations/:conversationId',
                messages: 'GET /api/conversations/:conversationId/messages',
                send_message: 'POST /api/conversations/:conversationId/messages',
                participants: 'GET /api/conversations/:conversationId/participants',
                update_status: 'PATCH /api/conversations/:conversationId/status',
                update_priority: 'PATCH /api/conversations/:conversationId/priority',
                unread_count: 'GET /api/conversations/user/unread/count',
                recent: 'GET /api/conversations/user/recent',
                search: 'GET /api/conversations/search/conversations'
            },
            system: {
                health: 'GET /health',
                test_db: 'GET /api/test-db',
                socket_status: 'GET /api/socket-status',
                cors_test: 'GET /api/cors-test'
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    const health = {
        success: true,
        timestamp: new Date(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        database: 'unknown',
        websocket: io.engine.clientsCount,
        cors: {
            allowed_origins: allowedOrigins,
            request_origin: req.headers.origin || 'No Origin Header'
        }
    };

    // Check database connection
    const pool = require('./config/database').pool;
    pool.query('SELECT NOW() as time')
        .then(() => {
            health.database = 'connected';
            res.json(health);
        })
        .catch(() => {
            health.database = 'disconnected';
            res.json(health);
        });
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
    res.json({
        success: true,
        message: 'CORS test successful!',
        timestamp: new Date(),
        request: {
            origin: req.headers.origin,
            method: req.method,
            headers: req.headers
        },
        cors: {
            allowed_origins: allowedOrigins,
            your_origin: req.headers.origin,
            is_allowed: allowedOrigins.includes(req.headers.origin)
        }
    });
});

// Socket status endpoint
app.get('/api/socket-status', (req, res) => {
    res.json({
        success: true,
        connected_clients: io.engine.clientsCount,
        connected_users: Array.from(connectedUsers.keys()),
        allowed_origins: allowedOrigins,
        timestamp: new Date()
    });
});

// Test database connection
app.get('/api/test-db', async (req, res) => {
    try {
        const pool = require('./config/database').pool;
        const result = await pool.query('SELECT NOW() as time, version() as version');
        res.json({
            success: true,
            message: 'Database connected successfully',
            database: {
                time: result.rows[0].time,
                version: result.rows[0].version
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Database connection failed',
            error: error.message
        });
    }
});

// Welcome route
app.get('/home', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to Al Huda PMP Backend API',
        version: '1.0.0',
        status: 'running',
        services: {
            authentication: 'active',
            case_management: 'active',
            messaging: 'active',
            realtime_chat: 'active'
        },
        cors: {
            allowed_origins: allowedOrigins,
            current_origin: req.headers.origin
        }
    });
});

// Handle favicon requests
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: `Route not found: ${req.method} ${req.url}`,
        suggestion: 'Check the / endpoint for available routes',
        cors_info: {
            allowed_origins: allowedOrigins,
            your_origin: req.headers.origin
        }
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        origin: req.headers.origin,
        timestamp: new Date().toISOString()
    });

    // Handle CORS errors
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS Error: Origin not allowed',
            your_origin: req.headers.origin,
            allowed_origins: allowedOrigins
        });
    }

    // Handle multer file size errors
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            success: false,
            message: 'File too large. Maximum file size is 10MB.'
        });
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }

    // Handle validation errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: Object.values(err.errors).map(e => e.message)
        });
    }

    // Default error response
    res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Starting graceful shutdown...');
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received. Starting graceful shutdown...');
    server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`
    🚀 Al Huda PMP Backend Server Started!
    ===========================================
    📍 Port: ${PORT}
    🌍 URL: http://localhost:${PORT}
    🗄️  Environment: ${process.env.NODE_ENV || 'development'}
    ⚡ Real-time: WebSocket server active
    🌐 CORS Allowed Origins:
        ${allowedOrigins.join('\n        ')}
    ===========================================
    
    📋 Available Services:
    -----------------------
    🔐 Authentication API
    📁 Case Management API
    💬 Conversation & Messaging API
    ⚡ Real-time Chat (Socket.IO)
    -----------------------
    
    🔌 Socket.IO URL: ws://localhost:${PORT}
    📁 Uploads URL: http://localhost:${PORT}/uploads
    📊 Health Check: http://localhost:${PORT}/health
    🌐 CORS Test: http://localhost:${PORT}/api/cors-test
    ===========================================
    `);
});

module.exports = { app, server, io };