import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useContext,
  useRef,
} from "react";
import { io } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { toast } from "react-toastify";

// Create context
const CollaborationContext = createContext();

// Socket instance
let socket;

export const CollaborationProvider = ({ children }) => {
  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [users, setUsers] = useState([]);
  const [remoteCursors, setRemoteCursors] = useState({});
  const [isCollaborating, setIsCollaborating] = useState(false);
  const documentVersionRef = useRef(0);

  // Log function with timestamp
  const log = (message) => {
    console.log(`[${new Date().toISOString()}] ${message}`);
  };

  // Initialize socket connection with optimization options
  useEffect(() => {
    // Connect to the WebSocket server with optimized connection
    socket = io("http://localhost:5000", {
      transports: ["websocket"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    socket.on("connect", () => {
      log("Connected to collaboration server");
      setConnected(true);
    });

    socket.on("disconnect", () => {
      log("Disconnected from collaboration server");
      setConnected(false);
    });

    socket.on("connect_error", (error) => {
      log(`Connection error: ${error.message}`);
      toast.error("Failed to connect to collaboration server", {
        position: "bottom-right",
        autoClose: 3000,
      });
    });

    socket.on("user-joined", ({ users, joinedUser }) => {
      log(`User joined: ${joinedUser.id}`);
      setUsers(users);
      // Show notification
      if (joinedUser.id !== socket.id) {
        toast.info(`New collaborator joined!`, {
          position: "bottom-right",
          autoClose: 3000,
        });
      }
    });

    socket.on("user-left", ({ userId, remainingUsers }) => {
      log(`User left: ${userId}`);
      setUsers(remainingUsers);

      // Remove their cursor
      setRemoteCursors((prev) => {
        const newCursors = { ...prev };
        delete newCursors[userId];
        return newCursors;
      });

      // Show notification
      toast.info(`A collaborator left the session`, {
        position: "bottom-right",
        autoClose: 3000,
      });
    });

    socket.on("remote-cursor", ({ userId, position }) => {
      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: position,
      }));
    });

    socket.on("session-data", ({ code, language, documentVersion }) => {
      log(`Received initial session data, version: ${documentVersion}`);
      // Update document version
      if (documentVersion !== undefined) {
        documentVersionRef.current = documentVersion;
      }
    });

    // Clean up on unmount
    return () => {
      socket.disconnect();
    };
  }, []);

  // Create a new collaboration session
  const createSession = useCallback(() => {
    const newSessionId = uuidv4();
    log(`Creating new session: ${newSessionId}`);
    setSessionId(newSessionId);
    socket.emit("join-session", newSessionId);
    setIsCollaborating(true);
    return newSessionId;
  }, []);

  // Join an existing session
  const joinSession = useCallback((id) => {
    log(`Joining session: ${id}`);
    setSessionId(id);
    socket.emit("join-session", id);
    setIsCollaborating(true);
  }, []);

  // Leave the current session
  const leaveSession = useCallback(() => {
    if (sessionId) {
      log(`Leaving session: ${sessionId}`);
      // Reset state
      setSessionId(null);
      setUsers([]);
      setRemoteCursors({});
      setIsCollaborating(false);
      documentVersionRef.current = 0;
    }
  }, [sessionId]);

  // Update code in the session - optimized to reduce network traffic
  const updateCode = useCallback(
    (code) => {
      if (sessionId && connected) {
        log(`Sending code update to session: ${sessionId}`);
        socket.emit("code-update", { sessionId, code });
      }
    },
    [sessionId, connected]
  );

  // Update language in the session
  const updateLanguage = useCallback(
    (language) => {
      if (sessionId && connected) {
        log(`Sending language update to session: ${sessionId}`);
        socket.emit("language-change", { sessionId, language });
      }
    },
    [sessionId, connected]
  );

  // Update cursor position
  const updateCursorPosition = useCallback(
    (position) => {
      if (sessionId && connected) {
        socket.emit("cursor-position", { sessionId, position });
      }
    },
    [sessionId, connected]
  );

  // Get a shareable URL for the session
  const getShareableLink = useCallback(() => {
    if (!sessionId) return null;
    return `${window.location.origin}?session=${sessionId}`;
  }, [sessionId]);

  return (
    <CollaborationContext.Provider
      value={{
        connected,
        sessionId,
        users,
        remoteCursors,
        isCollaborating,
        createSession,
        joinSession,
        leaveSession,
        updateCode,
        updateLanguage,
        updateCursorPosition,
        getShareableLink,
        socket,
        documentVersion: documentVersionRef.current,
      }}
    >
      {children}
    </CollaborationContext.Provider>
  );
};

// Custom hook to use the collaboration context
export const useCollaboration = () => useContext(CollaborationContext);

export default CollaborationContext;
