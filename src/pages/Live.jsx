import { useNavigate } from "react-router-dom";
import LiveOddsCard from "../components/LiveOddsCard";
import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Live() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [joinUrl, setJoinUrl] = useState("");

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const createMeeting = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/meeting/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ title: meetingTitle, hostName: user.name })
      });

      const data = await response.json();
      setJoinUrl(data.joinUrl);
    } catch (error) {
      alert("Failed to create meeting");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(joinUrl);
    alert("Link copied!");
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", padding: 20, background: "#1e293b", color: "white" }}>
        <div>
          <h2>Live Matches</h2>
          <p>Welcome, {user.name}</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowCreateMeeting(!showCreateMeeting)} style={{ padding: "10px 20px", background: "#27ae60", color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
            Create Meeting
          </button>
          <button onClick={handleLogout} style={{ padding: "10px 20px", background: "#e74c3c", color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
            Logout
          </button>
        </div>
      </div>

      {showCreateMeeting && (
        <div style={{ padding: 20, background: "#f8f9fa", borderBottom: "1px solid #ddd" }}>
          <h3>Create New Meeting</h3>
          <input
            type="text"
            placeholder="Meeting Title"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            style={{ padding: 10, width: 300, marginRight: 10 }}
          />
          <button onClick={createMeeting} style={{ padding: "10px 20px", background: "#3498db", color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
            Create
          </button>

          {joinUrl && (
            <div style={{ marginTop: 15 }}>
              <p>Meeting created! Share this link:</p>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="text"
                  value={joinUrl}
                  readOnly
                  style={{ padding: 10, width: 400 }}
                />
                <button onClick={copyLink} style={{ padding: "10px 20px", background: "#27ae60", color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
                  Copy Link
                </button>
                <button onClick={() => navigate(joinUrl.replace('http://localhost:3000', ''))} style={{ padding: "10px 20px", background: "#9b59b6", color: "white", border: "none", borderRadius: 5, cursor: "pointer" }}>
                  Join Now
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <LiveOddsCard />
    </div>
  );
}