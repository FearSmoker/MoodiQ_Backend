import { createClient } from 'redis';

let redisClient;
let isConnected = false;
let connectionAttempted = false;

/**
 * Connect to Redis
 */
export const connectRedis = async () => {
  // Check if already attempted connection
  if (connectionAttempted) {
    console.log('ℹ️ Redis connection already attempted, skipping...');
    return redisClient;
  }

  connectionAttempted = true;

  // Check if caching is enabled
  if (process.env.ENABLE_CACHE === 'false') {
    console.log('ℹ️ Redis caching is disabled via ENABLE_CACHE=false');
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  
  if (!redisUrl) {
    console.warn('⚠️ REDIS_URL not configured. Caching disabled.');
    return null;
  }

  try {
    console.log('🔄 Attempting to connect to Redis...');
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          // CRITICAL: Limit reconnection attempts to prevent spam
          if (retries > 3) {
            console.error('❌ Redis reconnection failed after 3 attempts. Giving up.');
            isConnected = false;
            return new Error('Max reconnection attempts reached');
          }
          
          // Exponential backoff: 5s, 10s, 20s
          const delay = Math.min(retries * 5000, 20000);
          console.log(`⏳ Redis reconnecting in ${delay/1000}s (attempt ${retries}/3)...`);
          return delay;
        },
        connectTimeout: 10000, // 10 second connection timeout
      },
    });

    // CRITICAL: Only log once when error occurs
    let errorLogged = false;
    redisClient.on('error', (err) => {
      if (!errorLogged) {
        console.error('❌ Redis Client Error:', err.message);
        errorLogged = true;
      }
      isConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('🔄 Connecting to Redis...');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis client ready');
      isConnected = true;
      errorLogged = false; // Reset error flag when connection is restored
    });

    redisClient.on('end', () => {
      console.log('ℹ️ Redis connection closed');
      isConnected = false;
    });

    await redisClient.connect();
    
    // Test connection with timeout
    const pingTimeout = setTimeout(() => {
      throw new Error('Redis ping timeout');
    }, 5000);
    
    await redisClient.ping();
    clearTimeout(pingTimeout);
    
    console.log('✅ Redis connection verified');
    return redisClient;
    
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    console.warn('⚠️ App will continue without Redis caching');
    isConnected = false;
    redisClient = null;
    return null;
  }
};

/**
 * Get value from cache
 */
export const getFromCache = async (key) => {
  if (!redisClient || !isConnected) {
    return null; // Silently fail
  }

  try {
    const data = await redisClient.get(key);
    
    if (data) {
      // Only log in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`📦 Cache HIT: ${key}`);
      }
      return JSON.parse(data);
    }
    
    return null;
  } catch (err) {
    // Only log if it's not a connection error
    if (err.message !== 'Socket not connected') {
      console.error(`Error getting from cache (${key}):`, err.message);
    }
    return null;
  }
};

/**
 * Set value in cache
 */
export const setInCache = async (key, value, expiration = 3600) => {
  if (!redisClient || !isConnected) {
    return false; // Silently fail
  }

  try {
    await redisClient.set(key, JSON.stringify(value), {
      EX: expiration,
    });
    
    // Only log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`💾 Cache SET: ${key} (expires in ${expiration}s)`);
    }
    return true;
  } catch (err) {
    if (err.message !== 'Socket not connected') {
      console.error(`Error setting in cache (${key}):`, err.message);
    }
    return false;
  }
};

/**
 * Delete key from cache
 */
export const deleteFromCache = async (key) => {
  if (!redisClient || !isConnected) {
    return false;
  }

  try {
    await redisClient.del(key);
    if (process.env.NODE_ENV === 'development') {
      console.log(`🗑️ Cache DELETE: ${key}`);
    }
    return true;
  } catch (err) {
    if (err.message !== 'Socket not connected') {
      console.error(`Error deleting from cache (${key}):`, err.message);
    }
    return false;
  }
};

/**
 * Delete keys matching pattern
 */
export const deletePattern = async (pattern) => {
  if (!redisClient || !isConnected) {
    return false;
  }

  try {
    const keys = await redisClient.keys(pattern);
    
    if (keys.length > 0) {
      await redisClient.del(keys);
      if (process.env.NODE_ENV === 'development') {
        console.log(`🗑️ Cache DELETE pattern: ${pattern} (${keys.length} keys)`);
      }
    }
    
    return true;
  } catch (err) {
    if (err.message !== 'Socket not connected') {
      console.error(`Error deleting pattern (${pattern}):`, err.message);
    }
    return false;
  }
};

/**
 * Check if Redis is connected
 */
export const isRedisConnected = () => {
  return isConnected && redisClient && redisClient.isOpen;
};

/**
 * Flush all cache
 */
export const flushCache = async () => {
  if (!redisClient || !isConnected) {
    return false;
  }

  try {
    await redisClient.flushAll();
    console.log('🧹 Cache flushed');
    return true;
  } catch (err) {
    console.error('Error flushing cache:', err.message);
    return false;
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async () => {
  if (!redisClient || !isConnected) {
    return { connected: false };
  }

  try {
    const info = await redisClient.info('stats');
    const dbSize = await redisClient.dbSize();
    
    return {
      connected: true,
      dbSize,
      info,
    };
  } catch (err) {
    console.error('Error getting cache stats:', err.message);
    return { connected: false, error: err.message };
  }
};

export { redisClient };