require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const ytsr = require('ytsr');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Environment variable validation
if (!process.env.YOUTUBE_API_KEY) {
  console.error('❌ ERROR: YOUTUBE_API_KEY is not set in .env file');
  console.error('Please copy .env.example to .env and add your YouTube API key');
  console.error('Get your API key at: https://console.cloud.google.com/apis/credentials');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Store active rooms
const rooms = new Map();

// ========== Input Validation Utilities ==========
function validateString(str, minLength = 1, maxLength = 500) {
  return typeof str === 'string' &&
         str.trim().length >= minLength &&
         str.trim().length <= maxLength;
}

function validateRoomId(roomId) {
  // Room IDs are 8-character UUIDs (alphanumeric + dashes)
  return typeof roomId === 'string' &&
         /^[a-zA-Z0-9-]{8}$/.test(roomId);
}

function validateVideoData(data) {
  if (!data || typeof data !== 'object') return false;

  const hasValidId = validateString(data.id, 1, 100);
  const hasValidTitle = validateString(data.title, 1, 200);
  const hasValidSource = data.source === 'youtube'; // YouTube-only now

  // Optional fields - validate if present
  const thumbnailValid = !data.thumbnail || validateString(data.thumbnail, 1, 500);
  const artistValid = !data.artist || validateString(data.artist, 1, 100);

  return hasValidId && hasValidTitle && hasValidSource && thumbnailValid && artistValid;
}

function validateNumber(num, min = 0, max = Infinity) {
  return typeof num === 'number' &&
         !isNaN(num) &&
         num >= min &&
         num <= max;
}

function sanitizeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function validateBoolean(val) {
  return typeof val === 'boolean';
}
// ================================================

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ========== Rate Limiting ==========
// Search API rate limiter: 20 requests per minute per IP
const searchLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 requests per window
  message: { error: 'Too many search requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Room creation rate limiter: 5 rooms per 5 minutes per IP
const createRoomLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 requests per window
  message: { error: 'Too many rooms created, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
// ===================================

// YouTube search
app.get('/api/search', searchLimiter, async (req, res) => {
  const query = req.query.q;

  // Validate search query
  if (!validateString(query, 1, 100)) {
    return res.status(400).json({ error: 'Invalid search query (1-100 characters required)' });
  }

  // Search YouTube
  try {
    const ytResults = await ytsr(query, { limit: 10 });
    const results = ytResults.items
      .filter(item => item.type === 'video')
      .map(item => ({
        source: 'youtube',
        id: item.id,
        title: item.title,
        thumbnail: item.bestThumbnail?.url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
        artist: item.author?.name || 'Unknown',
        duration: item.duration,
        url: `https://www.youtube.com/watch?v=${item.id}`
      }));

    res.json(results);
  } catch (err) {
    console.error('YouTube search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// API to create a new room
app.get('/api/create-room', createRoomLimiter, (req, res) => {
  const roomId = uuidv4().slice(0, 8);
  rooms.set(roomId, {
    id: roomId,
    users: [],
    currentVideo: null,
    isPlaying: false,
    currentTime: 0,
    lastUpdate: Date.now(),
    queue: [],
    host: null
  });
  res.json({ roomId });
});

// Join room page
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  let currentRoom = null;
  let userName = null;

  // Join a room
  socket.on('join-room', ({ roomId, name }) => {
    // Validate roomId
    if (!validateRoomId(roomId)) {
      socket.emit('error', { message: 'Invalid room ID format' });
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Validate and sanitize name
    if (name && !validateString(name, 1, 30)) {
      socket.emit('error', { message: 'Invalid name (1-30 characters required)' });
      return;
    }

    currentRoom = roomId;
    userName = name ? sanitizeHtml(name.trim()) : `User-${socket.id.slice(0, 4)}`;
    
    // Add user to room
    room.users.push({ id: socket.id, name: userName });
    
    // First user becomes host
    if (!room.host) {
      room.host = socket.id;
    }

    socket.join(roomId);
    
    // Send current state to the new user
    socket.emit('room-state', {
      roomId: room.id,
      users: room.users,
      currentVideo: room.currentVideo,
      isPlaying: room.isPlaying,
      currentTime: room.currentTime + (room.isPlaying ? (Date.now() - room.lastUpdate) / 1000 : 0),
      queue: room.queue,
      isHost: room.host === socket.id
    });

    // Notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: userName });
    console.log(`${userName} joined room ${roomId}`);
  });

  // Play a video
  socket.on('play-video', ({ id, title, thumbnail, artist, source }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Validate video data
    const videoData = { id, title, thumbnail, artist, source };
    if (!validateVideoData(videoData)) {
      socket.emit('error', { message: 'Invalid video data' });
      return;
    }

    room.currentVideo = {
      id,
      title,
      thumbnail,
      artist,
      source
    };
    room.isPlaying = true;
    room.currentTime = 0;
    room.lastUpdate = Date.now();

    io.to(currentRoom).emit('video-changed', {
      id,
      title,
      thumbnail,
      artist,
      source,
      isPlaying: true,
      currentTime: 0
    });
    console.log(`Playing ${title} in room ${currentRoom}`);
  });

  // Play/Pause toggle
  socket.on('toggle-play', ({ isPlaying, currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Validate inputs
    if (!validateBoolean(isPlaying) || !validateNumber(currentTime, 0)) {
      socket.emit('error', { message: 'Invalid play state data' });
      return;
    }

    room.isPlaying = isPlaying;
    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('play-state-changed', {
      isPlaying,
      currentTime
    });
  });

  // Seek
  socket.on('seek', ({ currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Validate currentTime
    if (!validateNumber(currentTime, 0)) {
      socket.emit('error', { message: 'Invalid seek time' });
      return;
    }

    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('seeked', { currentTime });
  });

  // Sync request
  socket.on('sync-request', () => {
    const room = rooms.get(currentRoom);
    if (!room || !room.currentVideo) return;

    const actualTime = room.currentTime + (room.isPlaying ? (Date.now() - room.lastUpdate) / 1000 : 0);
    socket.emit('sync-response', {
      currentTime: actualTime,
      isPlaying: room.isPlaying
    });
  });

  // Add to queue
  socket.on('add-to-queue', ({ id, title, thumbnail, artist, source }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Validate video data
    const videoData = { id, title, thumbnail, artist, source };
    if (!validateVideoData(videoData)) {
      socket.emit('error', { message: 'Invalid video data for queue' });
      return;
    }

    // Limit queue size to prevent abuse
    if (room.queue.length >= 50) {
      socket.emit('error', { message: 'Queue is full (max 50 items)' });
      return;
    }

    room.queue.push({
      id,
      title,
      thumbnail,
      artist,
      source,
      addedBy: userName
    });
    io.to(currentRoom).emit('queue-updated', { queue: room.queue });
  });

  // Play next in queue
  socket.on('play-next', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.queue.length === 0) return;

    const next = room.queue.shift();
    room.currentVideo = next;
    room.isPlaying = true;
    room.currentTime = 0;
    room.lastUpdate = Date.now();

    io.to(currentRoom).emit('video-changed', {
      id: next.id,
      title: next.title,
      thumbnail: next.thumbnail,
      artist: next.artist,
      source: next.source,
      isPlaying: true,
      currentTime: 0
    });
    io.to(currentRoom).emit('queue-updated', { queue: room.queue });
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    // Validate and sanitize message
    if (!validateString(message, 1, 500)) {
      socket.emit('error', { message: 'Invalid chat message (1-500 characters required)' });
      return;
    }

    const sanitizedMessage = sanitizeHtml(message.trim());

    io.to(currentRoom).emit('chat-message', {
      user: userName,
      message: sanitizedMessage,
      timestamp: Date.now()
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users = room.users.filter(u => u.id !== socket.id);
        
        // If host left, assign new host
        if (room.host === socket.id && room.users.length > 0) {
          room.host = room.users[0].id;
          io.to(room.host).emit('became-host');
        }
        
        // Clean up empty rooms
        if (room.users.length === 0) {
          rooms.delete(currentRoom);
          console.log(`Room ${currentRoom} deleted (empty)`);
        } else {
          socket.to(currentRoom).emit('user-left', { id: socket.id, name: userName });
        }
      }
    }
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Jim-jam server running at http://0.0.0.0:${PORT}`);
});
