# 🎵 Jim-jam

> Real-time YouTube music synchronization app - Listen together with friends!

Jim-jam is a web application that allows multiple users to watch YouTube videos together in perfect sync. Create a room, invite friends, and enjoy synchronized playback, queue management, and live chat.

## ✨ Features

- **🎬 Real-time Sync**: All users in a room watch the same video at the same time
- **🔍 YouTube Search**: Search and play any YouTube video
- **📝 Queue Management**: Build and manage a playlist together
- **💬 Live Chat**: Chat with friends while listening
- **👥 User Management**: See who's in the room, with automatic host assignment
- **🔐 Secure**: Environment-based API keys, input validation, and XSS protection
- **⚡ Rate Limited**: Protection against API abuse
- **🧹 Auto Cleanup**: Inactive rooms are automatically cleaned up
- **📱 Responsive**: Works on desktop and mobile devices

## 🚀 Installation

### Prerequisites

- Node.js 14.x or higher
- npm or yarn
- YouTube Data API v3 key

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd jim-jam
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```

4. **Add your YouTube API key**

   Edit `.env` and replace `your_youtube_api_key_here` with your actual API key:
   ```
   YOUTUBE_API_KEY=your_actual_api_key_here
   ```

   To get a YouTube API key:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable YouTube Data API v3
   - Create credentials (API key)
   - Copy the API key to your `.env` file

5. **Start the server**
   ```bash
   npm start
   ```

6. **Open your browser**
   ```
   http://localhost:3000
   ```

## 📖 Usage

### Creating a Room

1. Visit the homepage at `http://localhost:3000`
2. Click "Create Room"
3. Share the room link with friends

### Joining a Room

1. Click the shared room link
2. Enter your name
3. Click "Join Room"

### Searching and Playing Music

1. Use the search bar to find YouTube videos
2. Click the play button (▶) to play immediately
3. Click the plus button (+) to add to queue

### Player Controls

- **Play/Pause**: Toggle playback
- **Back 10s**: Skip back 10 seconds
- **Next**: Skip to next video in queue

### Chat

Use the chat panel to communicate with other users in the room.

## 🔧 API Endpoints

### `GET /api/create-room`

Creates a new room and returns the room ID.

**Rate Limit**: 5 requests per 5 minutes per IP

**Response**:
```json
{
  "roomId": "abc12345"
}
```

### `GET /api/search?q=<query>`

Searches YouTube for videos matching the query.

**Rate Limit**: 20 requests per minute per IP

**Parameters**:
- `q` (required): Search query (1-100 characters)

**Response**:
```json
[
  {
    "source": "youtube",
    "id": "video_id",
    "title": "Video Title",
    "thumbnail": "https://...",
    "artist": "Channel Name",
    "duration": "3:45",
    "url": "https://youtube.com/watch?v=..."
  }
]
```

### `GET /room/:roomId`

Displays the room interface for the specified room ID.

## 🔌 Socket.IO Events

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{ roomId, name }` | Join a room with a username |
| `play-video` | `{ id, title, thumbnail, artist, source }` | Play a video |
| `toggle-play` | `{ isPlaying, currentTime }` | Toggle play/pause state |
| `seek` | `{ currentTime }` | Seek to a specific time |
| `add-to-queue` | `{ id, title, thumbnail, artist, source }` | Add video to queue |
| `play-next` | - | Play next video in queue |
| `chat-message` | `{ message }` | Send a chat message |
| `sync-request` | - | Request current playback state |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `room-state` | `{ roomId, users, currentVideo, isPlaying, currentTime, queue, isHost }` | Initial room state |
| `video-changed` | `{ id, title, thumbnail, artist, source, isPlaying, currentTime }` | Video changed |
| `play-state-changed` | `{ isPlaying, currentTime }` | Play/pause state changed |
| `seeked` | `{ currentTime }` | Playback position changed |
| `queue-updated` | `{ queue }` | Queue updated |
| `user-joined` | `{ id, name }` | User joined room |
| `user-left` | `{ id, name }` | User left room |
| `chat-message` | `{ user, message, timestamp }` | Chat message received |
| `became-host` | - | You became the host |
| `sync-response` | `{ currentTime, isPlaying }` | Response to sync request |
| `error` | `{ message }` | Error occurred |
| `inactivity-warning` | `{ message }` | Room will close soon |
| `room-closed` | `{ message }` | Room closed due to inactivity |

## 🔐 Security Features

- **Environment Variables**: API keys stored securely in `.env` file
- **Input Validation**: All user inputs validated and sanitized
- **XSS Protection**: HTML entities escaped in chat messages
- **Rate Limiting**:
  - Search API: 20 requests/minute per IP
  - Room creation: 5 rooms/5 minutes per IP
- **Queue Limits**: Maximum 50 videos per queue
- **Room TTL**: Inactive rooms cleaned up after 2 hours
- **Error Handling**: Comprehensive error handling with user-friendly messages

## 🛠️ Troubleshooting

### Server won't start

**Error**: `YOUTUBE_API_KEY is not set in .env file`
- Make sure you've created a `.env` file
- Ensure `YOUTUBE_API_KEY` is set with a valid API key

### Search not working

**Error**: `Search failed`
- Check your YouTube API key is valid
- Ensure you haven't exceeded your API quota
- Check your internet connection

### Video won't play

**Error**: `Embedding disabled for this video`
- Some videos cannot be embedded outside YouTube
- The app will automatically skip to the next video

### Connection issues

- Check your firewall settings
- Ensure port 3000 is not blocked
- Try refreshing the page
- Check browser console for errors

## 📁 Project Structure

```
jim-jam/
├── server.js           # Express server & Socket.IO logic
├── package.json        # Dependencies & scripts
├── .env               # Environment variables (gitignored)
├── .env.example       # Environment variables template
├── .gitignore         # Git ignore rules
├── README.md          # This file
└── public/
    ├── index.html     # Homepage
    └── room.html      # Room interface
```

## 🧪 Development

### Running in development mode

```bash
npm run dev
```

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key | Yes | - |
| `PORT` | Server port | No | 3000 |

## 📝 License

MIT

## 👤 Author

Tushar

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

## 📮 Support

For support, please open an issue in the repository.

---

**Note**: This application requires a valid YouTube Data API v3 key to function. Make sure to keep your API key secure and never commit it to version control.
