import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Live() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [showCreateMeeting, setShowCreateMeeting] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [joinUrl, setJoinUrl] = useState("");
  const [myMeetings, setMyMeetings] = useState([]);
  const [activeView, setActiveView] = useState("dashboard"); // "dashboard", "meetings", "clients", or "matches"
  const [meetingsTab, setMeetingsTab] = useState("active"); // "active" or "closed"
  const [matchesTab, setMatchesTab] = useState("live"); // "live", "upcoming", or "ended"
  const [clients, setClients] = useState([]);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [clientForm, setClientForm] = useState({ name: "", number: "" });
  const [editingClient, setEditingClient] = useState(null);
  const [cricketMatches, setCricketMatches] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchTypeFilter, setMatchTypeFilter] = useState("all");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [loadingMatchDetails, setLoadingMatchDetails] = useState(false);
  const [selectedMeetingMatch, setSelectedMeetingMatch] = useState("");
  const [matchSearchQuery, setMatchSearchQuery] = useState("");
  const [showMatchDropdown, setShowMatchDropdown] = useState(false);

  useEffect(() => {
    if (activeView === "meetings") {
      fetchMyMeetings();
    } else if (activeView === "clients") {
      fetchClients();
    } else if (activeView === "dashboard") {
      fetchMyMeetings();
      fetchClients();
      fetchCricketMatches();
    } else if (activeView === "matches") {
      fetchCricketMatches();
    }
  }, [activeView]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login");
  };

  const fetchMyMeetings = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/meeting/user/my-meetings`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await response.json();
      setMyMeetings(data);
    } catch (error) {
      console.error("Failed to fetch meetings");
    }
  };

  const createMeeting = async () => {
    try {
      const token = localStorage.getItem("token");
      
      // Find the selected match details
      let matchData = null;
      if (selectedMeetingMatch) {
        const match = cricketMatches.find(m => m.id === selectedMeetingMatch);
        if (match) {
          matchData = {
            matchId: match.id,
            matchName: match.name,
            league: match.league
          };
        }
      }
      
      const response = await fetch(`${API_BASE_URL}/api/meeting/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          title: meetingTitle, 
          hostName: user.name,
          selectedMatch: matchData
        })
      });

      const data = await response.json();
      setJoinUrl(data.joinUrl);
      setMeetingTitle("");
      setSelectedMeetingMatch("");
      fetchMyMeetings();
    } catch (error) {
      alert("Failed to create meeting");
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(joinUrl);
    alert("Link copied!");
  };

  const toggleMeetingStatus = async (roomId) => {
    try {
      const token = localStorage.getItem("token");
      await fetch(`${API_BASE_URL}/api/meeting/${roomId}/toggle-status`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      fetchMyMeetings();
    } catch (error) {
      console.error("Failed to toggle meeting status");
    }
  };

  const activeMeetings = myMeetings.filter(m => m.isActive);
  const closedMeetings = myMeetings.filter(m => !m.isActive);

  const fetchClients = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/client/my-clients`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await response.json();
      setClients(data);
    } catch (error) {
      console.error("Failed to fetch clients");
    }
  };

  const fetchCricketMatches = async () => {
    setLoadingMatches(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/current-matches`);
      const data = await response.json();
      
      // Transform api-cricket.com format to our format
      const transformedMatches = (data.result || []).map(match => ({
        id: match.event_key,
        name: `${match.event_home_team} vs ${match.event_away_team}`,
        matchType: match.event_type || 'Unknown',
        status: match.event_status_info || match.event_status,
        venue: match.event_stadium || 'Unknown Venue',
        dateTimeGMT: `${match.event_date_start}T${match.event_time || '00:00'}:00`,
        matchStarted: match.event_live === "1" || match.event_status === "Finished",
        matchEnded: match.event_status === "Finished",
        score: match.event_home_final_result && match.event_away_final_result ? [
          {
            inning: match.event_home_team,
            r: match.event_home_final_result.split('/')[0] || match.event_home_final_result,
            w: match.event_home_final_result.includes('/') ? match.event_home_final_result.split('/')[1] : '-',
            o: '-'
          },
          {
            inning: match.event_away_team,
            r: match.event_away_final_result.split('/')[0] || match.event_away_final_result,
            w: match.event_away_final_result.includes('/') ? match.event_away_final_result.split('/')[1] : '-',
            o: '-'
          }
        ] : [],
        teams: [match.event_home_team, match.event_away_team],
        league: match.league_name
      }));
      
      // Sort by date/time (ascending - earliest first)
      transformedMatches.sort((a, b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));
      
      setCricketMatches(transformedMatches);
    } catch (error) {
      console.error("Failed to fetch cricket matches");
    } finally {
      setLoadingMatches(false);
    }
  };

  // Get filtered matches based on current filters
  const getFilteredMatches = (matches) => {
    return matches.filter(match => {
      const matchTypeMatch = matchTypeFilter === "all" || match.matchType === matchTypeFilter;
      const leagueMatch = leagueFilter === "all" || match.league === leagueFilter;
      return matchTypeMatch && leagueMatch;
    });
  };

  // Get unique match types and leagues for filters
  const matchTypes = ["all", ...new Set(cricketMatches.map(m => m.matchType).filter(Boolean))];
  const leagues = ["all", ...new Set(cricketMatches.map(m => m.league).filter(Boolean))];

  // Fetch detailed match information
  const fetchMatchDetails = async (matchId) => {
    setLoadingMatchDetails(true);
    setShowMatchDetails(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/match/${matchId}`);
      const data = await response.json();
      
      if (data.success && data.result && data.result.length > 0) {
        setSelectedMatch(data.result[0]);
      }
    } catch (error) {
      console.error("Failed to fetch match details");
    } finally {
      setLoadingMatchDetails(false);
    }
  };

  const closeMatchDetails = () => {
    setShowMatchDetails(false);
    setSelectedMatch(null);
  };

  const createClient = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/client/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(clientForm)
      });

      if (response.ok) {
        setClientForm({ name: "", number: "" });
        setShowCreateClient(false);
        fetchClients();
        alert("Client created successfully!");
      } else {
        alert("Failed to create client");
      }
    } catch (error) {
      alert("Failed to create client");
    }
  };

  const updateClient = async () => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/client/${editingClient._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(clientForm)
      });

      if (response.ok) {
        setClientForm({ name: "", number: "" });
        setEditingClient(null);
        fetchClients();
        alert("Client updated successfully!");
      } else {
        alert("Failed to update client");
      }
    } catch (error) {
      alert("Failed to update client");
    }
  };

  const deleteClient = async (id) => {
    if (!confirm("Are you sure you want to delete this client?")) return;

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${API_BASE_URL}/api/client/${id}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (response.ok) {
        fetchClients();
        alert("Client deleted successfully!");
      } else {
        alert("Failed to delete client");
      }
    } catch (error) {
      alert("Failed to delete client");
    }
  };

  const openEditClient = (client) => {
    setEditingClient(client);
    setClientForm({ name: client.name, number: client.number });
    setShowCreateClient(true);
  };

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f5f6fa" }}>
      {/* Sidebar */}
      <div style={{ 
        width: 280, 
        background: "linear-gradient(180deg, #667eea 0%, #764ba2 100%)", 
        color: "white",
        display: "flex",
        flexDirection: "column",
        boxShadow: "2px 0 10px rgba(0,0,0,0.1)"
      }}>
        <div style={{ padding: 30, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <h2 style={{ margin: "0 0 5px 0", fontSize: 24 }}>PSVBet</h2>
          <p style={{ margin: 0, fontSize: 14, opacity: 0.9 }}>Welcome, {user.name}</p>
        </div>

        <nav style={{ flex: 1, padding: "20px 0" }}>
          <button
            onClick={() => setActiveView("dashboard")}
            style={{
              width: "100%",
              padding: "15px 30px",
              background: activeView === "dashboard" ? "rgba(255,255,255,0.2)" : "transparent",
              border: "none",
              color: "white",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            onMouseOut={(e) => e.target.style.background = activeView === "dashboard" ? "rgba(255,255,255,0.2)" : "transparent"}
          >
            <span>📊</span>
            <span>Dashboard</span>
          </button>

          <button
            onClick={() => setActiveView("meetings")}
            style={{
              width: "100%",
              padding: "15px 30px",
              background: activeView === "meetings" ? "rgba(255,255,255,0.2)" : "transparent",
              border: "none",
              color: "white",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            onMouseOut={(e) => e.target.style.background = activeView === "meetings" ? "rgba(255,255,255,0.2)" : "transparent"}
          >
            <span>📹</span>
            <span>My Meetings</span>
          </button>

          <button
            onClick={() => setActiveView("clients")}
            style={{
              width: "100%",
              padding: "15px 30px",
              background: activeView === "clients" ? "rgba(255,255,255,0.2)" : "transparent",
              border: "none",
              color: "white",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            onMouseOut={(e) => e.target.style.background = activeView === "clients" ? "rgba(255,255,255,0.2)" : "transparent"}
          >
            <span>👥</span>
            <span>Clients</span>
          </button>

          <button
            onClick={() => setActiveView("matches")}
            style={{
              width: "100%",
              padding: "15px 30px",
              background: activeView === "matches" ? "rgba(255,255,255,0.2)" : "transparent",
              border: "none",
              color: "white",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            onMouseOut={(e) => e.target.style.background = activeView === "matches" ? "rgba(255,255,255,0.2)" : "transparent"}
          >
            <span>🏏</span>
            <span>Matches</span>
          </button>

          <button
            onClick={() => setShowCreateMeeting(true)}
            style={{
              width: "100%",
              padding: "15px 30px",
              background: "transparent",
              border: "none",
              color: "white",
              textAlign: "left",
              cursor: "pointer",
              fontSize: 16,
              display: "flex",
              alignItems: "center",
              gap: 10,
              transition: "all 0.3s"
            }}
            onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            onMouseOut={(e) => e.target.style.background = "transparent"}
          >
            <span>➕</span>
            <span>Create Meeting</span>
          </button>
        </nav>

        <div style={{ padding: 20, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <button
            onClick={handleLogout}
            style={{
              width: "100%",
              padding: "12px 20px",
              background: "rgba(231,76,60,0.8)",
              border: "none",
              color: "white",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10
            }}
          >
            <span>🚪</span>
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Header */}
        <div style={{ 
          background: "white", 
          padding: "20px 40px", 
          boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <h1 style={{ margin: 0, fontSize: 28, color: "#2c3e50" }}>
            {activeView === "dashboard" ? "Dashboard" : activeView === "meetings" ? "My Meetings" : activeView === "clients" ? "Clients" : "Cricket Matches"}
          </h1>
          {activeView === "clients" && (
            <button
              onClick={() => {
                setEditingClient(null);
                setClientForm({ name: "", number: "" });
                setShowCreateClient(true);
              }}
              style={{
                padding: "10px 20px",
                background: "#667eea",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500
              }}
            >
              + Add Client
            </button>
          )}
        </div>

        {/* Content Area */}
        <div style={{ padding: 40 }}>
          {activeView === "dashboard" && (
            <div>
              {/* Stats Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 20, marginBottom: 40 }}>
                <div style={{
                  background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                  padding: 30,
                  borderRadius: 12,
                  color: "white",
                  boxShadow: "0 4px 12px rgba(102,126,234,0.3)"
                }}>
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Total Meetings</div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{myMeetings.length}</div>
                </div>

                <div style={{
                  background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                  padding: 30,
                  borderRadius: 12,
                  color: "white",
                  boxShadow: "0 4px 12px rgba(245,87,108,0.3)"
                }}>
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Active Meetings</div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{activeMeetings.length}</div>
                </div>

                <div style={{
                  background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                  padding: 30,
                  borderRadius: 12,
                  color: "white",
                  boxShadow: "0 4px 12px rgba(79,172,254,0.3)"
                }}>
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Total Clients</div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{clients.length}</div>
                </div>
              </div>

              {/* Recent Activity */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30, marginBottom: 40 }}>
                {/* Recent Meetings */}
                <div style={{
                  background: "white",
                  padding: 24,
                  borderRadius: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h3 style={{ margin: 0, color: "#2c3e50" }}>Recent Meetings</h3>
                    <button
                      onClick={() => setActiveView("meetings")}
                      style={{
                        padding: "6px 12px",
                        background: "transparent",
                        border: "1px solid #667eea",
                        color: "#667eea",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 500
                      }}
                    >
                      View All
                    </button>
                  </div>
                  {myMeetings.slice(0, 5).map((meeting) => (
                    <div key={meeting._id} style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #f0f0f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}>
                      <div>
                        <div style={{ fontWeight: 500, color: "#2c3e50", marginBottom: 4 }}>{meeting.title}</div>
                        <div style={{ fontSize: 12, color: "#95a5a6" }}>
                          {new Date(meeting.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <span style={{
                        padding: "4px 12px",
                        background: meeting.isActive ? "#d4edda" : "#f8d7da",
                        color: meeting.isActive ? "#155724" : "#721c24",
                        borderRadius: 12,
                        fontSize: 11,
                        fontWeight: 600
                      }}>
                        {meeting.isActive ? "ACTIVE" : "CLOSED"}
                      </span>
                    </div>
                  ))}
                  {myMeetings.length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                      No meetings yet
                    </div>
                  )}
                </div>

                {/* Recent Clients */}
                <div style={{
                  background: "white",
                  padding: 24,
                  borderRadius: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h3 style={{ margin: 0, color: "#2c3e50" }}>Recent Clients</h3>
                    <button
                      onClick={() => setActiveView("clients")}
                      style={{
                        padding: "6px 12px",
                        background: "transparent",
                        border: "1px solid #667eea",
                        color: "#667eea",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 500
                      }}
                    >
                      View All
                    </button>
                  </div>
                  {clients.slice(0, 5).map((client) => (
                    <div key={client._id} style={{
                      padding: "12px 0",
                      borderBottom: "1px solid #f0f0f0"
                    }}>
                      <div style={{ fontWeight: 500, color: "#2c3e50", marginBottom: 4 }}>{client.name}</div>
                      <div style={{ fontSize: 12, color: "#95a5a6" }}>
                        {client.number} • {client.clientId}
                      </div>
                    </div>
                  ))}
                  {clients.length === 0 && (
                    <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                      No clients yet
                    </div>
                  )}
                </div>
              </div>

              {/* Cricket Matches */}
              <div style={{
                background: "white",
                padding: 24,
                borderRadius: 12,
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <h3 style={{ margin: 0, color: "#2c3e50" }}>🏏 Live Cricket Matches</h3>
                  <button
                    onClick={fetchCricketMatches}
                    disabled={loadingMatches}
                    style={{
                      padding: "6px 12px",
                      background: "#667eea",
                      color: "white",
                      border: "none",
                      borderRadius: 6,
                      cursor: loadingMatches ? "not-allowed" : "pointer",
                      fontSize: 12,
                      fontWeight: 500,
                      opacity: loadingMatches ? 0.6 : 1
                    }}
                  >
                    {loadingMatches ? "Loading..." : "Refresh"}
                  </button>
                </div>

                {loadingMatches ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                    Loading matches...
                  </div>
                ) : cricketMatches.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                    <div style={{ fontSize: 48, marginBottom: 10 }}>🏏</div>
                    <div>No live matches at the moment</div>
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      Add your CRICAPI_KEY to .env to fetch live matches
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 16 }}>
                    {cricketMatches
                      .filter(match => !match.matchEnded) // Only show live and upcoming
                      .slice(0, 5)
                      .map((match) => (
                      <div key={match.id} style={{
                        padding: 16,
                        border: "2px solid #f0f0f0",
                        borderRadius: 10,
                        transition: "all 0.3s",
                        cursor: "pointer"
                      }}
                      onMouseOver={(e) => e.currentTarget.style.borderColor = "#667eea"}
                      onMouseOut={(e) => e.currentTarget.style.borderColor = "#f0f0f0"}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, color: "#2c3e50", marginBottom: 4, fontSize: 15 }}>
                              {match.name}
                            </div>
                            <div style={{ fontSize: 12, color: "#7f8c8d", marginBottom: 4 }}>
                              {match.matchType} • {match.venue}
                            </div>
                            <div style={{ fontSize: 11, color: "#95a5a6" }}>
                              {new Date(match.dateTimeGMT).toLocaleString()}
                            </div>
                          </div>
                          <span style={{
                            padding: "4px 10px",
                            background: match.matchStarted ? (match.matchEnded ? "#95a5a6" : "#27ae60") : "#3498db",
                            color: "white",
                            borderRadius: 12,
                            fontSize: 10,
                            fontWeight: 600,
                            whiteSpace: "nowrap"
                          }}>
                            {match.matchEnded ? "ENDED" : match.matchStarted ? "LIVE" : "UPCOMING"}
                          </span>
                        </div>
                        
                        {match.score && match.score.length > 0 && (
                          <div style={{ 
                            background: "#f8f9fa", 
                            padding: 12, 
                            borderRadius: 8,
                            fontSize: 13
                          }}>
                            {match.score.map((scoreItem, idx) => (
                              <div key={idx} style={{ 
                                marginBottom: idx < match.score.length - 1 ? 8 : 0,
                                color: "#2c3e50"
                              }}>
                                <span style={{ fontWeight: 600 }}>{scoreItem.inning}:</span> {scoreItem.r}/{scoreItem.w} ({scoreItem.o} overs)
                              </div>
                            ))}
                          </div>
                        )}

                        {match.status && (
                          <div style={{ 
                            marginTop: 10, 
                            fontSize: 12, 
                            color: "#667eea",
                            fontWeight: 500
                          }}>
                            {match.status}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeView === "meetings" && (
            <div>
              {/* Tabs */}
              <div style={{ 
                display: "flex", 
                gap: 10, 
                marginBottom: 30,
                borderBottom: "2px solid #e0e0e0"
              }}>
                <button
                  onClick={() => setMeetingsTab("active")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: meetingsTab === "active" ? "3px solid #667eea" : "3px solid transparent",
                    color: meetingsTab === "active" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600,
                    transition: "all 0.3s"
                  }}
                >
                  Active Meetings ({activeMeetings.length})
                </button>
                <button
                  onClick={() => setMeetingsTab("closed")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: meetingsTab === "closed" ? "3px solid #667eea" : "3px solid transparent",
                    color: meetingsTab === "closed" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600,
                    transition: "all 0.3s"
                  }}
                >
                  Closed Meetings ({closedMeetings.length})
                </button>
              </div>

              {/* Active Meetings */}
              {meetingsTab === "active" && (
                activeMeetings.length === 0 ? (
                  <div style={{ 
                    textAlign: "center", 
                    padding: 60,
                    background: "white",
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                  }}>
                    <div style={{ fontSize: 64, marginBottom: 20 }}>📹</div>
                    <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No active meetings</h3>
                    <p style={{ margin: "0 0 20px 0", color: "#7f8c8d" }}>Create your first meeting to get started</p>
                    <button
                      onClick={() => setShowCreateMeeting(true)}
                      style={{
                        padding: "12px 24px",
                        background: "#667eea",
                        color: "white",
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontSize: 16,
                        fontWeight: 500
                      }}
                    >
                      Create Meeting
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 20 }}>
                    {activeMeetings.map((meeting) => (
                      <div key={meeting._id} style={{ 
                        background: "white", 
                        padding: 24, 
                        borderRadius: 12, 
                        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        transition: "all 0.3s",
                        border: "2px solid transparent"
                      }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <h3 style={{ margin: 0, color: "#2c3e50" }}>{meeting.title}</h3>
                            <span style={{ 
                              padding: "4px 12px", 
                              background: "#27ae60", 
                              color: "white", 
                              borderRadius: 12, 
                              fontSize: 12,
                              fontWeight: 600
                            }}>
                              ACTIVE
                            </span>
                          </div>
                          <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#7f8c8d" }}>
                            📅 Created: {new Date(meeting.createdAt).toLocaleString()}
                          </p>
                          <p style={{ margin: 0, fontSize: 13, color: "#95a5a6", fontFamily: "monospace" }}>
                            🔑 Room ID: {meeting.roomId}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                          <button 
                            onClick={() => navigate(`/meeting/${meeting.roomId}`)}
                            style={{ 
                              padding: "10px 20px", 
                              background: "#9b59b6", 
                              color: "white", 
                              border: "none", 
                              borderRadius: 8, 
                              cursor: "pointer",
                              fontWeight: 500,
                              fontSize: 14
                            }}
                          >
                            Join
                          </button>
                          {meeting.recordings && meeting.recordings.length > 0 && (
                            <button
                              onClick={() =>
                                window.open(
                                  `/meeting/${meeting.roomId}/recordings`,
                                  "_blank",
                                  "noopener,noreferrer"
                                )
                              }
                              style={{
                                padding: "10px 20px",
                                background: "#667eea",
                                color: "white",
                                border: "none",
                                borderRadius: 8,
                                cursor: "pointer",
                                fontWeight: 500,
                                fontSize: 14
                              }}
                            >
                              Recordings
                            </button>
                          )}
                          <button 
                            onClick={() => {
                              const link = `${window.location.origin}/meeting/${meeting.roomId}`;
                              navigator.clipboard.writeText(link);
                              alert("Link copied!");
                            }}
                            style={{ 
                              padding: "10px 20px", 
                              background: "#27ae60", 
                              color: "white", 
                              border: "none", 
                              borderRadius: 8, 
                              cursor: "pointer",
                              fontWeight: 500,
                              fontSize: 14
                            }}
                          >
                            Copy Link
                          </button>
                          <button 
                            onClick={() => toggleMeetingStatus(meeting.roomId)}
                            style={{ 
                              padding: "10px 20px", 
                              background: "#e74c3c", 
                              color: "white", 
                              border: "none", 
                              borderRadius: 8, 
                              cursor: "pointer",
                              fontWeight: 500,
                              fontSize: 14
                            }}
                          >
                            Close
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* Closed Meetings */}
              {meetingsTab === "closed" && (
                closedMeetings.length === 0 ? (
                  <div style={{ 
                    textAlign: "center", 
                    padding: 60,
                    background: "white",
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                  }}>
                    <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
                    <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No closed meetings</h3>
                    <p style={{ margin: 0, color: "#7f8c8d" }}>Closed meetings will appear here</p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 20 }}>
                    {closedMeetings.map((meeting) => (
                      <div key={meeting._id} style={{ 
                        background: "white", 
                        padding: 24, 
                        borderRadius: 12, 
                        boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        transition: "all 0.3s",
                        opacity: 0.8
                      }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                            <h3 style={{ margin: 0, color: "#2c3e50" }}>{meeting.title}</h3>
                            <span style={{ 
                              padding: "4px 12px", 
                              background: "#95a5a6", 
                              color: "white", 
                              borderRadius: 12, 
                              fontSize: 12,
                              fontWeight: 600
                            }}>
                              CLOSED
                            </span>
                          </div>
                          <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#7f8c8d" }}>
                            📅 Created: {new Date(meeting.createdAt).toLocaleString()}
                          </p>
                          <p style={{ margin: 0, fontSize: 13, color: "#95a5a6", fontFamily: "monospace" }}>
                            🔑 Room ID: {meeting.roomId}
                          </p>
                        </div>
                        <div style={{ display: "flex", gap: 12 }}>
                          <button 
                            onClick={() => toggleMeetingStatus(meeting.roomId)}
                            style={{ 
                              padding: "10px 20px", 
                              background: "#27ae60", 
                              color: "white", 
                              border: "none", 
                              borderRadius: 8, 
                              cursor: "pointer",
                              fontWeight: 500,
                              fontSize: 14
                            }}
                          >
                            Reopen
                          </button>
                          {meeting.recordings && meeting.recordings.length > 0 && (
                            <button
                              onClick={() =>
                                window.open(
                                  `/meeting/${meeting.roomId}/recordings`,
                                  "_blank",
                                  "noopener,noreferrer"
                                )
                              }
                              style={{
                                padding: "10px 20px",
                                background: "#667eea",
                                color: "white",
                                border: "none",
                                borderRadius: 8,
                                cursor: "pointer",
                                fontWeight: 500,
                                fontSize: 14
                              }}
                            >
                              Recordings
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}

          {activeView === "clients" && (
            <div>
              {clients.length === 0 ? (
                <div style={{ 
                  textAlign: "center", 
                  padding: 60,
                  background: "white",
                  borderRadius: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ fontSize: 64, marginBottom: 20 }}>👥</div>
                  <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No clients yet</h3>
                  <p style={{ margin: "0 0 20px 0", color: "#7f8c8d" }}>Add your first client to get started</p>
                  <button
                    onClick={() => setShowCreateClient(true)}
                    style={{
                      padding: "12px 24px",
                      background: "#667eea",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 500
                    }}
                  >
                    Add Client
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 20 }}>
                  {clients.map((client) => (
                    <div key={client._id} style={{ 
                      background: "white", 
                      padding: 24, 
                      borderRadius: 12, 
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}>
                      <div style={{ flex: 1 }}>
                        <h3 style={{ margin: "0 0 8px 0", color: "#2c3e50" }}>{client.name}</h3>
                        <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#7f8c8d" }}>
                          📱 Phone: {client.number}
                        </p>
                        <p style={{ margin: "0 0 4px 0", fontSize: 13, color: "#95a5a6", fontFamily: "monospace" }}>
                          🆔 Client ID: {client.clientId}
                        </p>
                        <p style={{ margin: 0, fontSize: 13, color: "#95a5a6", fontFamily: "monospace" }}>
                          🔑 Password: {client.password}
                        </p>
                      </div>
                      <div style={{ display: "flex", gap: 12 }}>
                        <button 
                          onClick={() => openEditClient(client)}
                          style={{ 
                            padding: "10px 20px", 
                            background: "#3498db", 
                            color: "white", 
                            border: "none", 
                            borderRadius: 8, 
                            cursor: "pointer",
                            fontWeight: 500,
                            fontSize: 14
                          }}
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => deleteClient(client._id)}
                          style={{ 
                            padding: "10px 20px", 
                            background: "#e74c3c", 
                            color: "white", 
                            border: "none", 
                            borderRadius: 8, 
                            cursor: "pointer",
                            fontWeight: 500,
                            fontSize: 14
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeView === "matches" && (
            <div>
              {/* Tabs */}
              <div style={{ 
                display: "flex", 
                gap: 10, 
                marginBottom: 30,
                borderBottom: "2px solid #e0e0e0"
              }}>
                <button
                  onClick={() => setMatchesTab("live")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: matchesTab === "live" ? "3px solid #667eea" : "3px solid transparent",
                    color: matchesTab === "live" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600,
                    transition: "all 0.3s"
                  }}
                >
                  Live ({getFilteredMatches(cricketMatches.filter(m => m.matchStarted && !m.matchEnded)).length})
                </button>
                <button
                  onClick={() => setMatchesTab("upcoming")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: matchesTab === "upcoming" ? "3px solid #667eea" : "3px solid transparent",
                    color: matchesTab === "upcoming" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600,
                    transition: "all 0.3s"
                  }}
                >
                  Upcoming ({getFilteredMatches(cricketMatches.filter(m => !m.matchStarted)).length})
                </button>
                <button
                  onClick={() => setMatchesTab("ended")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom: matchesTab === "ended" ? "3px solid #667eea" : "3px solid transparent",
                    color: matchesTab === "ended" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600,
                    transition: "all 0.3s"
                  }}
                >
                  Ended ({getFilteredMatches(cricketMatches.filter(m => m.matchEnded)).length})
                </button>
                <button
                  onClick={fetchCricketMatches}
                  disabled={loadingMatches}
                  style={{
                    marginLeft: "auto",
                    padding: "8px 16px",
                    background: "#667eea",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: loadingMatches ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 500,
                    opacity: loadingMatches ? 0.6 : 1
                  }}
                >
                  {loadingMatches ? "Loading..." : "Refresh"}
                </button>
              </div>

              {/* Filters */}
              <div style={{ 
                display: "flex", 
                gap: 15, 
                marginBottom: 20,
                padding: "15px 20px",
                background: "white",
                borderRadius: 10,
                boxShadow: "0 2px 6px rgba(0,0,0,0.08)"
              }}>
                <div style={{ flex: 1 }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: 6, 
                    fontSize: 13, 
                    fontWeight: 600, 
                    color: "#2c3e50" 
                  }}>
                    Match Type
                  </label>
                  <select
                    value={matchTypeFilter}
                    onChange={(e) => setMatchTypeFilter(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "2px solid #e0e0e0",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      background: "white",
                      color: "#2c3e50"
                    }}
                  >
                    {matchTypes.map(type => (
                      <option key={type} value={type}>
                        {type === "all" ? "All Types" : type}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ flex: 1 }}>
                  <label style={{ 
                    display: "block", 
                    marginBottom: 6, 
                    fontSize: 13, 
                    fontWeight: 600, 
                    color: "#2c3e50" 
                  }}>
                    Tournament/League
                  </label>
                  <select
                    value={leagueFilter}
                    onChange={(e) => setLeagueFilter(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "2px solid #e0e0e0",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                      background: "white",
                      color: "#2c3e50"
                    }}
                  >
                    {leagues.map(league => (
                      <option key={league} value={league}>
                        {league === "all" ? "All Tournaments" : league}
                      </option>
                    ))}
                  </select>
                </div>

                {(matchTypeFilter !== "all" || leagueFilter !== "all") && (
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button
                      onClick={() => {
                        setMatchTypeFilter("all");
                        setLeagueFilter("all");
                      }}
                      style={{
                        padding: "8px 16px",
                        background: "#e74c3c",
                        color: "white",
                        border: "none",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: 500,
                        whiteSpace: "nowrap"
                      }}
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>

              {loadingMatches ? (
                <div style={{ 
                  textAlign: "center", 
                  padding: 60,
                  background: "white",
                  borderRadius: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}>
                  <div style={{ fontSize: 48, marginBottom: 10 }}>⏳</div>
                  <div style={{ color: "#95a5a6" }}>Loading matches...</div>
                </div>
              ) : (
                <>
                  {/* Live Matches */}
                  {matchesTab === "live" && (
                    getFilteredMatches(cricketMatches.filter(m => m.matchStarted && !m.matchEnded)).length === 0 ? (
                      <div style={{ 
                        textAlign: "center", 
                        padding: 60,
                        background: "white",
                        borderRadius: 12,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                      }}>
                        <div style={{ fontSize: 64, marginBottom: 20 }}>🏏</div>
                        <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No live matches</h3>
                        <p style={{ margin: 0, color: "#7f8c8d" }}>Check back later for live cricket action</p>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(cricketMatches.filter(m => m.matchStarted && !m.matchEnded))
                          .map((match) => (
                            <div 
                              key={match.id} 
                              onClick={() => fetchMatchDetails(match.id)}
                              style={{
                              background: "white",
                              padding: 24,
                              borderRadius: 12,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              border: "2px solid #27ae60",
                              transition: "all 0.3s",
                              cursor: "pointer"
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.transform = "translateY(-2px)";
                              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                            }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>
                                    {match.league}
                                  </div>
                                  <div style={{ fontWeight: 600, color: "#2c3e50", marginBottom: 8, fontSize: 18 }}>
                                    {match.name}
                                  </div>
                                  <div style={{ fontSize: 14, color: "#7f8c8d", marginBottom: 6 }}>
                                    {match.matchType} • {match.venue}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#95a5a6" }}>
                                    {new Date(match.dateTimeGMT).toLocaleString()}
                                  </div>
                                </div>
                                <span style={{
                                  padding: "6px 14px",
                                  background: "#27ae60",
                                  color: "white",
                                  borderRadius: 12,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6
                                }}>
                                  <span style={{ fontSize: 8 }}>🔴</span> LIVE
                                </span>
                              </div>
                              
                              {match.score && match.score.length > 0 && (
                                <div style={{ 
                                  background: "#f8f9fa", 
                                  padding: 16, 
                                  borderRadius: 10,
                                  fontSize: 15,
                                  marginBottom: 12
                                }}>
                                  {match.score.map((scoreItem, idx) => (
                                    <div key={idx} style={{ 
                                      marginBottom: idx < match.score.length - 1 ? 10 : 0,
                                      color: "#2c3e50",
                                      fontWeight: 500
                                    }}>
                                      <span style={{ fontWeight: 700 }}>{scoreItem.inning}:</span> {scoreItem.r}/{scoreItem.w} ({scoreItem.o} overs)
                                    </div>
                                  ))}
                                </div>
                              )}

                              {match.status && (
                                <div style={{ 
                                  fontSize: 14, 
                                  color: "#667eea",
                                  fontWeight: 600
                                }}>
                                  {match.status}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )
                  )}

                  {/* Upcoming Matches */}
                  {matchesTab === "upcoming" && (
                    getFilteredMatches(cricketMatches.filter(m => !m.matchStarted)).length === 0 ? (
                      <div style={{ 
                        textAlign: "center", 
                        padding: 60,
                        background: "white",
                        borderRadius: 12,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                      }}>
                        <div style={{ fontSize: 64, marginBottom: 20 }}>📅</div>
                        <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No upcoming matches</h3>
                        <p style={{ margin: 0, color: "#7f8c8d" }}>All scheduled matches have started</p>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(cricketMatches.filter(m => !m.matchStarted))
                          .map((match) => (
                            <div 
                              key={match.id} 
                              onClick={() => fetchMatchDetails(match.id)}
                              style={{
                              background: "white",
                              padding: 24,
                              borderRadius: 12,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              border: "2px solid #3498db",
                              transition: "all 0.3s",
                              cursor: "pointer"
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.transform = "translateY(-2px)";
                              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                            }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>
                                    {match.league}
                                  </div>
                                  <div style={{ fontWeight: 600, color: "#2c3e50", marginBottom: 8, fontSize: 18 }}>
                                    {match.name}
                                  </div>
                                  <div style={{ fontSize: 14, color: "#7f8c8d", marginBottom: 6 }}>
                                    {match.matchType} • {match.venue}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#95a5a6" }}>
                                    📅 {new Date(match.dateTimeGMT).toLocaleString()}
                                  </div>
                                </div>
                                <span style={{
                                  padding: "6px 14px",
                                  background: "#3498db",
                                  color: "white",
                                  borderRadius: 12,
                                  fontSize: 12,
                                  fontWeight: 600
                                }}>
                                  UPCOMING
                                </span>
                              </div>

                              {match.status && (
                                <div style={{ 
                                  fontSize: 14, 
                                  color: "#667eea",
                                  fontWeight: 600
                                }}>
                                  {match.status}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )
                  )}

                  {/* Ended Matches */}
                  {matchesTab === "ended" && (
                    getFilteredMatches(cricketMatches.filter(m => m.matchEnded)).length === 0 ? (
                      <div style={{ 
                        textAlign: "center", 
                        padding: 60,
                        background: "white",
                        borderRadius: 12,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                      }}>
                        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
                        <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No ended matches</h3>
                        <p style={{ margin: 0, color: "#7f8c8d" }}>Completed matches will appear here</p>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(cricketMatches.filter(m => m.matchEnded))
                          .map((match) => (
                            <div 
                              key={match.id} 
                              onClick={() => fetchMatchDetails(match.id)}
                              style={{
                              background: "white",
                              padding: 24,
                              borderRadius: 12,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              border: "2px solid #95a5a6",
                              transition: "all 0.3s",
                              opacity: 0.9,
                              cursor: "pointer"
                            }}
                            onMouseOver={(e) => {
                              e.currentTarget.style.transform = "translateY(-2px)";
                              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                              e.currentTarget.style.opacity = "1";
                            }}
                            onMouseOut={(e) => {
                              e.currentTarget.style.transform = "translateY(0)";
                              e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                              e.currentTarget.style.opacity = "0.9";
                            }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 4, textTransform: "uppercase" }}>
                                    {match.league}
                                  </div>
                                  <div style={{ fontWeight: 600, color: "#2c3e50", marginBottom: 8, fontSize: 18 }}>
                                    {match.name}
                                  </div>
                                  <div style={{ fontSize: 14, color: "#7f8c8d", marginBottom: 6 }}>
                                    {match.matchType} • {match.venue}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#95a5a6" }}>
                                    {new Date(match.dateTimeGMT).toLocaleString()}
                                  </div>
                                </div>
                                <span style={{
                                  padding: "6px 14px",
                                  background: "#95a5a6",
                                  color: "white",
                                  borderRadius: 12,
                                  fontSize: 12,
                                  fontWeight: 600
                                }}>
                                  ENDED
                                </span>
                              </div>
                              
                              {match.score && match.score.length > 0 && (
                                <div style={{ 
                                  background: "#f8f9fa", 
                                  padding: 16, 
                                  borderRadius: 10,
                                  fontSize: 15,
                                  marginBottom: 12
                                }}>
                                  {match.score.map((scoreItem, idx) => (
                                    <div key={idx} style={{ 
                                      marginBottom: idx < match.score.length - 1 ? 10 : 0,
                                      color: "#2c3e50",
                                      fontWeight: 500
                                    }}>
                                      <span style={{ fontWeight: 700 }}>{scoreItem.inning}:</span> {scoreItem.r}/{scoreItem.w} ({scoreItem.o} overs)
                                    </div>
                                  ))}
                                </div>
                              )}

                              {match.status && (
                                <div style={{ 
                                  fontSize: 14, 
                                  color: "#27ae60",
                                  fontWeight: 600
                                }}>
                                  {match.status}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Client Modal */}
      {showCreateClient && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div style={{
            background: "white",
            padding: 40,
            borderRadius: 15,
            boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            maxWidth: 500,
            width: "90%"
          }}>
            <h2 style={{ margin: "0 0 20px 0", color: "#2c3e50" }}>
              {editingClient ? "Edit Client" : "Add New Client"}
            </h2>
            
            <label style={{ display: "block", marginBottom: 8, color: "#2c3e50", fontWeight: 500 }}>
              Client Name
            </label>
            <input
              type="text"
              placeholder="Enter client name"
              value={clientForm.name}
              onChange={(e) => setClientForm({ ...clientForm, name: e.target.value })}
              style={{
                width: "100%",
                padding: 12,
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                fontSize: 16,
                marginBottom: 20,
                boxSizing: "border-box"
              }}
            />

            <label style={{ display: "block", marginBottom: 8, color: "#2c3e50", fontWeight: 500 }}>
              Phone Number
            </label>
            <input
              type="text"
              placeholder="Enter phone number"
              value={clientForm.number}
              onChange={(e) => setClientForm({ ...clientForm, number: e.target.value })}
              style={{
                width: "100%",
                padding: 12,
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                fontSize: 16,
                marginBottom: 20,
                boxSizing: "border-box"
              }}
            />

            {!editingClient && (
              <div style={{ 
                padding: 15, 
                background: "#ecf0f1", 
                borderRadius: 8, 
                marginBottom: 20,
                fontSize: 13,
                color: "#7f8c8d"
              }}>
                ℹ️ Client ID and Password will be auto-generated based on name and phone number
              </div>
            )}
            
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={editingClient ? updateClient : createClient}
                disabled={!clientForm.name.trim() || !clientForm.number.trim()}
                style={{
                  flex: 1,
                  padding: 12,
                  background: (clientForm.name.trim() && clientForm.number.trim()) ? "#667eea" : "#ccc",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: (clientForm.name.trim() && clientForm.number.trim()) ? "pointer" : "not-allowed"
                }}
              >
                {editingClient ? "Update" : "Create"}
              </button>
              <button
                onClick={() => {
                  setShowCreateClient(false);
                  setClientForm({ name: "", number: "" });
                  setEditingClient(null);
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#95a5a6",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Match Details Modal */}
      {showMatchDetails && (
        <div 
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000,
            padding: 20
          }}
          onClick={closeMatchDetails}
        >
          <div 
            style={{
              background: "white",
              borderRadius: 15,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              maxWidth: 900,
              width: "100%",
              maxHeight: "90vh",
              overflow: "auto"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {loadingMatchDetails ? (
              <div style={{ padding: 60, textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>⏳</div>
                <div style={{ color: "#95a5a6", fontSize: 18 }}>Loading match details...</div>
              </div>
            ) : selectedMatch ? (
              <>
                {/* Header */}
                <div style={{ 
                  padding: "24px 30px", 
                  borderBottom: "2px solid #f0f0f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start"
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: "#667eea", fontWeight: 600, marginBottom: 8, textTransform: "uppercase" }}>
                      {selectedMatch.league_name}
                    </div>
                    <h2 style={{ margin: "0 0 12px 0", fontSize: 24, color: "#2c3e50" }}>
                      {selectedMatch.event_home_team} vs {selectedMatch.event_away_team}
                    </h2>
                    <div style={{ display: "flex", gap: 15, flexWrap: "wrap", fontSize: 14, color: "#7f8c8d" }}>
                      <span>📍 {selectedMatch.event_stadium || 'Venue TBA'}</span>
                      <span>🏏 {selectedMatch.event_type}</span>
                      <span>📅 {new Date(selectedMatch.event_date_start).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <button
                    onClick={closeMatchDetails}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: 28,
                      cursor: "pointer",
                      color: "#95a5a6",
                      padding: 0,
                      marginLeft: 20
                    }}
                  >
                    ×
                  </button>
                </div>

                {/* Match Status */}
                <div style={{ padding: "20px 30px", background: "#f8f9fa" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                    <span style={{
                      padding: "8px 16px",
                      background: selectedMatch.event_live === "1" ? "#27ae60" : selectedMatch.event_status === "Finished" ? "#95a5a6" : "#3498db",
                      color: "white",
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: 600
                    }}>
                      {selectedMatch.event_status === "Finished" ? "ENDED" : selectedMatch.event_live === "1" ? "🔴 LIVE" : "UPCOMING"}
                    </span>
                    <div style={{ fontSize: 15, color: "#667eea", fontWeight: 600 }}>
                      {selectedMatch.event_status_info || selectedMatch.event_status}
                    </div>
                  </div>
                  {selectedMatch.event_toss && (
                    <div style={{ marginTop: 12, fontSize: 14, color: "#7f8c8d" }}>
                      🎯 Toss: {selectedMatch.event_toss}
                    </div>
                  )}
                </div>

                {/* Scores */}
                {(selectedMatch.event_home_final_result || selectedMatch.event_away_final_result) && (
                  <div style={{ padding: "24px 30px" }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: 18, color: "#2c3e50" }}>Match Score</h3>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ 
                        padding: 16, 
                        background: "#f8f9fa", 
                        borderRadius: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 16, color: "#2c3e50" }}>
                          {selectedMatch.event_home_team}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#667eea" }}>
                          {selectedMatch.event_home_final_result || 'Yet to bat'}
                        </div>
                      </div>
                      <div style={{ 
                        padding: 16, 
                        background: "#f8f9fa", 
                        borderRadius: 10,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}>
                        <div style={{ fontWeight: 600, fontSize: 16, color: "#2c3e50" }}>
                          {selectedMatch.event_away_team}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#667eea" }}>
                          {selectedMatch.event_away_final_result || 'Yet to bat'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Scorecard */}
                {selectedMatch.scorecard && Object.keys(selectedMatch.scorecard).length > 0 && (
                  <div style={{ padding: "24px 30px", borderTop: "2px solid #f0f0f0" }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: 18, color: "#2c3e50" }}>Scorecard</h3>
                    {Object.entries(selectedMatch.scorecard).map(([inning, players]) => (
                      <div key={inning} style={{ marginBottom: 24 }}>
                        <div style={{ 
                          fontWeight: 600, 
                          fontSize: 15, 
                          color: "#667eea", 
                          marginBottom: 12,
                          padding: "8px 12px",
                          background: "#f0f4ff",
                          borderRadius: 6
                        }}>
                          {inning}
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                            <thead>
                              <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                                <th style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600 }}>Player</th>
                                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>R</th>
                                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>B</th>
                                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>4s</th>
                                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>6s</th>
                                <th style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>SR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {players.slice(0, 11).map((player, idx) => (
                                player.type === "Batsman" && (
                                  <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                    <td style={{ padding: "10px 8px" }}>
                                      <div style={{ fontWeight: 500, color: "#2c3e50" }}>{player.player}</div>
                                      <div style={{ fontSize: 11, color: "#95a5a6" }}>{player.status}</div>
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center", fontWeight: 600 }}>{player.R}</td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{player.B}</td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{player["4s"]}</td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{player["6s"]}</td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>{player.SR}</td>
                                  </tr>
                                )
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Man of the Match */}
                {selectedMatch.event_man_of_match && (
                  <div style={{ padding: "20px 30px", background: "#fff8e1", borderTop: "2px solid #f0f0f0" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 24 }}>🏆</span>
                      <div>
                        <div style={{ fontSize: 12, color: "#f57c00", fontWeight: 600, marginBottom: 2 }}>MAN OF THE MATCH</div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "#2c3e50" }}>{selectedMatch.event_man_of_match}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Close Button */}
                <div style={{ padding: "20px 30px", borderTop: "2px solid #f0f0f0", textAlign: "center" }}>
                  <button
                    onClick={closeMatchDetails}
                    style={{
                      padding: "12px 32px",
                      background: "#667eea",
                      color: "white",
                      border: "none",
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 500
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <div style={{ padding: 60, textAlign: "center" }}>
                <div style={{ fontSize: 48, marginBottom: 20 }}>❌</div>
                <div style={{ color: "#95a5a6", fontSize: 18 }}>Failed to load match details</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Meeting Modal */}
      {showCreateMeeting && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000
        }}>
          <div 
            style={{
              background: "white",
              padding: 40,
              borderRadius: 15,
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
              maxWidth: 500,
              width: "90%"
            }}
            onClick={() => setShowMatchDropdown(false)}
          >
            <h2 style={{ margin: "0 0 20px 0", color: "#2c3e50" }}>Create New Meeting</h2>
            
            <label style={{ display: "block", marginBottom: 8, color: "#2c3e50", fontWeight: 500 }}>
              Meeting Title
            </label>
            <input
              type="text"
              placeholder="Enter meeting title"
              value={meetingTitle}
              onChange={(e) => setMeetingTitle(e.target.value)}
              style={{
                width: "100%",
                padding: 12,
                border: "2px solid #e0e0e0",
                borderRadius: 8,
                fontSize: 16,
                marginBottom: 20,
                boxSizing: "border-box"
              }}
            />

            <label style={{ display: "block", marginBottom: 8, color: "#2c3e50", fontWeight: 500 }}>
              Select Cricket Match (Optional)
            </label>
            <div style={{ position: "relative", marginBottom: 20 }}>
              <input
                type="text"
                placeholder="Search for a match..."
                value={matchSearchQuery}
                onChange={(e) => {
                  setMatchSearchQuery(e.target.value);
                  setShowMatchDropdown(true);
                }}
                onFocus={() => setShowMatchDropdown(true)}
                style={{
                  width: "100%",
                  padding: 12,
                  border: "2px solid #e0e0e0",
                  borderRadius: 8,
                  fontSize: 14,
                  boxSizing: "border-box"
                }}
              />
              {selectedMeetingMatch && (
                <button
                  onClick={() => {
                    setSelectedMeetingMatch("");
                    setMatchSearchQuery("");
                  }}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 18,
                    color: "#95a5a6"
                  }}
                >
                  ×
                </button>
              )}
              
              {showMatchDropdown && (
                <div 
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    maxHeight: 300,
                    overflowY: "auto",
                    background: "white",
                    border: "2px solid #e0e0e0",
                    borderTop: "none",
                    borderRadius: "0 0 8px 8px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    zIndex: 1000
                  }}
                >
                  {(() => {
                    // Get all matches (live + upcoming) and sort by date
                    const allMatches = [...cricketMatches.filter(m => !m.matchEnded)]
                      .sort((a, b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));
                    
                    // Filter by search query
                    const filteredMatches = allMatches.filter(match => 
                      (match.name && match.name.toLowerCase().includes(matchSearchQuery.toLowerCase())) ||
                      (match.league && match.league.toLowerCase().includes(matchSearchQuery.toLowerCase()))
                    );

                    if (filteredMatches.length === 0) {
                      return (
                        <div style={{ padding: 15, textAlign: "center", color: "#95a5a6" }}>
                          No matches found
                        </div>
                      );
                    }

                    // Group by status
                    const liveMatches = filteredMatches.filter(m => m.matchStarted && !m.matchEnded);
                    const upcomingMatches = filteredMatches.filter(m => !m.matchStarted);

                    return (
                      <>
                        {liveMatches.length > 0 && (
                          <>
                            <div style={{ 
                              padding: "8px 12px", 
                              background: "#f8f9fa", 
                              fontSize: 11, 
                              fontWeight: 600, 
                              color: "#667eea",
                              textTransform: "uppercase",
                              borderBottom: "1px solid #e0e0e0"
                            }}>
                              🔴 Live Matches ({liveMatches.length})
                            </div>
                            {liveMatches.map(match => (
                              <div
                                key={match.id}
                                onClick={() => {
                                  setSelectedMeetingMatch(match.id);
                                  setMatchSearchQuery(`${match.name} - ${match.league}`);
                                  setShowMatchDropdown(false);
                                }}
                                style={{
                                  padding: "12px 15px",
                                  cursor: "pointer",
                                  borderBottom: "1px solid #f0f0f0",
                                  background: selectedMeetingMatch === match.id ? "#f0f4ff" : "white",
                                  transition: "background 0.2s"
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = "#f8f9fa"}
                                onMouseOut={(e) => e.currentTarget.style.background = selectedMeetingMatch === match.id ? "#f0f4ff" : "white"}
                              >
                                <div style={{ fontWeight: 500, fontSize: 13, color: "#2c3e50", marginBottom: 4 }}>
                                  {match.name}
                                </div>
                                <div style={{ fontSize: 11, color: "#667eea" }}>
                                  {match.league}
                                </div>
                                <div style={{ fontSize: 10, color: "#95a5a6", marginTop: 2 }}>
                                  {new Date(match.dateTimeGMT).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                        
                        {upcomingMatches.length > 0 && (
                          <>
                            <div style={{ 
                              padding: "8px 12px", 
                              background: "#f8f9fa", 
                              fontSize: 11, 
                              fontWeight: 600, 
                              color: "#667eea",
                              textTransform: "uppercase",
                              borderBottom: "1px solid #e0e0e0"
                            }}>
                              📅 Upcoming Matches ({upcomingMatches.length})
                            </div>
                            {upcomingMatches.map(match => (
                              <div
                                key={match.id}
                                onClick={() => {
                                  setSelectedMeetingMatch(match.id);
                                  setMatchSearchQuery(`${match.name} - ${match.league}`);
                                  setShowMatchDropdown(false);
                                }}
                                style={{
                                  padding: "12px 15px",
                                  cursor: "pointer",
                                  borderBottom: "1px solid #f0f0f0",
                                  background: selectedMeetingMatch === match.id ? "#f0f4ff" : "white",
                                  transition: "background 0.2s"
                                }}
                                onMouseOver={(e) => e.currentTarget.style.background = "#f8f9fa"}
                                onMouseOut={(e) => e.currentTarget.style.background = selectedMeetingMatch === match.id ? "#f0f4ff" : "white"}
                              >
                                <div style={{ fontWeight: 500, fontSize: 13, color: "#2c3e50", marginBottom: 4 }}>
                                  {match.name}
                                </div>
                                <div style={{ fontSize: 11, color: "#667eea" }}>
                                  {match.league}
                                </div>
                                <div style={{ fontSize: 10, color: "#95a5a6", marginTop: 2 }}>
                                  {new Date(match.dateTimeGMT).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
            
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={createMeeting}
                disabled={!meetingTitle.trim()}
                style={{
                  flex: 1,
                  padding: 12,
                  background: meetingTitle.trim() ? "#667eea" : "#ccc",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: meetingTitle.trim() ? "pointer" : "not-allowed"
                }}
              >
                Create
              </button>
              <button
                onClick={() => {
                  setShowCreateMeeting(false);
                  setJoinUrl("");
                  setMeetingTitle("");
                  setSelectedMeetingMatch("");
                  setMatchSearchQuery("");
                  setShowMatchDropdown(false);
                }}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "#95a5a6",
                  color: "white",
                  border: "none",
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>
            </div>

            {joinUrl && (
              <div style={{ marginTop: 20, padding: 15, background: "#ecf0f1", borderRadius: 8 }}>
                <p style={{ margin: "0 0 10px 0", fontWeight: 500, color: "#27ae60" }}>✓ Meeting created!</p>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input
                    type="text"
                    value={joinUrl}
                    readOnly
                    style={{
                      flex: 1,
                      padding: 10,
                      border: "1px solid #bdc3c7",
                      borderRadius: 5,
                      fontSize: 14
                    }}
                  />
                  <button
                    onClick={copyLink}
                    style={{
                      padding: "10px 20px",
                      background: "#27ae60",
                      color: "white",
                      border: "none",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontWeight: 500
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}