require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const ytsr = require('ytsr');
const scdl = require('soundcloud-scraper');

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

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Hybrid search - YouTube + SoundCloud
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }
  
  const results = [];
  
  // Search YouTube
  try {
    const ytResults = await ytsr(query, { limit: 5 });
    ytResults.items
      .filter(item => item.type === 'video')
      .forEach(item => {
        results.push({
          source: 'youtube',
          id: item.id,
          title: item.title,
          thumbnail: item.bestThumbnail?.url || `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
          artist: item.author?.name || 'Unknown',
          duration: item.duration,
          url: `https://www.youtube.com/watch?v=${item.id}`
        });
      });
  } catch (err) {
    console.error('YouTube search error:', err);
  }
  
  // Search SoundCloud
  try {
    const scResults = await scdl.search({
      query: query,
      resourceType: 'tracks',
      limit: 5
    });
    
    scResults.forEach(track => {
      results.push({
        source: 'soundcloud',
        id: track.id,
        title: track.title,
        thumbnail: track.artwork_url || track.user?.avatar_url || 'https://via.placeholder.com/300',
        artist: track.user?.username || 'Unknown',
        duration: track.duration ? Math.round(track.duration / 1000) : 0,
        url: track.permalink_url,
        streamUrl: track.media?.transcodings?.[0]?.url
      });
    });
  } catch (err) {
    console.error('SoundCloud search error:', err);
  }
  
  res.json(results.slice(0, 10)); // Return top 10 combined results
});

// API to create a new room
app.get('/api/create-room', (req, res) => {
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
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    currentRoom = roomId;
    userName = name || `User-${socket.id.slice(0, 4)}`;
    
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

  // Play a video/track
  socket.on('play-video', ({ id, title, thumbnail, artist, source, streamUrl }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.currentVideo = { 
      id, 
      title, 
      thumbnail, 
      artist,
      source, // 'youtube' or 'soundcloud'
      streamUrl // For SoundCloud
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
      streamUrl,
      isPlaying: true,
      currentTime: 0
    });
    console.log(`Playing ${title} (${source}) in room ${currentRoom}`);
  });

  // Play/Pause toggle
  socket.on('toggle-play', ({ isPlaying, currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

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
  socket.on('add-to-queue', ({ id, title, thumbnail, artist, source, streamUrl }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.queue.push({ 
      id, 
      title, 
      thumbnail, 
      artist, 
      source,
      streamUrl,
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
      streamUrl: next.streamUrl,
      isPlaying: true,
      currentTime: 0
    });
    io.to(currentRoom).emit('queue-updated', { queue: room.queue });
  });

  // Chat message
  socket.on('chat-message', ({ message }) => {
    io.to(currentRoom).emit('chat-message', {
      user: userName,
      message,
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
