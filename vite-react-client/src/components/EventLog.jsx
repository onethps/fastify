const EventLog = ({ events }) => {
  return (
    <div className="panel" style={{ marginTop: "20px" }}>
      <h2>Event Log</h2>
      <div className="event-log">
        {events.map((event) => (
          <div key={event.id} className={`event-item ${event.type}`}>
            <span className="event-time">{event.time}</span>
            <span className="event-type">{event.type.toUpperCase()}</span>
            <span>{event.message}</span>
          </div>
        ))}
        {events.length === 0 && (
          <div
            style={{ color: "#94a3b8", textAlign: "center", padding: "20px" }}
          >
            No events yet. Connect and start testing!
          </div>
        )}
      </div>
    </div>
  );
};

export default EventLog;
