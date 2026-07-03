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
import dashboardRoutes from './routes/dashboardRoutes.js';
import analyticsRoutes from './routes/analyticsRoutes.js';
import liveListeningRoutes from './routes/LiveListeningRoutes.js';
import lyricsRoutes from './routes/lyricsRoutes.js';

// Load services
import { initSocketService } from './services/socketService.js';
import { connectRedis } from './services/cacheService.js';
import * as mlService from './services/mlService.js';

// Config
// Load environment variables (.env.development in development, .env otherwise)
if (process.env.NODE_ENV === 'development') {
  dotenv.config({ path: '.env.development' });
} else {
  dotenv.config();
}

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

// Health check route with ML service status
app.get('/health', async (req, res) => {
  const mlHealth = await mlService.checkHealth();
  
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      backend: 'healthy',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      ml: mlHealth.available ? 'available' : 'unavailable',
    }
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
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/live', liveListeningRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/lyrics', lyricsRoutes);  // ✅ FIXED: was missing, caused all lyrics to 404

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'MoodiQ-AI Backend API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      playlists: '/api/playlists',
      transfer: '/api/transfer',
      user: '/api/user',
      dashboard: '/api/dashboard',
    },
    mlIntegration: {
      enabled: true,
      url: process.env.ML_API_URL || 'https://moodiq-model.onrender.com',
      features: [
        'Mood Analysis',
        'Playlist Optimization',
        'Gap Detection',
        'Mood-based Generation',
        'Activity-based Generation',
        'Personalized Recommendations',
        'User Feedback Learning',
        'Real-time Analysis',
        'NLP Commands',
        'Mood Timeline'
      ]
    }
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
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    console.log('📊 Database:', mongoose.connection.name);
    
    // Connect to Redis (optional)
    if (process.env.ENABLE_CACHE === 'true' && process.env.REDIS_URL) {
      connectRedis()
        .then((client) => {
          if (client) {
            console.log('✅ Connected to Redis');
          }
        })
        .catch((err) => {
          console.warn('⚠️ Redis connection failed:', err.message);
          console.warn('⚠️ Caching disabled, app will continue without Redis');
        });
    } else {
      console.log('ℹ️ Redis caching disabled');
    }
    
    // Check ML service availability
    console.log('🤖 Checking ML service...');
    const mlHealth = await mlService.checkHealth();
    if (mlHealth.available) {
      console.log('✅ ML service is available');
      console.log('   URL:', process.env.ML_API_URL || 'https://moodiq-model.onrender.com');
    } else {
      console.warn('⚠️ ML service is currently unavailable');
      console.warn('   Some features may be limited');
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
      console.log(`🤖 ML Service: ${process.env.ML_API_URL || 'https://moodiq-model.onrender.com'}`);
      console.log('='.repeat(60));
      console.log('\n📋 Available API Endpoints:');
      console.log('   /api/auth              - Authentication & OAuth');
      console.log('   /api/playlists         - Playlist management + ML features');
      console.log('   /api/transfer          - Cross-platform transfer');
      console.log('   /api/user              - User preferences, feedback & learning');
      console.log('   /api/dashboard         - Dashboard data & stats');
      console.log('\n🎯 ML-Powered Features:');
      console.log('   • Mood Analysis & Prediction');
      console.log('   • Playlist Flow Optimization');
      console.log('   • Mood Gap Detection & Filling');
      console.log('   • Mood/Activity-based Generation');
      console.log('   • Personalized Recommendations');
      console.log('   • User Feedback Learning');
      console.log('   • Real-time Playback Analysis');
      console.log('   • NLP Voice Commands');
      console.log('   • Mood Timeline Analytics');
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