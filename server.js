const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Add socket.io options for faster/more efficient updates
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Serve static files from the React app
app.use(express.static(path.join(__dirname, "build")));

// Fallback to index.html for all other routes
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

// Store active sessions
const sessions = {};

// Rate limit storage
const updateRateLimits = {};

// Debug log function
const debug = (message) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
};

io.on("connection", (socket) => {
  debug(`New client connected: ${socket.id}`);

  // Join a collaboration session
  socket.on("join-session", (sessionId) => {
    debug(`Client ${socket.id} joining session ${sessionId}`);
    socket.join(sessionId);

    // If this is the first user, initialize the session data
    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        users: [],
        code: "",
        language: null,
        documentVersion: 0,
      };
      debug(`Created new session: ${sessionId}`);
    }

    // Add user to session
    const user = {
      id: socket.id,
      color: generateRandomColor(),
    };
    sessions[sessionId].users.push(user);
    debug(
      `Added user ${socket.id} to session ${sessionId}, total users: ${sessions[sessionId].users.length}`
    );

    // Notify everyone in the session about the new user
    io.to(sessionId).emit("user-joined", {
      users: sessions[sessionId].users,
      joinedUser: user,
    });
    debug(`Notified session ${sessionId} about new user ${socket.id}`);

    // Send current session state to the new user
    socket.emit("session-data", {
      code: sessions[sessionId].code,
      language: sessions[sessionId].language,
      documentVersion: sessions[sessionId].documentVersion,
    });
    debug(`Sent session data to user ${socket.id}`);
  });

  // Set up rate limiting for each socket
  updateRateLimits[socket.id] = {
    lastUpdate: Date.now(),
    updateCount: 0,
    queuedUpdate: null,
    lastCursorUpdate: Date.now(),
  };

  // Handle code updates with improved efficiency
  socket.on("code-update", ({ sessionId, code }) => {
    if (!sessions[sessionId]) {
      debug(`Received code update for non-existent session: ${sessionId}`);
      return;
    }

    debug(`Received code update from ${socket.id} for session ${sessionId}`);

    const now = Date.now();
    const rateLimitData = updateRateLimits[socket.id];

    // Update session data and document version
    sessions[sessionId].code = code;
    sessions[sessionId].documentVersion++;

    debug(
      `Broadcasting code update to session ${sessionId}, document version: ${sessions[sessionId].documentVersion}`
    );

    // Broadcast to everyone (including sender for validation)
    io.to(sessionId).emit("code-updated", {
      code,
      userId: socket.id,
      version: sessions[sessionId].documentVersion,
    });
  });

  // Handle language changes
  socket.on("language-change", ({ sessionId, language }) => {
    if (sessions[sessionId]) {
      debug(
        `Received language change from ${socket.id} for session ${sessionId}: ${
          language?.value || "unknown"
        }`
      );
      sessions[sessionId].language = language;
      // Broadcast to everyone in the session
      io.to(sessionId).emit("language-changed", {
        language,
        userId: socket.id,
      });
    }
  });

  // Handle cursor position updates with rate limiting
  socket.on("cursor-position", ({ sessionId, position }) => {
    if (!sessions[sessionId]) return;

    // Rate limit cursor updates to max 30 per second
    const now = Date.now();
    const rateLimitData = updateRateLimits[socket.id];

    if (now - rateLimitData.lastCursorUpdate < 33) {
      return; // Skip this update if too frequent
    }

    rateLimitData.lastCursorUpdate = now;

    // Broadcast cursor position to others in the session
    socket.to(sessionId).emit("remote-cursor", {
      userId: socket.id,
      position,
    });
  });

  // Handle edit activity notifications
  socket.on(
    "edit-activity",
    ({ sessionId, lineNumber, endLineNumber, userId }) => {
      if (!sessions[sessionId]) {
        debug(`Received edit activity for non-existent session: ${sessionId}`);
        return;
      }

      debug(
        `Received edit activity from ${
          socket.id
        } for session ${sessionId}, lines ${lineNumber}-${
          endLineNumber || lineNumber
        }`
      );

      // Broadcast edit activity to all users in the session
      io.to(sessionId).emit("edit-activity", {
        userId,
        lineNumber,
        endLineNumber,
        timestamp: Date.now(),
      });
    }
  );

  // Handle user disconnect
  socket.on("disconnect", () => {
    debug(`Client disconnected: ${socket.id}`);

    // Clean up rate limiting data
    delete updateRateLimits[socket.id];

    // Find and remove user from all sessions
    Object.keys(sessions).forEach((sessionId) => {
      const userIndex = sessions[sessionId].users.findIndex(
        (u) => u.id === socket.id
      );
      if (userIndex !== -1) {
        sessions[sessionId].users.splice(userIndex, 1);
        debug(
          `Removed user ${socket.id} from session ${sessionId}, remaining users: ${sessions[sessionId].users.length}`
        );
        io.to(sessionId).emit("user-left", {
          userId: socket.id,
          remainingUsers: sessions[sessionId].users,
        });

        // Clean up empty sessions
        if (sessions[sessionId].users.length === 0) {
          delete sessions[sessionId];
          debug(`Session ${sessionId} deleted - no users remaining`);
        }
      }
    });
  });
});

// Helper function to generate random colors
function generateRandomColor() {
  const colors = [
    "#FF6633",
    "#FFB399",
    "#FF33FF",
    "#FFFF99",
    "#00B3E6",
    "#E6B333",
    "#3366E6",
    "#999966",
    "#99FF99",
    "#B34D4D",
    "#80B300",
    "#809900",
    "#E6B3B3",
    "#6680B3",
    "#66991A",
    "#FF99E6",
    "#CCFF1A",
    "#FF1A66",
    "#E6331A",
    "#33FFCC",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => debug(`Server running on port ${PORT}`));
