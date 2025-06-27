import React, { useState, useEffect } from "react";
import { useCollaboration } from "../contexts/CollaborationContext";
import { toast } from "react-toastify";

const CollaborationPanel = () => {
  const {
    connected,
    sessionId,
    users,
    isCollaborating,
    createSession,
    joinSession,
    leaveSession,
    getShareableLink,
    socket,
  } = useCollaboration();

  const [joinInput, setJoinInput] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("idle");
  const [lastActivity, setLastActivity] = useState(Date.now());

  // Set up activity monitoring for real-time indicators
  useEffect(() => {
    if (!isCollaborating || !socket) return;

    // Listen for real-time events to show activity
    const handleCodeUpdated = () => {
      setRealtimeStatus("receiving");
      setLastActivity(Date.now());

      // Reset status after a short delay
      setTimeout(() => {
        setRealtimeStatus("idle");
      }, 1000);
    };

    const handleUserActivity = () => {
      setLastActivity(Date.now());
    };

    socket.on("code-updated", handleCodeUpdated);
    socket.on("remote-cursor", handleUserActivity);
    socket.on("user-joined", handleUserActivity);
    socket.on("user-left", handleUserActivity);

    // Cleanup listeners
    return () => {
      socket.off("code-updated", handleCodeUpdated);
      socket.off("remote-cursor", handleUserActivity);
      socket.off("user-joined", handleUserActivity);
      socket.off("user-left", handleUserActivity);
    };
  }, [isCollaborating, socket]);

  // Show sending indicator when local user types
  const updateSendingStatus = () => {
    if (!isCollaborating) return;
    setRealtimeStatus("sending");
    setLastActivity(Date.now());

    // Reset status after a short delay
    setTimeout(() => {
      setRealtimeStatus("idle");
    }, 500);
  };

  // Expose update status function to parent via global (not ideal but works for this example)
  useEffect(() => {
    if (window) {
      window.updateCollaborationStatus = updateSendingStatus;
    }
    return () => {
      if (window) {
        delete window.updateCollaborationStatus;
      }
    };
  }, []);

  const handleCreateSession = () => {
    createSession();
    toast.success("New collaboration session created!");
  };

  const handleJoinSession = (e) => {
    e.preventDefault();
    if (!joinInput.trim()) {
      toast.error("Please enter a valid session ID");
      return;
    }
    joinSession(joinInput.trim());
    setJoinInput("");
  };

  const handleCopyLink = () => {
    const link = getShareableLink();
    if (link) {
      navigator.clipboard
        .writeText(link)
        .then(() => toast.success("Session link copied to clipboard!"))
        .catch(() => toast.error("Failed to copy link"));
    }
  };

  if (!connected) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 mb-4 rounded">
        <p>Collaboration server not connected. Please try again later.</p>
      </div>
    );
  }

  if (!isCollaborating) {
    return (
      <div className="bg-white p-4 mb-4 rounded-md shadow">
        <h2 className="text-lg font-bold mb-2">Start Collaborating</h2>
        <div className="flex flex-col gap-4">
          <button
            onClick={handleCreateSession}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded transition"
          >
            Create New Session
          </button>
          <div className="text-center text-gray-500 font-bold">OR</div>
          <form onSubmit={handleJoinSession} className="flex flex-col gap-2">
            <input
              type="text"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="Enter Session ID"
              className="px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded transition"
            >
              Join Session
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Calculate status indicator colors
  const getStatusColor = () => {
    switch (realtimeStatus) {
      case "sending":
        return "bg-yellow-500";
      case "receiving":
        return "bg-green-500";
      default:
        // Check if there was recent activity
        const timeSinceLastActivity = Date.now() - lastActivity;
        if (timeSinceLastActivity < 10000) {
          // 10 seconds
          return "bg-green-300";
        }
        return "bg-gray-300";
    }
  };

  return (
    <div className="bg-white p-4 mb-4 rounded-md shadow">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">Collaboration Session</h2>
          <div
            className={`h-3 w-3 rounded-full ${getStatusColor()}`}
            title="Real-time status"
          ></div>
          <div className="text-xs text-gray-500">
            {realtimeStatus === "sending" && "Sending..."}
            {realtimeStatus === "receiving" && "Receiving..."}
            {realtimeStatus === "idle" && "Connected"}
          </div>
        </div>
        <button
          onClick={leaveSession}
          className="bg-red-500 hover:bg-red-600 text-white text-sm px-2 py-1 rounded transition"
        >
          Leave Session
        </button>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-semibold">Session ID:</span>
          <code className="bg-gray-100 px-2 py-1 rounded text-sm">
            {sessionId}
          </code>
          <button
            onClick={handleCopyLink}
            className="bg-gray-200 hover:bg-gray-300 text-sm px-2 py-1 rounded transition"
          >
            Copy Link
          </button>
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-2">Collaborators ({users.length})</h3>
        <div className="flex flex-wrap gap-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center gap-1 rounded px-2 py-1 bg-gray-100"
            >
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: user.color }}
              ></div>
              <span className="text-sm">
                {user.id === sessionId
                  ? "You"
                  : `User ${user.id.substring(0, 5)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CollaborationPanel;
