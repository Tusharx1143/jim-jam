require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const ytsr = require('ytsr');
const rateLimit = require('express-rate-limit');
const fs = require('fs');

const DATA_DIR = './data';
const ROOMS_FILE = `${DATA_DIR}/rooms.json`;

const app = express();
const server = http.createServer(app);

// Allow requests from Capacitor mobile apps and browsers
const allowedOrigins = [
  /^https:\/\/wejam\.onrender\.com$/,          // Render deployment
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,    // Local network (for dev)
  /^capacitor:\/\//,                           // Capacitor iOS/Android
  /^ionic:\/\//,
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || allowedOrigins.some(r => r.test(origin))) {
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.some(r => r.test(origin))) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    methods: ['GET', 'POST']
  }
});

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

function saveRooms() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
    const data = {};
    rooms.forEach((room, id) => {
      data[id] = {
        id: room.id,
        currentVideo: room.currentVideo,
        isPlaying: room.isPlaying,
        currentTime: room.currentTime,
        lastUpdate: room.lastUpdate,
        lastActivity: room.lastActivity,
        queue: room.queue
      };
    });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(data));
  } catch (e) { console.error('saveRooms error:', e); }
}

function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    Object.values(data).forEach(r => {
      if (r.lastActivity > cutoff) {
        rooms.set(r.id, { ...r, users: [], host: null });
      }
    });
    console.log(`📂 Loaded ${rooms.size} rooms from disk`);
  } catch (e) { console.error('loadRooms error:', e); }
}

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

function updateRoomActivity(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    room.lastActivity = Date.now();
  }
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

// Trending endpoint — ytsr "top hits 2025" with 1-hour in-memory cache
let trendingCache = { data: null, timestamp: 0 };
const TRENDING_TTL = 60 * 60 * 1000;

app.get('/api/trending', async (req, res) => {
  if (trendingCache.data && Date.now() - trendingCache.timestamp < TRENDING_TTL) {
    return res.json(trendingCache.data);
  }
  try {
    const ytResults = await ytsr('top hits 2025', { limit: 15 });
    const results = ytResults.items
      .filter(item => item.type === 'video')
      .slice(0, 10)
      .map(item => ({
        source: 'youtube',
        id: item.id,
        title: item.title,
        thumbnail: item.bestThumbnail?.url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
        artist: item.author?.name || 'Unknown',
        duration: item.duration
      }));
    trendingCache = { data: results, timestamp: Date.now() };
    res.json(results);
  } catch (err) {
    console.error('Trending fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch trending' });
  }
});

// Health check — used by UptimeRobot to keep Render awake
app.get('/health', (req, res) => {
  res.json({ status: 'ok', rooms: rooms.size, uptime: Math.floor(process.uptime()) });
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
    lastActivity: Date.now(), // Track room activity for TTL cleanup
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

    // Update room activity
    updateRoomActivity(roomId);

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

    // Update room activity
    updateRoomActivity(currentRoom);

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
    saveRooms();
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

    // Update room activity
    updateRoomActivity(currentRoom);

    room.isPlaying = isPlaying;
    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('play-state-changed', {
      isPlaying,
      currentTime
    });
    saveRooms();
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

    // Update room activity
    updateRoomActivity(currentRoom);

    room.currentTime = currentTime;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('seeked', { currentTime });
    saveRooms();
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

    // Update room activity
    updateRoomActivity(currentRoom);

    room.queue.push({
      id,
      title,
      thumbnail,
      artist,
      source,
      addedBy: userName
    });
    io.to(currentRoom).emit('queue-updated', { queue: room.queue });
    saveRooms();
  });

  // Reorder queue
  socket.on('reorder-queue', ({ fromIndex, toIndex }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Validate indices
    if (
      typeof fromIndex !== 'number' ||
      typeof toIndex !== 'number' ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= room.queue.length ||
      toIndex >= room.queue.length
    ) {
      socket.emit('error', { message: 'Invalid queue reorder indices' });
      return;
    }

    // Update room activity
    updateRoomActivity(currentRoom);

    // Reorder the queue
    const [item] = room.queue.splice(fromIndex, 1);
    room.queue.splice(toIndex, 0, item);

    io.to(currentRoom).emit('queue-updated', { queue: room.queue });
    saveRooms();
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
    saveRooms();
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    // Validate and sanitize message
    if (!validateString(message, 1, 500)) {
      socket.emit('error', { message: 'Invalid chat message (1-500 characters required)' });
      return;
    }

    const sanitizedMessage = sanitizeHtml(message.trim());

    // Update room activity
    updateRoomActivity(currentRoom);

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
        // Remove user from room
        room.users = room.users.filter(u => u.id !== socket.id);

        // If host left, assign new host
        if (room.host === socket.id && room.users.length > 0) {
          room.host = room.users[0].id;
          io.to(room.host).emit('became-host');
        }

        // Notify others
        socket.to(currentRoom).emit('user-left', { id: socket.id, name: userName });

        // Leave the socket room
        socket.leave(currentRoom);

        // Keep empty rooms alive so refreshing users can rejoin with state intact.
        // The 2-hour TTL cleanup handles truly abandoned rooms.
        if (room.users.length === 0) {
          room.host = null; // reset so the next joiner becomes host
          console.log(`Room ${currentRoom} is now empty — keeping state for reconnection`);
        }
        saveRooms();
      }

      // Clear references to prevent memory leaks
      currentRoom = null;
      userName = null;
    }
    console.log('User disconnected:', socket.id);
  });
});

// ========== Room Cleanup (TTL) ==========
// Clean up inactive rooms every 10 minutes
const ROOM_INACTIVE_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const INACTIVITY_WARNING_TIME = 5 * 60 * 1000; // Warn 5 minutes before cleanup

setInterval(() => {
  const now = Date.now();
  const roomsToDelete = [];

  for (const [roomId, room] of rooms.entries()) {
    const inactiveDuration = now - room.lastActivity;

    // Warn users 5 minutes before room closure
    if (inactiveDuration >= ROOM_INACTIVE_TIMEOUT - INACTIVITY_WARNING_TIME &&
        inactiveDuration < ROOM_INACTIVE_TIMEOUT &&
        !room.warningsSent) {
      io.to(roomId).emit('inactivity-warning', {
        message: 'Room will be closed in 5 minutes due to inactivity'
      });
      room.warningsSent = true;
      console.log(`⚠️  Warning sent to room ${roomId} (inactive for ${Math.floor(inactiveDuration / 60000)} minutes)`);
    }

    // Delete rooms inactive for 2+ hours
    if (inactiveDuration >= ROOM_INACTIVE_TIMEOUT) {
      roomsToDelete.push(roomId);
    }
  }

  // Clean up inactive rooms
  roomsToDelete.forEach(roomId => {
    const room = rooms.get(roomId);
    if (room) {
      io.to(roomId).emit('room-closed', {
        message: 'Room closed due to inactivity'
      });
      rooms.delete(roomId);
      console.log(`🗑️  Deleted inactive room ${roomId} (${room.users.length} users)`);
    }
  });

  if (roomsToDelete.length > 0) {
    console.log(`✨ Cleaned up ${roomsToDelete.length} inactive room(s). Active rooms: ${rooms.size}`);
  }
}, CLEANUP_INTERVAL);
// ========================================

loadRooms();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 WeJam server running at http://0.0.0.0:${PORT}`);
});
