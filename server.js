import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

// Load routes
import authRoutes from './routes/authRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import transferRoutes from './routes/transferRoutes.js';
import userRoutes from './routes/userRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js'; // NEW
import analyticsRoutes from './routes/analyticsRoutes.js'; // NEW

// Load services
import { initSocketService } from './services/socketService.js';
import { connectRedis } from './services/cacheService.js';

// Config
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      'http://localhost:5173',
      'http://localhost:3000',
      'https://moodiq.netlify.app'
    ].filter(Boolean);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.CORS_ORIGIN === '*') {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (skip health checks)
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/favicon.ico') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/user', userRoutes);
app.use('/api/dashboard', dashboardRoutes); // NEW
app.use('/api/analytics', analyticsRoutes); // NEW

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'MoodiQ-AI Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      playlists: '/api/playlists',
      transfer: '/api/transfer',
      user: '/api/user',
      dashboard: '/api/dashboard',
      analytics: '/api/analytics',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    message: 'Route not found',
    path: req.path,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
});

// WebSocket Server
const wss = new WebSocketServer({ 
  server,
  path: '/ws',
});

initSocketService(wss);
console.log('✅ WebSocket server initialized on /ws');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    console.log('📊 Database:', mongoose.connection.name);
    
    // Connect to Redis (optional)
    if (process.env.ENABLE_CACHE === 'true' && process.env.REDIS_URL) {
      connectRedis()
        .then(() => console.log('✅ Connected to Redis'))
        .catch((err) => {
          console.warn('⚠️ Redis connection failed:', err.message);
          console.warn('⚠️ Caching disabled, app will continue without Redis');
        });
    } else {
      console.log('ℹ️ Redis caching disabled');
    }
    
    // Start server
    server.listen(PORT, () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 MoodiQ-AI Backend Server Started');
      console.log('='.repeat(60));
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Server: http://localhost:${PORT}`);
      console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`🎯 Frontend: ${process.env.FRONTEND_URL || 'Not set'}`);
      console.log('='.repeat(60));
      console.log('\n📋 Available API Endpoints:');
      console.log('   /api/auth          - Authentication');
      console.log('   /api/playlists     - Playlist management');
      console.log('   /api/transfer      - Cross-platform transfer');
      console.log('   /api/user          - User preferences & sharing');
      console.log('   /api/dashboard     - Dashboard data & stats');
      console.log('   /api/analytics     - Real-time analytics');
      console.log('='.repeat(60) + '\n');
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error('⚠️ Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;