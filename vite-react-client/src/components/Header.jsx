const USERS = [
  "dev_user_1",
  "dev_user_2",
  "dev_user_3",
  "dev_user_4",
  "dev_user_5",
  "dev_user_6",
  "dev_user_7",
  "dev_user_8",
];

const Header = ({ currentUserId, onUserSelect, isConnected }) => {
  return (
    <div className="header">
      <h1>🎮 Tournament Test Client</h1>
      <p>Open multiple tabs to simulate different users</p>
      <div className="user-selector">
        {USERS.map((userId) => (
          <div
            key={userId}
            className={`user-tab ${userId === currentUserId ? "active" : ""} ${
              isConnected && userId === currentUserId ? "connected" : ""
            }`}
            onClick={() => onUserSelect(userId)}
          >
            {userId}
          </div>
        ))}
      </div>
    </div>
  );
};

export default Header;
