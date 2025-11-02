import { createClient } from 'redis';

let redisClient;
let isConnected = false;

/**
 * Connect to Redis
 */
export const connectRedis = async () => {
  try {
    const redisUrl = process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('❌ Too many Redis reconnection attempts');
            return new Error('Too many retries');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err.message);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      console.log('🔄 Connecting to Redis...');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis client ready');
      isConnected = true;
    });

    redisClient.on('end', () => {
      console.log('❌ Redis connection closed');
      isConnected = false;
    });

    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    
    return redisClient;
  } catch (err) {
    console.error('Failed to connect to Redis:', err.message);
    isConnected = false;
    throw err;
  }
};

/**
 * Get value from cache
 */
export const getFromCache = async (key) => {
  if (!redisClient || !isConnected) {
    console.warn('Redis not available, skipping cache read');
    return null;
  }

  try {
    const data = await redisClient.get(key);
    
    if (data) {
      console.log(`📦 Cache HIT: ${key}`);
      return JSON.parse(data);
    }
    
    console.log(`📭 Cache MISS: ${key}`);
    return null;
  } catch (err) {
    console.error(`Error getting from cache (${key}):`, err.message);
    return null;
  }
};

/**
 * Set value in cache
 */
export const setInCache = async (key, value, expiration = 3600) => {
  if (!redisClient || !isConnected) {
    console.warn('Redis not available, skipping cache write');
    return false;
  }

  try {
    await redisClient.set(key, JSON.stringify(value), {
      EX: expiration,
    });
    
    console.log(`💾 Cache SET: ${key} (expires in ${expiration}s)`);
    return true;
  } catch (err) {
    console.error(`Error setting in cache (${key}):`, err.message);
    return false;
  }
};

/**
 * Delete key from cache
 */
export const deleteFromCache = async (key) => {
  if (!redisClient || !isConnected) {
    console.warn('Redis not available, skipping cache delete');
    return false;
  }

  try {
    await redisClient.del(key);
    console.log(`🗑️ Cache DELETE: ${key}`);
    return true;
  } catch (err) {
    console.error(`Error deleting from cache (${key}):`, err.message);
    return false;
  }
};

/**
 * Delete keys matching pattern
 */
export const deletePattern = async (pattern) => {
  if (!redisClient || !isConnected) {
    console.warn('Redis not available, skipping pattern delete');
    return false;
  }

  try {
    const keys = await redisClient.keys(pattern);
    
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`🗑️ Cache DELETE pattern: ${pattern} (${keys.length} keys)`);
    }
    
    return true;
  } catch (err) {
    console.error(`Error deleting pattern (${pattern}):`, err.message);
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
    console.warn('Redis not available, skipping cache flush');
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