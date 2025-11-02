import { WebSocket } from 'ws';

let wssInstance;

/**
 * Initialize WebSocket service
 */
export const initSocketService = (wss) => {
  wssInstance = wss;
  
  wss.on('connection', (ws, req) => {
    console.log('✅ Client connected to WebSocket');
    
    // Send welcome message
    ws.send(JSON.stringify({ 
      type: 'connection', 
      message: 'Connected to Moodify-AI Real-time Server',
      timestamp: new Date().toISOString(),
    }));

    // Handle incoming messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('📨 Received:', data);
        
        // Handle different message types
        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;
          
          case 'subscribe':
            // Store user ID for targeted broadcasts
            ws.userId = data.userId;
            ws.send(JSON.stringify({ 
              type: 'subscribed', 
              userId: data.userId,
              timestamp: new Date().toISOString(),
            }));
            break;
          
          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err.message);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('❌ Client disconnected from WebSocket');
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
    });
  });

  console.log('WebSocket service initialized');
};

/**
 * Broadcast update to all connected clients
 */
export const broadcastUpdate = (data) => {
  if (!wssInstance) {
    console.warn('WebSocket server not initialized');
    return;
  }

  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  let sentCount = 0;
  
  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      // If data has userId, only send to that specific user
      if (data.userId && client.userId && client.userId !== data.userId) {
        return;
      }
      
      client.send(message);
      sentCount++;
    }
  });

  console.log(`📡 Broadcast sent to ${sentCount} client(s):`, data.type);
};

/**
 * Send update to specific user
 */
export const sendToUser = (userId, data) => {
  if (!wssInstance) {
    console.warn('WebSocket server not initialized');
    return;
  }

  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  let sent = false;

  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(message);
      sent = true;
    }
  });

  if (sent) {
    console.log(`📨 Message sent to user ${userId}:`, data.type);
  } else {
    console.log(`⚠️ User ${userId} not connected`);
  }
};

/**
 * Get connected clients count
 */
export const getConnectedCount = () => {
  if (!wssInstance) return 0;
  return Array.from(wssInstance.clients).filter(
    client => client.readyState === WebSocket.OPEN
  ).length;
};

// Example usage in other files:
// import { broadcastUpdate, sendToUser } from './services/socketService.js';
// 
// broadcastUpdate({ 
//   type: 'playlist_analyzed', 
//   userId: '123', 
//   moods: ['Happy', 'Energetic'] 
// });
//
// sendToUser('123', { 
//   type: 'notification', 
//   message: 'Your playlist is ready!' 
// });