import { useEffect, useState } from "react";
import "./App.css";
import Landing from "./components/Landing";
import { useCollaboration } from "./contexts/CollaborationContext";
import { ToastContainer } from "react-toastify";

function App() {
  const { joinSession, connected, socket } = useCollaboration();
  const [connectionError, setConnectionError] = useState(false);

  // Check connection status
  useEffect(() => {
    let checkTimer;

    // Give the socket time to connect
    const timeout = setTimeout(() => {
      if (!connected && socket) {
        console.error("WebSocket connection failed to establish");
        setConnectionError(true);
      }
    }, 5000);

    return () => {
      clearTimeout(timeout);
      if (checkTimer) clearInterval(checkTimer);
    };
  }, [connected, socket]);

  // Reset error state when connection is established
  useEffect(() => {
    if (connected) {
      setConnectionError(false);
    }
  }, [connected]);

  // Check for session ID in URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");

    if (sessionId && connected) {
      // Join the session if the ID is in the URL
      joinSession(sessionId);

      // Remove the parameter from the URL to avoid rejoining on refresh
      const url = new URL(window.location);
      url.searchParams.delete("session");
      window.history.replaceState({}, "", url);
    }
  }, [joinSession, connected]);

  return (
    <>
      {connectionError && (
        <div className="bg-red-600 text-white p-2 text-center">
          Could not connect to collaboration server. Real-time collaboration
          features may not work.
        </div>
      )}
      <Landing />
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        hideProgressBar={false}
        closeOnClick
        draggable
      />
    </>
  );
}

export default App;
