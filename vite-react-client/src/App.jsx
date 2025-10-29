import { useState, useEffect } from "react";
import { useSocket } from "./hooks/useSocket";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import EventLog from "./components/EventLog";
import VotingPanel from "./components/VotingPanel";
import EliminatedScreen from "./components/EliminatedScreen";

const App = () => {
  const [currentUserId, setCurrentUserId] = useState("dev_user_1");
  const {
    socket,
    isConnected,
    connect,
    disconnect,
    events,
    tournamentData,
    currentRoomId,
    logEvent,
  } = useSocket(currentUserId);

  useEffect(() => {
    logEvent(
      "info",
      "Test client initialized. Select a user and click Connect."
    );
  }, [logEvent]);

  const handleUserSelect = (userId) => {
    if (socket?.connected) {
      disconnect();
    }
    setCurrentUserId(userId);
    logEvent("info", `Selected user: ${userId}`);
  };

  return (
    <div className="container">
      <Header
        currentUserId={currentUserId}
        onUserSelect={handleUserSelect}
        isConnected={isConnected}
      />

      <div className="main-content">
        <Sidebar
          isConnected={isConnected}
          currentUserId={currentUserId}
          onConnect={connect}
          onDisconnect={disconnect}
          socket={socket}
          logEvent={logEvent}
          currentRoomId={currentRoomId}
        />

        <div>
          {tournamentData.roomStage === "eliminated" ? (
            <>
              <EliminatedScreen currentUserId={currentUserId} />
              <EventLog events={events} />
            </>
          ) : (
            <>
              <Dashboard tournamentData={tournamentData} />
              <VotingPanel
                socket={socket}
                currentRoomId={currentRoomId}
                currentUserId={currentUserId}
                logEvent={logEvent}
              />
              <EventLog events={events} />
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
