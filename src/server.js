const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ytsr = require('ytsr');

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// ============================================
// DATA STORAGE (In-memory)
// ============================================
const rooms = new Map();
const userSockets = new Map(); // socketId -> user info

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate a 6-character room code
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Get room data (for broadcasting)
function getRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  return {
    id: roomId,
    users: room.users,
    queue: room.queue,
    currentSong: room.currentSong,
    isPlaying: room.isPlaying,
    currentTime: room.currentTime,
    createdAt: room.createdAt
  };
}

// ============================================
// REST API ENDPOINTS
// ============================================

// GET: Fetch room state
app.get('/api/room/:roomId', (req, res) => {
  const roomState = getRoomState(req.params.roomId);
  if (!roomState) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json(roomState);
});

// GET: Search YouTube for songs
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  
  if (!query) {
    return res.status(400).json({ error: 'Missing search query' });
  }

  try {
    const searchResults = await ytsr(query, { limit: 10 });
    
    const results = searchResults.items
      .filter(item => item.type === 'video')
      .map(item => ({
        videoId: item.id,
        title: item.title,
        channel: item.author?.name || 'Unknown',
        duration: item.duration || '0:00',
        thumbnail: item.bestThumbnail?.url || item.thumbnails?.[0]?.url || '',
        views: item.views || 0
      }))
      .slice(0, 10);

    res.json(results);
  } catch (err) {
    console.error('YouTube search error:', err);
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
});

// Audio is handled via YouTube IFrame API embedded in frontend
// No backend audio extraction needed

// ============================================
// SOCKET.IO EVENTS
// ============================================

io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  let currentRoom = null;
  let userName = null;
  let userId = uuidv4().slice(0, 8);

  // ==========================================
  // EVENT: User joins or creates a room
  // ==========================================
  socket.on('room:join', ({ roomCode, name, isCreating = false }) => {
    try {
      userName = name || `User-${userId.slice(0, 4)}`;
      
      let room;
      
      if (isCreating) {
        // CREATE NEW ROOM
        roomCode = generateRoomCode();
        room = {
          id: roomCode,
          users: [],
          queue: [],
          currentSong: null,
          isPlaying: false,
          currentTime: 0,
          createdAt: new Date(),
          host: socket.id
        };
        rooms.set(roomCode, room);
        console.log(`📍 Room created: ${roomCode}`);
      } else {
        // JOIN EXISTING ROOM
        room = rooms.get(roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }
        
        // Check capacity (max 2 users for MVP)
        if (room.users.length >= 2) {
          socket.emit('error', { message: 'Room is full (max 2 users)' });
          return;
        }
      }

      // Add user to room
      currentRoom = roomCode;
      room.users.push({ id: socket.id, name: userName, joinedAt: new Date() });
      userSockets.set(socket.id, { roomCode, userId, name: userName });

      // Join Socket.io room
      socket.join(roomCode);

      // Send room state to user
      socket.emit('room:joined', {
        roomCode,
        state: getRoomState(roomCode)
      });

      // Notify others in room
      socket.to(roomCode).emit('user:joined', {
        userId: socket.id,
        userName,
        users: room.users
      });

      console.log(`👤 ${userName} joined room ${roomCode}`);
    } catch (err) {
      console.error('room:join error:', err);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // ==========================================
  // EVENT: User leaves room
  // ==========================================
  socket.on('disconnect', () => {
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users = room.users.filter(u => u.id !== socket.id);

        if (room.users.length === 0) {
          // Delete empty room
          rooms.delete(currentRoom);
          console.log(`🗑️  Room deleted: ${currentRoom} (empty)`);
        } else {
          // Reassign host if needed
          if (room.host === socket.id) {
            room.host = room.users[0].id;
          }
          
          // Notify others
          io.to(currentRoom).emit('user:left', {
            userId: socket.id,
            userName,
            users: room.users
          });
        }
      }
    }

    userSockets.delete(socket.id);
    console.log(`❌ User disconnected: ${socket.id}`);
  });

  // ==========================================
  // EVENT: Queue management - Add song
  // ==========================================
  socket.on('queue:add', ({ videoId, title, channel, duration }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const song = {
      id: uuidv4().slice(0, 8),
      videoId,
      title,
      channel,
      duration,
      addedBy: userName,
      addedAt: new Date()
    };

    room.queue.push(song);

    // Broadcast to room
    io.to(currentRoom).emit('queue:updated', {
      queue: room.queue
    });

    console.log(`➕ Added to queue: ${title} (${currentRoom})`);
  });

  // ==========================================
  // EVENT: Queue management - Remove song
  // ==========================================
  socket.on('queue:remove', ({ songId }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.queue = room.queue.filter(s => s.id !== songId);

    // Broadcast to room
    io.to(currentRoom).emit('queue:updated', {
      queue: room.queue
    });

    console.log(`➖ Removed from queue: ${songId} (${currentRoom})`);
  });

  // ==========================================
  // EVENT: Play song from queue
  // ==========================================
  socket.on('song:play', ({ songId }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    const song = room.queue.find(s => s.id === songId);
    if (!song) return;

    room.currentSong = song;
    room.isPlaying = true;
    room.currentTime = 0;
    room.playStartedAt = Date.now();

    // Broadcast to room
    io.to(currentRoom).emit('song:playing', {
      song: room.currentSong,
      isPlaying: true,
      currentTime: 0
    });

    console.log(`▶️  Playing: ${song.title} (${currentRoom})`);
  });

  // ==========================================
  // EVENT: Play/Pause toggle
  // ==========================================
  socket.on('song:togglePlay', ({ isPlaying, currentTime }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.isPlaying = isPlaying;
    room.currentTime = currentTime;
    if (isPlaying) {
      room.playStartedAt = Date.now() - (currentTime * 1000);
    }

    // Broadcast to room
    io.to(currentRoom).emit('song:stateChanged', {
      isPlaying,
      currentTime
    });

    console.log(`${isPlaying ? '▶️' : '⏸️'} ${room.currentSong?.title} (${currentRoom})`);
  });

  // ==========================================
  // EVENT: Seek to time
  // ==========================================
  socket.on('song:seek', ({ currentTime }) => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    room.currentTime = currentTime;
    room.playStartedAt = Date.now() - (currentTime * 1000);

    // Broadcast to room
    io.to(currentRoom).emit('song:seeked', { currentTime });

    console.log(`⏩ Seeked to ${currentTime}s (${currentRoom})`);
  });

  // ==========================================
  // EVENT: Sync request (periodic sync)
  // ==========================================
  socket.on('sync:request', () => {
    if (!currentRoom) return;

    const room = rooms.get(currentRoom);
    if (!room) return;

    let actualTime = room.currentTime;
    if (room.isPlaying && room.playStartedAt) {
      actualTime = (Date.now() - room.playStartedAt) / 1000;
    }

    socket.emit('sync:response', {
      isPlaying: room.isPlaying,
      currentTime: actualTime,
      song: room.currentSong
    });
  });
});

// ============================================
// START SERVER
// ============================================
server.listen(PORT, () => {
  console.log(`\n🎵 JIM-JAM Server Running\n`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🚀 Ready for connections\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
