import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const fontUi =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function transformCricketApi(data) {
  return (data.result || []).map((match) => ({
    id: match.event_key,
    name: `${match.event_home_team} vs ${match.event_away_team}`,
    matchType: match.event_type || "Unknown",
    status: match.event_status_info || match.event_status,
    venue: match.event_stadium || "Unknown Venue",
    dateTimeGMT: `${match.event_date_start}T${match.event_time || "00:00"}:00`,
    matchStarted: match.event_live === "1" || match.event_status === "Finished",
    matchEnded: match.event_status === "Finished",
    score:
      match.event_home_final_result && match.event_away_final_result
        ? [
            {
              inning: match.event_home_team,
              r: match.event_home_final_result.split("/")[0] || match.event_home_final_result,
              w: match.event_home_final_result.includes("/")
                ? match.event_home_final_result.split("/")[1]
                : "-",
              o: "-"
            },
            {
              inning: match.event_away_team,
              r: match.event_away_final_result.split("/")[0] || match.event_away_final_result,
              w: match.event_away_final_result.includes("/")
                ? match.event_away_final_result.split("/")[1]
                : "-",
              o: "-"
            }
          ]
        : [],
    teams: [match.event_home_team, match.event_away_team],
    league: match.league_name
  }));
}

export default function ClientPortal() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeView, setActiveView] = useState("dashboard");
  const [meetingsTab, setMeetingsTab] = useState("active");
  const [matchesTab, setMatchesTab] = useState("live");
  const [meetings, setMeetings] = useState([]);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [cricketMatches, setCricketMatches] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchTypeFilter, setMatchTypeFilter] = useState("all");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [meetingSearchQuery, setMeetingSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [clientUser, setClientUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("clientUser") || "{}");
    } catch {
      return {};
    }
  });
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [loadingMatchDetails, setLoadingMatchDetails] = useState(false);
  const [recordingsMeetingExpanded, setRecordingsMeetingExpanded] = useState({});

  const myClientDocId = useMemo(() => {
    const id = clientUser?.id ?? clientUser?._id;
    return id != null && id !== "" ? String(id) : "";
  }, [clientUser]);

  const syncClientAuth = useCallback(() => {
    const cu = localStorage.getItem("clientUser");
    if (!cu) return;
    try {
      const parsed = JSON.parse(cu);
      sessionStorage.setItem(
        "clientAuth",
        JSON.stringify({
          id: parsed.id,
          clientId: parsed.clientId,
          name: parsed.name,
          token: localStorage.getItem("clientToken")
        })
      );
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyMargin = body.style.margin;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.margin = "0";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBodyOverflow;
      body.style.margin = prevBodyMargin;
    };
  }, []);

  const fetchMeetings = useCallback(async () => {
    const token = localStorage.getItem("clientToken");
    if (!token) return;
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/client/my-meetings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.message || "Could not load meetings");
        setMeetings([]);
        return;
      }
      setMeetings(Array.isArray(data) ? data : []);
    } catch {
      setError("Could not load meetings");
      setMeetings([]);
    } finally {
      setLoadingMeetings(false);
    }
  }, []);

  const fetchCricketMatches = useCallback(async () => {
    setLoadingMatches(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/current-matches`);
      const data = await response.json();
      const transformed = transformCricketApi(data);
      transformed.sort((a, b) => new Date(a.dateTimeGMT) - new Date(b.dateTimeGMT));
      setCricketMatches(transformed);
    } catch {
      console.error("Failed to fetch cricket matches");
    } finally {
      setLoadingMatches(false);
    }
  }, []);

  const fetchMatchDetails = async (matchId) => {
    setLoadingMatchDetails(true);
    setShowMatchDetails(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/match/${matchId}`);
      const data = await response.json();
      if (data.success && data.result && data.result.length > 0) {
        setSelectedMatch(data.result[0]);
      } else {
        setSelectedMatch(null);
      }
    } catch {
      setSelectedMatch(null);
    } finally {
      setLoadingMatchDetails(false);
    }
  };

  const closeMatchDetails = () => {
    setShowMatchDetails(false);
    setSelectedMatch(null);
  };

  useEffect(() => {
    const token = localStorage.getItem("clientToken");
    if (!token) {
      navigate("/client/login", { replace: true });
      return;
    }
    const stored = localStorage.getItem("clientUser");
    if (stored) {
      try {
        setClientUser(JSON.parse(stored));
      } catch {
        /* ignore */
      }
    }
    fetchMeetings();
  }, [navigate, fetchMeetings]);

  useEffect(() => {
    if (searchParams.get("tab") !== "meetings") return;
    setActiveView("meetings");
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (activeView === "dashboard" || activeView === "matches") {
      fetchCricketMatches();
    }
    if (activeView === "recordings") {
      setLoadingMeetings(true);
      fetchMeetings();
    }
  }, [activeView, fetchCricketMatches, fetchMeetings]);

  const isRecordingsMeetingOpen = (roomId) => recordingsMeetingExpanded[roomId] !== false;
  const toggleRecordingsMeeting = (roomId) => {
    setRecordingsMeetingExpanded((prev) => {
      const open = prev[roomId] !== false;
      return { ...prev, [roomId]: !open };
    });
  };

  const getFilteredMatches = (list) => {
    return list.filter((match) => {
      const matchTypeMatch = matchTypeFilter === "all" || match.matchType === matchTypeFilter;
      const leagueMatch = leagueFilter === "all" || match.league === leagueFilter;
      return matchTypeMatch && leagueMatch;
    });
  };

  const matchTypes = ["all", ...new Set(cricketMatches.map((m) => m.matchType).filter(Boolean))];
  const leagues = ["all", ...new Set(cricketMatches.map((m) => m.league).filter(Boolean))];

  const activeMeetings = meetings.filter((m) => m.isActive);
  const closedMeetings = meetings.filter((m) => !m.isActive);

  const meetingsMeetSearch = useCallback(
    (list) => {
      const q = meetingSearchQuery.trim().toLowerCase();
      if (!q) return list;
      return list.filter((m) => {
        const title = (m.title || "").toLowerCase();
        const room = (m.roomId || "").toLowerCase();
        const host = (m.hostName || "").toLowerCase();
        const matchName = (m.selectedMatch?.matchName || "").toLowerCase();
        const league = (m.selectedMatch?.league || "").toLowerCase();
        return (
          title.includes(q) ||
          room.includes(q) ||
          host.includes(q) ||
          matchName.includes(q) ||
          league.includes(q)
        );
      });
    },
    [meetingSearchQuery]
  );

  const filteredActive = useMemo(
    () => meetingsMeetSearch(activeMeetings),
    [activeMeetings, meetingsMeetSearch]
  );
  const filteredClosed = useMemo(
    () => meetingsMeetSearch(closedMeetings),
    [closedMeetings, meetingsMeetSearch]
  );

  const linkedMatchCount = useMemo(
    () => meetings.filter((m) => m.selectedMatch?.matchId).length,
    [meetings]
  );

  const meetingsWithMyRecordings = useMemo(() => {
    if (!myClientDocId) return [];
    const out = [];
    for (const m of meetings) {
      const mine = (m.recordings || []).filter(
        (r) =>
          r.recordingSource === "client" &&
          r.clientDocId != null &&
          String(r.clientDocId) === myClientDocId
      );
      if (!mine.length) continue;
      mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      out.push({ meeting: m, segments: mine });
    }
    out.sort((a, b) => {
      const ta = new Date(a.segments[0]?.createdAt || 0).getTime();
      const tb = new Date(b.segments[0]?.createdAt || 0).getTime();
      return tb - ta;
    });
    return out;
  }, [meetings, myClientDocId]);

  const logout = () => {
    localStorage.removeItem("clientToken");
    localStorage.removeItem("clientUser");
    sessionStorage.removeItem("clientAuth");
    navigate("/client/login");
  };

  const joinMeeting = (meeting) => {
    syncClientAuth();
    const joinUrl = meeting?.joinUrl;
    const roomId = meeting?.roomId;
    if (typeof joinUrl === "string" && joinUrl.trim()) {
      const path = joinUrl.replace(/^https?:\/\/[^/]+/, "").trim();
      if (path) {
        navigate(path);
        return;
      }
    }
    if (roomId) {
      // Meeting documents from the API usually have no joinUrl; only the create response did.
      navigate(`/meeting/${roomId}`);
    }
  };

  const copyLink = (roomId) => {
    const link = `${window.location.origin}/meeting/${roomId}`;
    navigator.clipboard.writeText(link);
    alert("Link copied!");
  };

  const hostLabel = clientUser.adminName || "Your host";

  const navBtn = (view, icon, label) => (
    <button
      type="button"
      onClick={() => setActiveView(view)}
      style={{
        width: "100%",
        padding: "15px 30px",
        background: activeView === view ? "rgba(255,255,255,0.2)" : "transparent",
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
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );

  const formatBytes = (n) => {
    if (n == null) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderRecordingListBlock = (recordings, options = {}) => {
    const showName = options.showName !== false;
    const showActions = options.showActions === true;
    const actionLinkStyle = {
      padding: "8px 14px",
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      fontFamily: fontUi,
      textDecoration: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 2px rgba(0,0,0,0.06)"
    };
    return (
      <div
        style={{
          marginTop: 6,
          background: "#fff",
          border: "1px solid #e8eaed",
          borderRadius: 10,
          padding: "4px 4px 4px 12px",
          fontSize: 13,
          fontFamily: fontUi
        }}
      >
        {(recordings || []).map((rec, idx) => {
          const videoUrl = rec.relativePath
            ? `${API_BASE_URL}/uploads/${rec.relativePath}`
            : null;
          const audioUrl = rec.audioRelativePath
            ? `${API_BASE_URL}/uploads/${rec.audioRelativePath}`
            : null;
          return (
            <div
              key={rec._id || idx}
              style={{
                padding: "14px 8px 14px 4px",
                borderBottom:
                  idx < (recordings || []).length - 1 ? "1px solid #eef0f3" : "none",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "stretch",
                justifyContent: "space-between",
                gap: 16
              }}
            >
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                {showName ? (
                  <div style={{ color: "#1a252f", fontWeight: 600, fontSize: 14 }}>
                    {rec.byName || "Recording"}
                  </div>
                ) : null}
                <div
                  style={{
                    color: "#34495e",
                    marginTop: showName ? 6 : 0,
                    fontSize: 14,
                    fontWeight: 500,
                    letterSpacing: "0.01em"
                  }}
                >
                  {rec.createdAt ? new Date(rec.createdAt).toLocaleString() : "—"}
                  <span style={{ color: "#7f8c8d", fontWeight: 400 }}> · </span>
                  <span style={{ color: "#5d6d7e" }}>{formatBytes(rec.sizeBytes)}</span>
                  {rec.hasTranscript ? (
                    <span style={{ color: "#7f8c8d", fontWeight: 400 }}> · transcript</span>
                  ) : null}
                  {rec.hasAudio ? (
                    <span style={{ color: "#7f8c8d", fontWeight: 400 }}> · audio</span>
                  ) : null}
                </div>
                {rec.filename && (
                  <div
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 11,
                      marginTop: 8,
                      color: "#7f8c8d",
                      wordBreak: "break-all",
                      lineHeight: 1.4
                    }}
                  >
                    {rec.filename}
                  </div>
                )}
              </div>
              {showActions && (videoUrl || audioUrl) ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    gap: 8,
                    flexShrink: 0,
                    minWidth: "fit-content"
                  }}
                >
                  {videoUrl ? (
                    <>
                      <a
                        href={videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          ...actionLinkStyle,
                          background: "linear-gradient(180deg, #7689f0 0%, #667eea 100%)",
                          color: "white",
                          textAlign: "center"
                        }}
                      >
                        View
                      </a>
                      <a
                        href={videoUrl}
                        download={rec.filename || "recording.webm"}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          ...actionLinkStyle,
                          background: "linear-gradient(180deg, #3dbd6e 0%, #27ae60 100%)",
                          color: "white",
                          textAlign: "center"
                        }}
                      >
                        Download
                      </a>
                    </>
                  ) : null}
                  {audioUrl && !videoUrl ? (
                    <>
                      <a
                        href={audioUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          ...actionLinkStyle,
                          background: "linear-gradient(180deg, #7689f0 0%, #667eea 100%)",
                          color: "white",
                          textAlign: "center"
                        }}
                      >
                        View audio
                      </a>
                      <a
                        href={audioUrl}
                        download={rec.audioFilename || "recording-audio.webm"}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          ...actionLinkStyle,
                          background: "linear-gradient(180deg, #3dbd6e 0%, #27ae60 100%)",
                          color: "white",
                          textAlign: "center"
                        }}
                      >
                        Download
                      </a>
                    </>
                  ) : null}
                  {audioUrl && videoUrl ? (
                    <a
                      href={audioUrl}
                      download={rec.audioFilename || "recording-audio.webm"}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        ...actionLinkStyle,
                        background: "#8894a8",
                        color: "white",
                        textAlign: "center"
                      }}
                    >
                      Extra audio
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const renderMeetingDetailBlock = (m) => (
    <div style={{ marginTop: 12, fontSize: 13, color: "#7f8c8d", lineHeight: 1.6 }}>
      <div>
        <strong style={{ color: "#2c3e50" }}>Host:</strong> {m.hostName || "—"}
      </div>
      {m.selectedMatch?.matchName && (
        <div style={{ marginTop: 6 }}>
          <strong style={{ color: "#2c3e50" }}>Linked match:</strong> {m.selectedMatch.matchName}
          {m.selectedMatch.league && (
            <span style={{ color: "#95a5a6" }}> ({m.selectedMatch.league})</span>
          )}
          {m.selectedMatch.matchId && (
            <div style={{ fontSize: 12, fontFamily: "monospace", marginTop: 2 }}>
              Match ID: {m.selectedMatch.matchId}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const meetingActions = (m) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
      <button
        type="button"
        onClick={() => joinMeeting(m)}
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
      <button
        type="button"
        onClick={() => copyLink(m.roomId)}
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
        Copy link
      </button>
    </div>
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        overflow: "hidden",
        background: "#f5f6fa"
      }}
    >
      <div
        style={{
          width: 280,
          minWidth: 240,
          flexShrink: 0,
          alignSelf: "stretch",
          minHeight: 0,
          background: "linear-gradient(180deg, #667eea 0%, #764ba2 100%)",
          color: "white",
          display: "flex",
          flexDirection: "column",
          boxShadow: "2px 0 10px rgba(0,0,0,0.1)",
          overflow: "hidden",
          overflowX: "hidden",
          overflowY: "hidden"
        }}
      >
        <div style={{ padding: 30, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
          <h2 style={{ margin: "0 0 5px 0", fontSize: 24 }}>PSVBet</h2>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.9 }}>Client portal</p>
          <p style={{ margin: "10px 0 0 0", fontSize: 14, opacity: 0.95 }}>
            {clientUser.name || "Client"}
          </p>
          <p style={{ margin: "4px 0 0 0", fontSize: 12, opacity: 0.85 }}>Host: {hostLabel}</p>
        </div>

        <nav
          style={{
            flex: 1,
            minHeight: 0,
            padding: "20px 0",
            overflow: "hidden",
            overflowY: "hidden"
          }}
        >
          {navBtn("dashboard", "📊", "Dashboard")}
          {navBtn("meetings", "📹", "Meetings")}
          {navBtn("recordings", "🎙️", "Recordings")}
          {navBtn("matches", "🏏", "Matches")}
        </nav>

        <div style={{ padding: 20, borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          <button
            type="button"
            onClick={logout}
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
          <p style={{ margin: "14px 0 0", fontSize: 12, textAlign: "center", opacity: 0.85 }}>
            <Link to="/client/login" style={{ color: "white" }}>
              Switch account
            </Link>
          </p>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "auto",
          WebkitOverflowScrolling: "touch"
        }}
      >
        <div
          style={{
            background: "white",
            padding: "20px 40px",
            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              color: "#1a252f",
              fontFamily: fontUi,
              fontWeight: 700,
              letterSpacing: "-0.02em"
            }}
          >
            {activeView === "dashboard"
              ? "Dashboard"
              : activeView === "meetings"
                ? "Meetings"
                : activeView === "recordings"
                  ? "Recordings"
                  : "Cricket matches"}
          </h1>
          {(activeView === "dashboard" ||
            activeView === "meetings" ||
            activeView === "recordings") && (
            <button
              type="button"
              onClick={() => {
                setLoadingMeetings(true);
                fetchMeetings();
              }}
              disabled={loadingMeetings}
              style={{
                padding: "10px 20px",
                background: "linear-gradient(180deg, #7689f0 0%, #667eea 100%)",
                color: "white",
                border: "none",
                borderRadius: 10,
                cursor: loadingMeetings ? "wait" : "pointer",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: fontUi,
                boxShadow: "0 2px 6px rgba(102, 126, 234, 0.35)",
                opacity: loadingMeetings ? 0.7 : 1
              }}
            >
              {loadingMeetings ? "Refreshing…" : "Refresh meetings"}
            </button>
          )}
        </div>

        <div style={{ padding: 40 }}>
          {error && (
            <div
              style={{
                background: "#fdecea",
                color: "#c0392b",
                padding: 16,
                borderRadius: 10,
                marginBottom: 24
              }}
            >
              {error}
            </div>
          )}

          {activeView === "dashboard" && (
            <div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 20,
                  marginBottom: 40
                }}
              >
                <div
                  style={{
                    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                    padding: 30,
                    borderRadius: 12,
                    color: "white",
                    boxShadow: "0 4px 12px rgba(102,126,234,0.3)"
                  }}
                >
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Total meetings</div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{meetings.length}</div>
                </div>
                <div
                  style={{
                    background: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
                    padding: 30,
                    borderRadius: 12,
                    color: "white",
                    boxShadow: "0 4px 12px rgba(245,87,108,0.3)"
                  }}
                >
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>Active</div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{activeMeetings.length}</div>
                </div>
                <div
                  style={{
                    background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
                    padding: 30,
                    borderRadius: 12,
                    color: "white",
                    boxShadow: "0 4px 12px rgba(79,172,254,0.3)"
                  }}
                >
                  <div style={{ fontSize: 14, opacity: 0.9, marginBottom: 8 }}>
                    With linked match
                  </div>
                  <div style={{ fontSize: 36, fontWeight: 700 }}>{linkedMatchCount}</div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 30,
                  marginBottom: 40
                }}
              >
                <div
                  style={{
                    background: "white",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 20
                    }}
                  >
                    <h3 style={{ margin: 0, color: "#2c3e50" }}>Recent meetings</h3>
                    <button
                      type="button"
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
                      View all
                    </button>
                  </div>
                  {meetings.slice(0, 6).map((meeting) => (
                    <div
                      key={meeting.roomId}
                      style={{
                        padding: "12px 0",
                        borderBottom: "1px solid #f0f0f0",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 500,
                            color: "#2c3e50",
                            marginBottom: 4
                          }}
                        >
                          {meeting.title || "Untitled"}
                        </div>
                        <div style={{ fontSize: 12, color: "#95a5a6" }}>
                          {meeting.createdAt
                            ? new Date(meeting.createdAt).toLocaleString()
                            : "—"}
                        </div>
                      </div>
                      {!meeting.isActive && (
                        <span
                          style={{
                            padding: "4px 12px",
                            background: "#f8d7da",
                            color: "#721c24",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            flexShrink: 0
                          }}
                        >
                          CLOSED
                        </span>
                      )}
                    </div>
                  ))}
                  {meetings.length === 0 && !loadingMeetings && (
                    <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                      No meetings yet
                    </div>
                  )}
                  {loadingMeetings && (
                    <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                      Loading…
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: "white",
                    padding: 24,
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                  }}
                >
                  <h3 style={{ margin: "0 0 16px 0", color: "#2c3e50" }}>Your account</h3>
                  <div style={{ fontSize: 14, color: "#7f8c8d", lineHeight: 1.8 }}>
                    <div>
                      <strong style={{ color: "#2c3e50" }}>Name:</strong>{" "}
                      {clientUser.name || "—"}
                    </div>
                    <div>
                      <strong style={{ color: "#2c3e50" }}>Client ID:</strong>{" "}
                      <span style={{ fontFamily: "monospace" }}>{clientUser.clientId || "—"}</span>
                    </div>
                    <div>
                      <strong style={{ color: "#2c3e50" }}>Host:</strong> {hostLabel}
                    </div>
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: "white",
                  padding: 24,
                  borderRadius: 12,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 20,
                    flexWrap: "wrap",
                    gap: 12
                  }}
                >
                  <h3 style={{ margin: 0, color: "#2c3e50" }}>🏏 Live cricket</h3>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setActiveView("matches")}
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
                      All matches
                    </button>
                    <button
                      type="button"
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
                      {loadingMatches ? "Loading…" : "Refresh"}
                    </button>
                  </div>
                </div>
                {loadingMatches ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                    Loading matches…
                  </div>
                ) : cricketMatches.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#95a5a6" }}>
                    <div style={{ fontSize: 48, marginBottom: 10 }}>🏏</div>
                    <div>No matches data (check API key on server)</div>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 16 }}>
                    {cricketMatches
                      .filter((match) => !match.matchEnded)
                      .slice(0, 5)
                      .map((match) => (
                        <div
                          key={match.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => fetchMatchDetails(match.id)}
                          onKeyDown={(e) =>
                            e.key === "Enter" && fetchMatchDetails(match.id)
                          }
                          style={{
                            padding: 16,
                            border: "2px solid #f0f0f0",
                            borderRadius: 10,
                            cursor: "pointer"
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              marginBottom: 12
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: "#2c3e50",
                                  marginBottom: 4,
                                  fontSize: 15
                                }}
                              >
                                {match.name}
                              </div>
                              <div style={{ fontSize: 12, color: "#7f8c8d" }}>
                                {match.matchType} • {match.venue}
                              </div>
                              <div style={{ fontSize: 11, color: "#95a5a6" }}>
                                {new Date(match.dateTimeGMT).toLocaleString()}
                              </div>
                            </div>
                            <span
                              style={{
                                padding: "4px 10px",
                                background: match.matchStarted ? "#27ae60" : "#3498db",
                                color: "white",
                                borderRadius: 12,
                                fontSize: 10,
                                fontWeight: 600
                              }}
                            >
                              {match.matchStarted ? "LIVE" : "UPCOMING"}
                            </span>
                          </div>
                          {match.score?.length > 0 && (
                            <div
                              style={{
                                background: "#f8f9fa",
                                padding: 12,
                                borderRadius: 8,
                                fontSize: 13
                              }}
                            >
                              {match.score.map((scoreItem, idx) => (
                                <div key={idx} style={{ color: "#2c3e50" }}>
                                  <span style={{ fontWeight: 600 }}>{scoreItem.inning}:</span>{" "}
                                  {scoreItem.r}/{scoreItem.w}
                                </div>
                              ))}
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
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  marginBottom: 24,
                  alignItems: "center"
                }}
              >
                <input
                  type="search"
                  placeholder="Search title, room, host, match…"
                  value={meetingSearchQuery}
                  onChange={(e) => setMeetingSearchQuery(e.target.value)}
                  style={{
                    flex: "1 1 260px",
                    minWidth: 200,
                    padding: "12px 14px",
                    border: "2px solid #e0e0e0",
                    borderRadius: 8,
                    fontSize: 14
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 30,
                  borderBottom: "2px solid #e0e0e0",
                  flexWrap: "wrap"
                }}
              >
                <button
                  type="button"
                  onClick={() => setMeetingsTab("active")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      meetingsTab === "active"
                        ? "3px solid #667eea"
                        : "3px solid transparent",
                    color: meetingsTab === "active" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600
                  }}
                >
                  Active ({activeMeetings.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMeetingsTab("closed")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      meetingsTab === "closed"
                        ? "3px solid #667eea"
                        : "3px solid transparent",
                    color: meetingsTab === "closed" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600
                  }}
                >
                  Closed ({closedMeetings.length})
                </button>
              </div>

              {meetingsTab === "active" &&
                (loadingMeetings ? (
                  <div style={{ textAlign: "center", padding: 60, color: "#95a5a6" }}>
                    Loading meetings…
                  </div>
                ) : filteredActive.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 60,
                      background: "white",
                      borderRadius: 12,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                    }}
                  >
                    <div style={{ fontSize: 64, marginBottom: 20 }}>📹</div>
                    <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>
                      {activeMeetings.length === 0
                        ? "No active meetings"
                        : "No matches for your search"}
                    </h3>
                    <p style={{ margin: 0, color: "#7f8c8d" }}>
                      {activeMeetings.length === 0
                        ? "Your host has not started a meeting yet."
                        : "Try a different search."}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 20 }}>
                    {filteredActive.map((m) => (
                      <div
                        key={m.roomId}
                        style={{
                          background: "white",
                          padding: 24,
                          borderRadius: 12,
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                          border: "2px solid transparent"
                        }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <h3 style={{ margin: 0, color: "#2c3e50" }}>
                            {m.title || "Untitled meeting"}
                          </h3>
                        </div>
                        <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#7f8c8d" }}>
                          📅 Created:{" "}
                          {m.createdAt ? new Date(m.createdAt).toLocaleString() : "—"}
                        </p>
                        <p
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: 13,
                            color: "#95a5a6",
                            fontFamily: "monospace"
                          }}
                        >
                          🔑 Room ID: {m.roomId}
                        </p>
                        {renderMeetingDetailBlock(m)}
                        {meetingActions(m)}
                      </div>
                    ))}
                  </div>
                ))}

              {meetingsTab === "closed" &&
                (loadingMeetings ? (
                  <div style={{ textAlign: "center", padding: 60, color: "#95a5a6" }}>
                    Loading meetings…
                  </div>
                ) : filteredClosed.length === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 60,
                      background: "white",
                      borderRadius: 12,
                      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                    }}
                  >
                    <div style={{ fontSize: 64, marginBottom: 20 }}>🔒</div>
                    <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>
                      {closedMeetings.length === 0
                        ? "No closed meetings"
                        : "No matches for your search"}
                    </h3>
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 20 }}>
                    {filteredClosed.map((m) => (
                      <div
                        key={m.roomId}
                        style={{
                          background: "white",
                          padding: 24,
                          borderRadius: 12,
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                          opacity: 0.95
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 8,
                            flexWrap: "wrap"
                          }}
                        >
                          <h3 style={{ margin: 0, color: "#2c3e50" }}>
                            {m.title || "Untitled meeting"}
                          </h3>
                          <span
                            style={{
                              padding: "4px 12px",
                              background: "#95a5a6",
                              color: "white",
                              borderRadius: 12,
                              fontSize: 12,
                              fontWeight: 600
                            }}
                          >
                            CLOSED
                          </span>
                        </div>
                        <p style={{ margin: "0 0 4px 0", fontSize: 14, color: "#7f8c8d" }}>
                          📅 Created:{" "}
                          {m.createdAt ? new Date(m.createdAt).toLocaleString() : "—"}
                        </p>
                        <p
                          style={{
                            margin: "0 0 4px 0",
                            fontSize: 13,
                            color: "#95a5a6",
                            fontFamily: "monospace"
                          }}
                        >
                          🔑 Room ID: {m.roomId}
                        </p>
                        {renderMeetingDetailBlock(m)}
                        {meetingActions(m)}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}

          {activeView === "recordings" && (
            <div>
              <p
                style={{
                  color: "#5d6d7e",
                  marginBottom: 28,
                  maxWidth: 640,
                  lineHeight: 1.6,
                  fontSize: 15,
                  fontFamily: fontUi
                }}
              >
                Clips saved while you were <strong style={{ color: "#2c3e50" }}>unmuted</strong> in a
                meeting. Expand a meeting to see each clip —{" "}
                <strong style={{ color: "#2c3e50" }}>View</strong> opens in the browser;{" "}
                <strong style={{ color: "#2c3e50" }}>Download</strong> saves the file.
              </p>
              {loadingMeetings ? (
                <div style={{ textAlign: "center", padding: 48, color: "#95a5a6" }}>Loading…</div>
              ) : meetingsWithMyRecordings.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 48,
                    background: "white",
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                    color: "#95a5a6"
                  }}
                >
                  No recordings yet. Join a meeting and unmute to capture a clip.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 16, fontFamily: fontUi }}>
                  {meetingsWithMyRecordings.map(({ meeting: m, segments }) => {
                    const mOpen = isRecordingsMeetingOpen(m.roomId);
                    const matchName = (m.selectedMatch?.matchName || "").trim();
                    const league = (m.selectedMatch?.league || "").trim();
                    const titleTrim = (m.title || "").trim();
                    const fromMatch = [matchName, league].filter(Boolean).join(" · ");
                    const primaryHeading =
                      titleTrim && !/^meeting$/i.test(titleTrim) && !/^untitled/i.test(titleTrim)
                        ? titleTrim
                        : fromMatch || titleTrim || "Meeting";
                    const matchId = m.selectedMatch?.matchId;
                    const showMatchIdLine =
                      matchId &&
                      !(titleTrim && String(titleTrim).includes(String(matchId)));
                    const collapseBtnStyle = {
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      width: "100%",
                      textAlign: "left",
                      padding: "16px 18px",
                      border: "none",
                      borderRadius: 0,
                      cursor: "pointer",
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#1a252f",
                      fontFamily: fontUi,
                      background: "linear-gradient(180deg, #f0f3fb 0%, #e8ecf6 100%)",
                      borderBottom: "1px solid #dde2ec"
                    };
                    return (
                      <div
                        key={m.roomId}
                        style={{
                          border: "1px solid #d8dce6",
                          borderRadius: 14,
                          overflow: "hidden",
                          background: "white",
                          boxShadow: "0 4px 14px rgba(15, 23, 42, 0.06)"
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => toggleRecordingsMeeting(m.roomId)}
                          style={collapseBtnStyle}
                        >
                          <span
                            aria-hidden
                            style={{
                              fontSize: 11,
                              color: "#667eea",
                              marginTop: 5,
                              flexShrink: 0,
                              width: 18,
                              textAlign: "center"
                            }}
                          >
                            {mOpen ? "▼" : "▶"}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", lineHeight: 1.35 }}>{primaryHeading}</span>
                            {showMatchIdLine ? (
                              <span
                                style={{
                                  display: "block",
                                  marginTop: 6,
                                  fontWeight: 500,
                                  fontSize: 12,
                                  color: "#5d6d7e",
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
                                }}
                              >
                                Match ID {matchId}
                              </span>
                            ) : null}
                            <span
                              style={{
                                display: "block",
                                marginTop: 10,
                                fontSize: 13,
                                color: "#5d6d7e",
                                lineHeight: 1.5
                              }}
                            >
                              <span style={{ color: "#7f8c8d" }}>Room</span>{" "}
                              <span
                                style={{
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                                  color: "#34495e",
                                  fontWeight: 500
                                }}
                              >
                                {m.roomId}
                              </span>
                              <span style={{ color: "#bdc3c7", margin: "0 8px" }}>|</span>
                              <span style={{ fontWeight: 600, color: "#667eea" }}>
                                {segments.length} clip{segments.length === 1 ? "" : "s"}
                              </span>
                            </span>
                          </span>
                        </button>
                        {mOpen && (
                          <div
                            style={{
                              padding: "16px 18px 18px",
                              background: "#fafbfc",
                              borderTop: "1px solid #eef0f4"
                            }}
                          >
                            {renderRecordingListBlock(segments, {
                              showName: false,
                              showActions: true
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeView === "matches" && (
            <div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 30,
                  borderBottom: "2px solid #e0e0e0",
                  flexWrap: "wrap",
                  alignItems: "center"
                }}
              >
                <button
                  type="button"
                  onClick={() => setMatchesTab("live")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      matchesTab === "live"
                        ? "3px solid #667eea"
                        : "3px solid transparent",
                    color: matchesTab === "live" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600
                  }}
                >
                  Live (
                  {
                    getFilteredMatches(
                      cricketMatches.filter((m) => m.matchStarted && !m.matchEnded)
                    ).length
                  }
                  )
                </button>
                <button
                  type="button"
                  onClick={() => setMatchesTab("upcoming")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      matchesTab === "upcoming"
                        ? "3px solid #667eea"
                        : "3px solid transparent",
                    color: matchesTab === "upcoming" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600
                  }}
                >
                  Upcoming (
                  {getFilteredMatches(cricketMatches.filter((m) => !m.matchStarted)).length})
                </button>
                <button
                  type="button"
                  onClick={() => setMatchesTab("ended")}
                  style={{
                    padding: "12px 24px",
                    background: "transparent",
                    border: "none",
                    borderBottom:
                      matchesTab === "ended"
                        ? "3px solid #667eea"
                        : "3px solid transparent",
                    color: matchesTab === "ended" ? "#667eea" : "#7f8c8d",
                    cursor: "pointer",
                    fontSize: 16,
                    fontWeight: 600
                  }}
                >
                  Ended (
                  {getFilteredMatches(cricketMatches.filter((m) => m.matchEnded)).length})
                </button>
                <button
                  type="button"
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
                  {loadingMatches ? "Loading…" : "Refresh"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 15,
                  marginBottom: 20,
                  padding: "15px 20px",
                  background: "white",
                  borderRadius: 10,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
                  flexWrap: "wrap"
                }}
              >
                <div style={{ flex: "1 1 200px" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#2c3e50"
                    }}
                  >
                    Match type
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
                      cursor: "pointer"
                    }}
                  >
                    {matchTypes.map((type) => (
                      <option key={type} value={type}>
                        {type === "all" ? "All types" : type}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <label
                    style={{
                      display: "block",
                      marginBottom: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#2c3e50"
                    }}
                  >
                    League
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
                      cursor: "pointer"
                    }}
                  >
                    {leagues.map((league) => (
                      <option key={league} value={league}>
                        {league === "all" ? "All leagues" : league}
                      </option>
                    ))}
                  </select>
                </div>
                {(matchTypeFilter !== "all" || leagueFilter !== "all") && (
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    <button
                      type="button"
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
                        fontWeight: 500
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>

              {loadingMatches ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: 60,
                    background: "white",
                    borderRadius: 12,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                  }}
                >
                  Loading…
                </div>
              ) : (
                <>
                  {matchesTab === "live" &&
                    (getFilteredMatches(
                      cricketMatches.filter((m) => m.matchStarted && !m.matchEnded)
                    ).length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          padding: 60,
                          background: "white",
                          borderRadius: 12,
                          boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
                        }}
                      >
                        <div style={{ fontSize: 64, marginBottom: 20 }}>🏏</div>
                        <h3 style={{ margin: "0 0 10px 0", color: "#2c3e50" }}>No live matches</h3>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(
                          cricketMatches.filter((m) => m.matchStarted && !m.matchEnded)
                        ).map((match) => (
                          <div
                            key={match.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => fetchMatchDetails(match.id)}
                            onKeyDown={(e) =>
                              e.key === "Enter" && fetchMatchDetails(match.id)
                            }
                            style={{
                              background: "white",
                              padding: 24,
                              borderRadius: 12,
                              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                              border: "2px solid #27ae60",
                              cursor: "pointer"
                            }}
                          >
                            <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600 }}>
                              {match.league}
                            </div>
                            <div
                              style={{
                                fontWeight: 600,
                                color: "#2c3e50",
                                marginTop: 8,
                                fontSize: 18
                              }}
                            >
                              {match.name}
                            </div>
                            <div style={{ fontSize: 14, color: "#7f8c8d", marginTop: 8 }}>
                              {match.matchType} • {match.venue}
                            </div>
                            {match.status && (
                              <div style={{ marginTop: 10, fontSize: 13, color: "#667eea" }}>
                                {match.status}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}

                  {matchesTab === "upcoming" &&
                    (getFilteredMatches(cricketMatches.filter((m) => !m.matchStarted))
                      .length === 0 ? (
                      <div
                        style={{
                          textAlign: "center",
                          padding: 60,
                          background: "white",
                          borderRadius: 12
                        }}
                      >
                        No upcoming matches
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(cricketMatches.filter((m) => !m.matchStarted)).map(
                          (match) => (
                            <div
                              key={match.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => fetchMatchDetails(match.id)}
                              style={{
                                background: "white",
                                padding: 24,
                                borderRadius: 12,
                                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                                cursor: "pointer"
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 16 }}>{match.name}</div>
                              <div style={{ fontSize: 13, color: "#7f8c8d", marginTop: 8 }}>
                                {new Date(match.dateTimeGMT).toLocaleString()}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    ))}

                  {matchesTab === "ended" &&
                    (getFilteredMatches(cricketMatches.filter((m) => m.matchEnded)).length ===
                    0 ? (
                      <div style={{ textAlign: "center", padding: 60, background: "white" }}>
                        No ended matches
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 20 }}>
                        {getFilteredMatches(cricketMatches.filter((m) => m.matchEnded)).map(
                          (match) => (
                            <div
                              key={match.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => fetchMatchDetails(match.id)}
                              style={{
                                background: "white",
                                padding: 24,
                                borderRadius: 12,
                                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
                                cursor: "pointer",
                                opacity: 0.95
                              }}
                            >
                              <div style={{ fontWeight: 600 }}>{match.name}</div>
                              <div style={{ fontSize: 13, color: "#7f8c8d", marginTop: 6 }}>
                                {match.status}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

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
                <div style={{ color: "#95a5a6", fontSize: 18 }}>Loading match details…</div>
              </div>
            ) : selectedMatch ? (
              <>
                <div
                  style={{
                    padding: "24px 30px",
                    borderBottom: "2px solid #f0f0f0",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start"
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: "#667eea",
                        fontWeight: 600,
                        marginBottom: 8,
                        textTransform: "uppercase"
                      }}
                    >
                      {selectedMatch.league_name}
                    </div>
                    <h2 style={{ margin: "0 0 12px 0", fontSize: 24, color: "#2c3e50" }}>
                      {selectedMatch.event_home_team} vs {selectedMatch.event_away_team}
                    </h2>
                    <div
                      style={{
                        display: "flex",
                        gap: 15,
                        flexWrap: "wrap",
                        fontSize: 14,
                        color: "#7f8c8d"
                      }}
                    >
                      <span>📍 {selectedMatch.event_stadium || "Venue TBA"}</span>
                      <span>🏏 {selectedMatch.event_type}</span>
                      <span>
                        📅 {new Date(selectedMatch.event_date_start).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
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

                <div style={{ padding: "20px 30px", background: "#f8f9fa" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
                    <span
                      style={{
                        padding: "8px 16px",
                        background:
                          selectedMatch.event_live === "1"
                            ? "#27ae60"
                            : selectedMatch.event_status === "Finished"
                              ? "#95a5a6"
                              : "#3498db",
                        color: "white",
                        borderRadius: 20,
                        fontSize: 13,
                        fontWeight: 600
                      }}
                    >
                      {selectedMatch.event_status === "Finished"
                        ? "ENDED"
                        : selectedMatch.event_live === "1"
                          ? "🔴 LIVE"
                          : "UPCOMING"}
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

                {(selectedMatch.event_home_final_result ||
                  selectedMatch.event_away_final_result) && (
                  <div style={{ padding: "24px 30px" }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: 18, color: "#2c3e50" }}>
                      Match score
                    </h3>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div
                        style={{
                          padding: 16,
                          background: "#f8f9fa",
                          borderRadius: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 16, color: "#2c3e50" }}>
                          {selectedMatch.event_home_team}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#667eea" }}>
                          {selectedMatch.event_home_final_result || "Yet to bat"}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: 16,
                          background: "#f8f9fa",
                          borderRadius: 10,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 16, color: "#2c3e50" }}>
                          {selectedMatch.event_away_team}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, color: "#667eea" }}>
                          {selectedMatch.event_away_final_result || "Yet to bat"}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {selectedMatch.scorecard && Object.keys(selectedMatch.scorecard).length > 0 && (
                  <div style={{ padding: "24px 30px", borderTop: "2px solid #f0f0f0" }}>
                    <h3 style={{ margin: "0 0 16px 0", fontSize: 18, color: "#2c3e50" }}>
                      Scorecard
                    </h3>
                    {Object.entries(selectedMatch.scorecard).map(([inning, players]) => (
                      <div key={inning} style={{ marginBottom: 24 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 15,
                            color: "#667eea",
                            marginBottom: 12,
                            padding: "8px 12px",
                            background: "#f0f4ff",
                            borderRadius: 6
                          }}
                        >
                          {inning}
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table
                            style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}
                          >
                            <thead>
                              <tr style={{ background: "#f8f9fa", borderBottom: "2px solid #e0e0e0" }}>
                                <th style={{ padding: "10px 8px", textAlign: "left" }}>Player</th>
                                <th style={{ padding: "10px 8px", textAlign: "center" }}>R</th>
                                <th style={{ padding: "10px 8px", textAlign: "center" }}>B</th>
                                <th style={{ padding: "10px 8px", textAlign: "center" }}>4s</th>
                                <th style={{ padding: "10px 8px", textAlign: "center" }}>6s</th>
                                <th style={{ padding: "10px 8px", textAlign: "center" }}>SR</th>
                              </tr>
                            </thead>
                            <tbody>
                              {players.slice(0, 11).map((player, idx) =>
                                player.type === "Batsman" ? (
                                  <tr key={idx} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                    <td style={{ padding: "10px 8px" }}>
                                      <div style={{ fontWeight: 500, color: "#2c3e50" }}>
                                        {player.player}
                                      </div>
                                      <div style={{ fontSize: 11, color: "#95a5a6" }}>
                                        {player.status}
                                      </div>
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                      {player.R}
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                      {player.B}
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                      {player["4s"]}
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                      {player["6s"]}
                                    </td>
                                    <td style={{ padding: "10px 8px", textAlign: "center" }}>
                                      {player.SR}
                                    </td>
                                  </tr>
                                ) : null
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedMatch.event_man_of_match && (
                  <div
                    style={{
                      padding: "20px 30px",
                      background: "#fff8e1",
                      borderTop: "2px solid #f0f0f0"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 24 }}>🏆</span>
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "#f57c00",
                            fontWeight: 600,
                            marginBottom: 2
                          }}
                        >
                          MAN OF THE MATCH
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, color: "#2c3e50" }}>
                          {selectedMatch.event_man_of_match}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ padding: "20px 30px", borderTop: "2px solid #f0f0f0", textAlign: "center" }}>
                  <button
                    type="button"
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
    </div>
  );
}
