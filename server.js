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
      callback(null, true); // Allow all in production
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware (skip health checks and favicon)
app.use((req, res, next) => {
  if (req.path !== '/health' && req.path !== '/favicon.ico') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  }
  next();
});

// Health check route (COMPLETELY SILENT - no logs)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Favicon route (prevent 404 spam)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/transfer', transferRoutes);
app.use('/api/user', userRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Moodify-AI Backend API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      playlists: '/api/playlists',
      transfer: '/api/transfer',
      user: '/api/user',
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
    
    // Connect to Redis (optional, won't crash if unavailable)
    // Only try to connect if Redis is enabled
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
      console.log('\n' + '='.repeat(50));
      console.log('🚀 Moodify-AI Backend Server Started');
      console.log('='.repeat(50));
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Server: http://localhost:${PORT}`);
      console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`🎯 Frontend: ${process.env.FRONTEND_URL || 'Not set'}`);
      console.log('='.repeat(50) + '\n');
      
      // Log critical environment variables
      console.log('⚙️ Configuration Check:');
      console.log(`  - FRONTEND_URL: ${process.env.FRONTEND_URL ? '✓' : '❌ MISSING'}`);
      console.log(`  - SPOTIFY_CLIENT_ID: ${process.env.SPOTIFY_CLIENT_ID ? '✓' : '❌ MISSING'}`);
      console.log(`  - SPOTIFY_CLIENT_SECRET: ${process.env.SPOTIFY_CLIENT_SECRET ? '✓' : '❌ MISSING'}`);
      console.log(`  - SPOTIFY_REDIRECT_URI: ${process.env.SPOTIFY_REDIRECT_URI ? '✓' : '❌ MISSING'}`);
      console.log(`  - MONGO_URI: ${process.env.MONGO_URI ? '✓' : '❌ MISSING'}`);
      console.log(`  - JWT_SECRET: ${process.env.JWT_SECRET ? '✓' : '❌ MISSING'}`);
      console.log('');
      
      if (!process.env.FRONTEND_URL) {
        console.error('❌ WARNING: FRONTEND_URL is not set! Authentication will fail.');
      }
      if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        console.error('❌ WARNING: Spotify credentials not set! Authentication will fail.');
      }
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

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

export default app;