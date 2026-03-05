import { useEffect, useRef, useState, useCallback } from "react";
import { flushSync } from "react-dom";
import { useParams, useNavigate } from "react-router-dom";
import Peer from "peerjs";
import socket from "../socket";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

export default function Meeting() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [meetingInfo, setMeetingInfo] = useState(null);
  const [showCopied, setShowCopied] = useState(false);
  const [userName, setUserName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [tempName, setTempName] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientPassword, setClientPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [userId, setUserId] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [privateCallActive, setPrivateCallActive] = useState(null); // peerId of private call
  const [showPrivateMenu, setShowPrivateMenu] = useState(null); // peerId to show menu for
  const [matchData, setMatchData] = useState(null);
  const [liveScore, setLiveScore] = useState(null);
  const [loadingScore, setLoadingScore] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState("");
  const [teamAOdds, setTeamAOdds] = useState("");
  const [teamBOdds, setTeamBOdds] = useState("");
  const [sharedOdds, setSharedOdds] = useState(null);
  const [oddsShared, setOddsShared] = useState(false);
  
  const localVideoRef = useRef();
  const peerInstance = useRef(null);
  const activeCalls = useRef(new Set());
  const isInitialized = useRef(false);
  const audioContext = useRef(null);
  const localAnalyser = useRef(null);
  const privateAudioStream = useRef(null);
  const hasJoinedMeeting = useRef(false);

  useEffect(() => {
    fetchMeetingInfo();
    checkUserAuth();

    // Set up odds-update listener early
    socket.on("odds-update", (data) => {
      console.log('📊 [Component Level] Odds update received:', data);
      setSharedOdds(data);
    });

    return () => {
      console.log("Cleaning up...");
      isInitialized.current = false;
      hasJoinedMeeting.current = false;
      activeCalls.current.clear();
      
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerInstance.current) {
        peerInstance.current.destroy();
        peerInstance.current = null;
      }
      if (audioContext.current) {
        audioContext.current.close();
        audioContext.current = null;
      }
      if (privateAudioStream.current) {
        privateAudioStream.current.getTracks().forEach(track => track.stop());
      }
      
      // Clear remote streams
      setRemoteStreams({});
      
      socket.emit("leave-meeting", { roomId });
      socket.off("user-joined");
      socket.off("user-left");
      socket.off("private-call-request");
      socket.off("private-call-ended");
      socket.off("odds-update");
    };
  }, [roomId]);

  const setupAudioDetection = (stream, setSpeakingState) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContext.current = ctx;
      
      const audioSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      
      audioSource.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const detectSound = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        
        // Threshold for speaking detection
        setSpeakingState(average > 20);
        
        requestAnimationFrame(detectSound);
      };
      
      detectSound();
    } catch (error) {
      console.error('Audio detection setup failed:', error);
    }
  };

  const startPrivateCall = async (targetPeerId, targetUserName) => {
    if (!isHost) return;
    
    console.log('Starting private call with:', targetUserName);
    setPrivateCallActive(targetPeerId);
    setShowPrivateMenu(null);
    
    // Notify the participant
    socket.emit("start-private-call", { 
      roomId, 
      targetPeerId,
      fromPeerId: peerInstance.current.id,
      fromUserName: userName
    });
  };

  const endPrivateCall = () => {
    console.log('Ending private call');
    setPrivateCallActive(null);
    
    socket.emit("end-private-call", { 
      roomId,
      targetPeerId: privateCallActive
    });
  };

  const checkUserAuth = async () => {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    const storedClient = sessionStorage.getItem("clientAuth");
    
    // Check if user is the host
    let userIsHost = false;
    let uid = null;
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}`);
      const meetingData = await response.json();
      
      console.log('Meeting data:', meetingData);
      console.log('Current user:', user);
      
      // Use 'id' field from localStorage (not '_id')
      if (user.id) {
        uid = user.id;
        // Compare as strings since MongoDB ObjectId comes as string in JSON
        if (meetingData.hostId === user.id || meetingData.hostId.toString() === user.id.toString()) {
          userIsHost = true;
          setIsHost(true);
          setUserId(user.id);
          console.log('User is HOST');
        } else {
          console.log('User is PARTICIPANT');
        }
      }
    } catch (error) {
      console.error("Failed to check host status:", error);
    }
    
    if (user.name) {
      setUserName(user.name);
      initializeMedia(user.name, uid, userIsHost);
    } else if (storedClient) {
      const clientData = JSON.parse(storedClient);
      setUserName(clientData.name);
      initializeMedia(clientData.name, null, false);
    } else {
      setShowNamePrompt(true);
    }
  };

  const handleClientLogin = async () => {
    setAuthError("");
    
    if (!clientId.trim() || !clientPassword.trim()) {
      setAuthError("Please enter both Client ID and Password");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/client/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ clientId, password: clientPassword })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        sessionStorage.setItem("clientAuth", JSON.stringify(data.client));
        setUserName(data.client.name);
        setShowNamePrompt(false);
        initializeMedia(data.client.name, null, false);
      } else {
        setAuthError(data.message || "Invalid credentials");
      }
    } catch (error) {
      setAuthError("Failed to verify credentials");
    }
  };

  const fetchMeetingInfo = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}`);
      const data = await response.json();
      setMeetingInfo(data);
      
      // If meeting has a selected match, fetch its live score
      if (data.selectedMatch && data.selectedMatch.matchId) {
        setMatchData(data.selectedMatch);
        fetchLiveScore(data.selectedMatch.matchId);
      }
    } catch (error) {
      console.error("Failed to fetch meeting info");
    }
  };

  const fetchLiveScore = async (matchId) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/cricket/match/${matchId}`);
      const data = await response.json();
      
      if (data.success && data.result && data.result.length > 0) {
        // Use flushSync for immediate UI update
        flushSync(() => {
          setLiveScore(data.result[0]);
        });
        console.log('✅ Score updated:', data.result[0].event_home_final_result, 'vs', data.result[0].event_away_final_result);
      }
    } catch (error) {
      console.error("Failed to fetch live score:", error);
    }
  };

  // Poll for live score updates every 1 second
  useEffect(() => {
    if (matchData && matchData.matchId) {
      // Fetch immediately on mount
      fetchLiveScore(matchData.matchId);
      
      // Then poll every 1 second
      const interval = setInterval(() => {
        fetchLiveScore(matchData.matchId);
      }, 1000); // Update every 1 second

      return () => clearInterval(interval);
    }
  }, [matchData]);

  const initializeMedia = async (name, uid, userIsHost) => {
    // Prevent double initialization (React Strict Mode)
    if (isInitialized.current) {
      console.log('Already initialized, skipping...');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      
      isInitialized.current = true; // Set after getting stream
      
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Set up audio level detection for local stream
      setupAudioDetection(stream, setIsSpeaking);

      // Initialize PeerJS
      const apiUrl = new URL(API_BASE_URL);
      const isSecure = apiUrl.protocol === 'https:';
      const peerHost = apiUrl.hostname;
      const peerPort = apiUrl.port || (isSecure ? 443 : 80);
      
      const peer = new Peer(undefined, {
        host: peerHost,
        port: peerPort,
        path: '/peerjs',
        secure: isSecure,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" }
          ]
        }
      });

      peerInstance.current = peer;

      peer.on('open', (id) => {
        console.log('My peer ID is:', id, 'isHost:', userIsHost);
        
        // Prevent duplicate join-meeting events
        if (hasJoinedMeeting.current) {
          console.log('Already joined meeting, skipping duplicate join');
          return;
        }
        
        hasJoinedMeeting.current = true;
        
        // Clear any existing active calls
        activeCalls.current.clear();
        
        socket.emit("join-meeting", { 
          roomId, 
          userName: name, 
          peerId: id,
          userId: uid 
        });
      });

      peer.on('error', (err) => {
        console.error('PeerJS error:', err);
        if (err.type === 'unavailable-id') {
          // Peer ID already taken, destroy and retry
          peer.destroy();
          isInitialized.current = false;
        } else if (err.type === 'peer-unavailable') {
          // Peer doesn't exist anymore, remove from active calls
          const peerId = err.message.match(/peer (.+)/)?.[1];
          if (peerId) {
            console.log('Peer unavailable, removing:', peerId);
            activeCalls.current.delete(peerId);
            setRemoteStreams(prev => {
              const updated = { ...prev };
              delete updated[peerId];
              return updated;
            });
          }
        }
      });

      // Answer incoming calls
      peer.on('call', (call) => {
        console.log('Receiving call from:', call.peer, 'metadata:', call.metadata);
        call.answer(stream, { metadata: { userName: name, isHost: userIsHost } });
        
        call.on('stream', (remoteStream) => {
          console.log('Received remote stream from:', call.peer);
          const metadata = call.metadata || {};
          setRemoteStreams(prev => ({
            ...prev,
            [call.peer]: { 
              stream: remoteStream, 
              userName: metadata.userName || 'Participant', 
              isHost: metadata.isHost || false 
            }
          }));
        });
      });

      // Remove old listeners before adding new ones
      socket.off("user-joined");
      socket.off("user-left");

      // Listen for new users
      socket.on("user-joined", (data) => {
        console.log('User joined:', data);
        const { peerId, userName: remoteUserName, isHost: remoteIsHost } = data;
        
        // Prevent duplicate calls to the same peer
        if (activeCalls.current.has(peerId)) {
          console.log('Already have active call with:', peerId);
          return;
        }
        
        activeCalls.current.add(peerId);
        
        // Call the new user with metadata
        const call = peer.call(peerId, stream, { 
          metadata: { userName: name, isHost: userIsHost } 
        });
        
        if (!call) {
          console.error('Failed to create call to:', peerId);
          activeCalls.current.delete(peerId);
          return;
        }
        
        call.on('stream', (remoteStream) => {
          console.log('Received stream from:', peerId, remoteIsHost ? '(HOST)' : '(PARTICIPANT)');
          setRemoteStreams(prev => ({
            ...prev,
            [peerId]: { stream: remoteStream, userName: remoteUserName, isHost: remoteIsHost }
          }));
        });
        
        call.on('error', (err) => {
          console.error('Call error with peer:', peerId, err);
          activeCalls.current.delete(peerId);
          setRemoteStreams(prev => {
            const updated = { ...prev };
            delete updated[peerId];
            return updated;
          });
        });
        
        call.on('close', () => {
          console.log('Call closed with:', peerId);
          activeCalls.current.delete(peerId);
        });
      });

      socket.on("user-left", (peerId) => {
        console.log("User left:", peerId);
        activeCalls.current.delete(peerId);
        setRemoteStreams(prev => {
          const updated = { ...prev };
          delete updated[peerId];
          return updated;
        });
        
        // End private call if active with this user
        if (privateCallActive === peerId) {
          endPrivateCall();
        }
      });

      // Listen for private call requests
      socket.on("private-call-request", (data) => {
        const { fromPeerId, fromUserName } = data;
        console.log('Private call request from:', fromUserName);
        setPrivateCallActive(fromPeerId);
      });

      socket.on("private-call-ended", () => {
        console.log('Private call ended');
        setPrivateCallActive(null);
      });

    } catch (error) {
      console.error("Failed to get media:", error);
      alert("Please allow camera and microphone access");
      isInitialized.current = false; // Reset on error
    }
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks()[0].enabled = isVideoOff;
      setIsVideoOff(!isVideoOff);
    }
  };

  const copyJoinLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const leaveMeeting = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerInstance.current) {
      peerInstance.current.destroy();
    }
    socket.emit("leave-meeting", { roomId });
    sessionStorage.removeItem("clientAuth");
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/");
    } else {
      navigate("/");
    }
  };

  if (showNamePrompt) {
    return (
      <div style={{
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          background: "white",
          padding: 40,
          borderRadius: 15,
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          maxWidth: 400,
          width: "90%"
        }}>
          <h2 style={{ margin: "0 0 10px 0", color: "#333" }}>Join Meeting</h2>
          <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: 14 }}>
            {meetingInfo?.title || "Meeting Room"}
          </p>
          
          {authError && (
            <div style={{
              padding: 12,
              background: "#fee",
              border: "1px solid #fcc",
              borderRadius: 8,
              color: "#c33",
              fontSize: 14,
              marginBottom: 15
            }}>
              {authError}
            </div>
          )}
          
          <label style={{ display: "block", marginBottom: 8, color: "#333", fontWeight: 500 }}>
            Client ID
          </label>
          <input
            type="text"
            placeholder="Enter your Client ID"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleClientLogin()}
            style={{
              width: "100%",
              padding: 12,
              border: "2px solid #e0e0e0",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 15,
              boxSizing: "border-box"
            }}
            autoFocus
          />

          <label style={{ display: "block", marginBottom: 8, color: "#333", fontWeight: 500 }}>
            Password
          </label>
          <input
            type="password"
            placeholder="Enter your password"
            value={clientPassword}
            onChange={(e) => setClientPassword(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleClientLogin()}
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
          
          <button
            onClick={handleClientLogin}
            disabled={!clientId.trim() || !clientPassword.trim()}
            style={{
              width: "100%",
              padding: 12,
              background: (clientId.trim() && clientPassword.trim()) ? "#667eea" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 500,
              cursor: (clientId.trim() && clientPassword.trim()) ? "pointer" : "not-allowed",
              transition: "all 0.3s"
            }}
          >
            Join Meeting
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", 
      minHeight: "100vh", 
      display: "flex",
      flexDirection: "column"
    }}>
      <div style={{ 
        padding: "15px 30px", 
        background: "rgba(0,0,0,0.3)",
        backdropFilter: "blur(10px)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "white"
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>{meetingInfo?.title || "Meeting Room"}</h2>
          <p style={{ margin: "5px 0 0 0", fontSize: 12, opacity: 0.8 }}>
            {userName} {isHost && '(Host)'} • {Object.keys(remoteStreams).length + 1} participant{Object.keys(remoteStreams).length !== 0 ? 's' : ''}
          </p>
        </div>
        {isHost && (
          <div style={{ position: "relative" }}>
            <button 
              onClick={copyJoinLink} 
              style={{ 
                padding: "10px 20px", 
                background: "rgba(255,255,255,0.2)", 
                border: "1px solid rgba(255,255,255,0.3)",
                color: "white", 
                borderRadius: 8, 
                cursor: "pointer",
                fontWeight: 500,
                transition: "all 0.3s"
              }}
              onMouseOver={(e) => e.target.style.background = "rgba(255,255,255,0.3)"}
              onMouseOut={(e) => e.target.style.background = "rgba(255,255,255,0.2)"}
            >
              📋 Copy Invite Link
            </button>
            {showCopied && (
              <div style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 5,
                padding: "5px 10px",
                background: "#27ae60",
                color: "white",
                borderRadius: 5,
                fontSize: 12,
                whiteSpace: "nowrap"
              }}>
                ✓ Link copied!
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compact Score & Odds Bar */}
      {matchData && liveScore && (
        <div style={{
          display: "flex",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          borderBottom: "2px solid rgba(255,255,255,0.2)"
        }}>
          {/* Left: Batting Team Score & Ball-by-Ball */}
          <div style={{
            flex: 1,
            padding: "20px 30px",
            color: "white"
          }}>
            {/* Top: Match Info and Score */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, opacity: 0.8, textTransform: "uppercase", marginBottom: 4 }}>
                  🏏 {matchData.league}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.95, marginBottom: 8 }}>
                  {matchData.matchName}
                </div>
                <div style={{ fontSize: 11, opacity: 0.85 }}>
                  Batting: <span style={{ fontWeight: 700, fontSize: 13 }}>
                    {(() => {
                      const status = liveScore.event_status_info?.toLowerCase() || '';
                      const homeTeam = liveScore.event_home_team;
                      const awayTeam = liveScore.event_away_team;
                      
                      if (status.includes(homeTeam.toLowerCase())) {
                        return homeTeam;
                      } else if (status.includes(awayTeam.toLowerCase())) {
                        return awayTeam;
                      }
                      
                      if (liveScore.event_home_final_result && liveScore.event_away_final_result) {
                        return awayTeam;
                      }
                      
                      return liveScore.event_home_final_result ? homeTeam : awayTeam;
                    })()}
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: "-2px" }}>
                  {(() => {
                    const status = liveScore.event_status_info?.toLowerCase() || '';
                    const homeTeam = liveScore.event_home_team;
                    const awayTeam = liveScore.event_away_team;
                    
                    if (status.includes(homeTeam.toLowerCase())) {
                      return liveScore.event_home_final_result || '0/0';
                    } else if (status.includes(awayTeam.toLowerCase())) {
                      return liveScore.event_away_final_result || '0/0';
                    }
                    
                    if (liveScore.event_home_final_result && liveScore.event_away_final_result) {
                      return liveScore.event_away_final_result;
                    }
                    
                    return liveScore.event_home_final_result || liveScore.event_away_final_result || '0/0';
                  })()}
                </div>
                {liveScore.event_status_info && (
                  <div style={{ 
                    fontSize: 10, 
                    opacity: 0.9,
                    marginTop: 6,
                    padding: "4px 8px",
                    background: "rgba(255,255,255,0.2)",
                    borderRadius: 4,
                    display: "inline-block"
                  }}>
                    {liveScore.event_status_info}
                  </div>
                )}
              </div>
            </div>

            {/* Bottom: Ball-by-Ball Current Over */}
            {liveScore.comments && Object.keys(liveScore.comments).length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>
                    ⚾ Current Over
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>
                    {(() => {
                      const allBalls = Object.values(liveScore.comments).flat();
                      if (allBalls.length > 0) {
                        const latestBall = allBalls[allBalls.length - 1];
                        return `Over ${latestBall.overs || '0'}`;
                      }
                      return 'Over 0';
                    })()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(() => {
                    const allBalls = Object.values(liveScore.comments).flat();
                    const currentOverBalls = allBalls.slice(-6);
                    
                    return currentOverBalls.map((ball, idx) => (
                      <div key={idx} style={{
                        minWidth: 32,
                        height: 32,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: ball.runs === "0" ? "rgba(255,255,255,0.3)" : 
                                    ball.runs === "4" ? "#3498db" : 
                                    ball.runs === "6" ? "#e74c3c" : 
                                    ball.runs === "W" ? "#2c3e50" : "rgba(255,255,255,0.5)",
                        color: "white",
                        borderRadius: 6,
                        fontWeight: 700,
                        fontSize: 14,
                        border: "2px solid rgba(255,255,255,0.4)"
                      }}>
                        {ball.runs === "0" ? "•" : ball.runs}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* Right: Betting Odds */}
          <div style={{
            width: 320,
            padding: "20px",
            background: "white",
            borderLeft: "1px solid rgba(0,0,0,0.1)",
            display: "flex",
            flexDirection: "column"
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#2c3e50", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
              <span>💰</span>
              <span>Betting Odds</span>
            </div>
            
            {isHost ? (
              <>
                <label style={{ display: "block", marginBottom: 6, fontSize: 11, color: "#7f8c8d", fontWeight: 500 }}>
                  Select Team
                </label>
                <select
                  value={selectedTeam}
                  onChange={(e) => setSelectedTeam(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    border: "2px solid #e0e0e0",
                    borderRadius: 6,
                    fontSize: 12,
                    marginBottom: 10,
                    cursor: "pointer"
                  }}
                >
                  <option value="">Select team...</option>
                  <option value={liveScore.event_home_team}>{liveScore.event_home_team}</option>
                  <option value={liveScore.event_away_team}>{liveScore.event_away_team}</option>
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: "block", marginBottom: 4, fontSize: 10, color: "#7f8c8d", fontWeight: 500 }}>
                      {liveScore.event_home_team} Odds
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 1.85"
                      value={teamAOdds}
                      onChange={(e) => setTeamAOdds(e.target.value)}
                      step="0.01"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "2px solid #e0e0e0",
                        borderRadius: 6,
                        fontSize: 12,
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", marginBottom: 4, fontSize: 10, color: "#7f8c8d", fontWeight: 500 }}>
                      {liveScore.event_away_team} Odds
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 2.10"
                      value={teamBOdds}
                      onChange={(e) => setTeamBOdds(e.target.value)}
                      step="0.01"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        border: "2px solid #e0e0e0",
                        borderRadius: 6,
                        fontSize: 12,
                        boxSizing: "border-box"
                      }}
                    />
                  </div>
                </div>

                <button
                  onClick={() => {
                    console.log('Share Odds clicked', { selectedTeam, teamAOdds, teamBOdds });
                    if (selectedTeam && (teamAOdds || teamBOdds)) {
                      const oddsData = {
                        roomId,
                        selectedTeam,
                        teamA: liveScore.event_home_team,
                        teamB: liveScore.event_away_team,
                        oddsA: teamAOdds,
                        oddsB: teamBOdds
                      };
                      console.log('Emitting share-odds:', oddsData);
                      socket.emit("share-odds", oddsData);
                      setSharedOdds(oddsData);
                      setOddsShared(true);
                      setTimeout(() => setOddsShared(false), 2000);
                      console.log('Odds shared successfully');
                    } else {
                      console.log('Validation failed:', { selectedTeam, teamAOdds, teamBOdds });
                    }
                  }}
                  disabled={!selectedTeam || (!teamAOdds && !teamBOdds)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    background: oddsShared ? "#27ae60" : ((selectedTeam && (teamAOdds || teamBOdds)) ? "#667eea" : "#ccc"),
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: (selectedTeam && (teamAOdds || teamBOdds)) ? "pointer" : "not-allowed",
                    transition: "background 0.3s"
                  }}
                >
                  {oddsShared ? "✓ Odds Shared!" : "Share Odds"}
                </button>
              </>
            ) : (
              <>
                {sharedOdds ? (
                  <div>
                    <div style={{ 
                      padding: "10px 12px", 
                      background: "#f0f4ff", 
                      borderRadius: 8,
                      marginBottom: 8,
                      border: "2px solid #667eea"
                    }}>
                      <div style={{ fontSize: 11, color: "#667eea", fontWeight: 600, marginBottom: 6 }}>
                        Favourite: {sharedOdds.selectedTeam}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 11 }}>
                        <div>
                          <div style={{ color: "#7f8c8d", marginBottom: 2 }}>{sharedOdds.teamA}</div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#2c3e50" }}>
                            {sharedOdds.oddsA || '-'}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: "#7f8c8d", marginBottom: 2 }}>{sharedOdds.teamB}</div>
                          <div style={{ fontWeight: 700, fontSize: 16, color: "#2c3e50" }}>
                            {sharedOdds.oddsB || '-'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ 
                    padding: "20px 10px", 
                    textAlign: "center", 
                    fontSize: 11, 
                    color: "#95a5a6" 
                  }}>
                    Waiting for host to share odds...
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ 
        flex: 1, 
        padding: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: Object.keys(remoteStreams).length > 0 ? "repeat(auto-fit, minmax(400px, 1fr))" : "1fr",
          gap: 20,
          width: "100%",
          maxWidth: 1400
        }}>
          <div style={{ 
            position: "relative", 
            background: "#000", 
            borderRadius: 15,
            overflow: "hidden",
            boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
            aspectRatio: "16/9",
            border: isSpeaking ? "3px solid #27ae60" : "3px solid transparent",
            transition: "border 0.2s"
          }}>
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              style={{ 
                width: "100%", 
                height: "100%", 
                objectFit: "cover",
                transform: "scaleX(-1)"
              }}
            />
            {isVideoOff && (
              <div style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "#1a1a1a",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center"
              }}>
                <div style={{ fontSize: 80, marginBottom: 10 }}>👤</div>
                <div style={{ fontSize: 18, color: "white" }}>{userName}</div>
              </div>
            )}
            {isSpeaking && (
              <div style={{
                position: "absolute",
                top: 15,
                right: 15,
                background: "#27ae60",
                padding: "6px 12px",
                borderRadius: 20,
                display: "flex",
                alignItems: "center",
                gap: 6,
                animation: "pulse 1s infinite"
              }}>
                <span style={{ fontSize: 16 }}>🎤</span>
                <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Speaking</span>
              </div>
            )}
            {privateCallActive && (
              <div style={{
                position: "absolute",
                top: 15,
                left: 15,
                background: "#e74c3c",
                padding: "6px 12px",
                borderRadius: 20,
                display: "flex",
                alignItems: "center",
                gap: 6
              }}>
                <span style={{ fontSize: 16 }}>🔒</span>
                <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Private Mode</span>
              </div>
            )}
            <div style={{ 
              position: "absolute", 
              bottom: 15, 
              left: 15, 
              background: "rgba(0,0,0,0.7)", 
              padding: "8px 15px", 
              borderRadius: 8,
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 8
            }}>
              <span>{userName} (You) {isHost && '👑'}</span>
              {isMuted && <span>🔇</span>}
            </div>
          </div>

          {Object.entries(remoteStreams).map(([peerId, data]) => (
            <RemoteVideo 
              key={peerId} 
              stream={data.stream} 
              userName={data.userName}
              isHost={data.isHost}
              peerId={peerId}
              showHostControls={isHost}
              isPrivateCallActive={privateCallActive === peerId}
              onStartPrivateCall={() => startPrivateCall(peerId, data.userName)}
              onEndPrivateCall={endPrivateCall}
            />
          ))}
        </div>
      </div>

      <div style={{ 
        position: "fixed",
        bottom: 40,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex", 
        justifyContent: "center",
        gap: 20,
        zIndex: 1000
      }}>
        <button 
          onClick={toggleMute} 
          style={{ 
            width: 70,
            height: 70,
            background: isMuted ? "#e74c3c" : "rgba(255,255,255,0.2)", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s",
            backdropFilter: "blur(10px)",
            boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
          }}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>

        <button 
          onClick={toggleVideo} 
          style={{ 
            width: 70,
            height: 70,
            background: isVideoOff ? "#e74c3c" : "rgba(255,255,255,0.2)", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s",
            backdropFilter: "blur(10px)",
            boxShadow: "0 4px 15px rgba(0,0,0,0.2)"
          }}
          title={isVideoOff ? "Start Video" : "Stop Video"}
        >
          {isVideoOff ? "📹" : "🎥"}
        </button>

        <button 
          onClick={leaveMeeting} 
          style={{ 
            width: 70,
            height: 70,
            background: "#e74c3c", 
            border: "2px solid rgba(255,255,255,0.3)",
            color: "white", 
            borderRadius: "50%", 
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 0.3s",
            boxShadow: "0 4px 15px rgba(231,76,60,0.4)"
          }}
          title="Leave Meeting"
        >
          📞
        </button>
      </div>
    </div>
  );
}

function RemoteVideo({ stream, userName, isHost, peerId, showHostControls, isPrivateCallActive, onStartPrivateCall, onEndPrivateCall }) {
  const ref = useRef();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const audioContextRef = useRef(null);

  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      
      // Set up audio detection for remote stream
      setupRemoteAudioDetection(stream);
    }

    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stream]);

  const setupRemoteAudioDetection = (mediaStream) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      
      const audioSource = ctx.createMediaStreamSource(mediaStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      
      audioSource.connect(analyser);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const detectSound = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        
        setIsSpeaking(average > 20);
        
        requestAnimationFrame(detectSound);
      };
      
      detectSound();
    } catch (error) {
      console.error('Remote audio detection setup failed:', error);
    }
  };

  return (
    <div style={{ 
      position: "relative", 
      background: "#000", 
      borderRadius: 15,
      overflow: "hidden",
      boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
      aspectRatio: "16/9",
      border: isSpeaking ? "3px solid #27ae60" : isPrivateCallActive ? "3px solid #e74c3c" : "3px solid transparent",
      transition: "border 0.2s"
    }}>
      <video
        ref={ref}
        autoPlay
        playsInline
        style={{ 
          width: "100%", 
          height: "100%", 
          objectFit: "cover"
        }}
      />
      {isSpeaking && (
        <div style={{
          position: "absolute",
          top: 15,
          right: 15,
          background: "#27ae60",
          padding: "6px 12px",
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span style={{ fontSize: 16 }}>🎤</span>
          <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Speaking</span>
        </div>
      )}
      {isPrivateCallActive && (
        <div style={{
          position: "absolute",
          top: 15,
          left: 15,
          background: "#e74c3c",
          padding: "6px 12px",
          borderRadius: 20,
          display: "flex",
          alignItems: "center",
          gap: 6
        }}>
          <span style={{ fontSize: 16 }}>🔒</span>
          <span style={{ fontSize: 12, color: "white", fontWeight: 500 }}>Private</span>
        </div>
      )}
      {showHostControls && !isHost && (
        <div style={{ position: "absolute", top: 15, left: 15 }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{
              background: "rgba(0,0,0,0.7)",
              border: "none",
              color: "white",
              padding: "8px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 16
            }}
          >
            ⋮
          </button>
          {showMenu && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 5,
              background: "white",
              borderRadius: 8,
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              minWidth: 150,
              zIndex: 10
            }}>
              {!isPrivateCallActive ? (
                <button
                  onClick={() => {
                    onStartPrivateCall();
                    setShowMenu(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 15px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#333",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                  onMouseOver={(e) => e.target.style.background = "#f0f0f0"}
                  onMouseOut={(e) => e.target.style.background = "transparent"}
                >
                  <span>🔒</span>
                  <span>Talk Privately</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    onEndPrivateCall();
                    setShowMenu(false);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px 15px",
                    background: "transparent",
                    border: "none",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 14,
                    color: "#e74c3c",
                    display: "flex",
                    alignItems: "center",
                    gap: 8
                  }}
                  onMouseOver={(e) => e.target.style.background = "#f0f0f0"}
                  onMouseOut={(e) => e.target.style.background = "transparent"}
                >
                  <span>🔓</span>
                  <span>End Private Call</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div style={{ 
        position: "absolute", 
        bottom: 15, 
        left: 15, 
        background: "rgba(0,0,0,0.7)", 
        padding: "8px 15px", 
        borderRadius: 8,
        color: "white",
        fontSize: 14,
        fontWeight: 500,
        display: "flex",
        alignItems: "center",
        gap: 8
      }}>
        <span>{userName}</span>
        {isHost && <span>👑</span>}
      </div>
    </div>
  );
}
