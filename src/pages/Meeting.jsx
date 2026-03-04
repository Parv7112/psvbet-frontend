import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import io from "socket.io-client";
import Peer from "peerjs";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';
const socket = io(API_BASE_URL);

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
  const [isHost, setIsHost] = useState(false);
  const [userId, setUserId] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [privateCallActive, setPrivateCallActive] = useState(null); // peerId of private call
  const [showPrivateMenu, setShowPrivateMenu] = useState(null); // peerId to show menu for
  
  const localVideoRef = useRef();
  const peerInstance = useRef(null);
  const activeCalls = useRef(new Set());
  const isInitialized = useRef(false);
  const audioContext = useRef(null);
  const localAnalyser = useRef(null);
  const privateAudioStream = useRef(null);

  useEffect(() => {
    fetchMeetingInfo();
    checkUserAuth();

    return () => {
      console.log("Cleaning up...");
      isInitialized.current = false;
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      if (peerInstance.current) {
        peerInstance.current.destroy();
      }
      if (audioContext.current) {
        audioContext.current.close();
      }
      if (privateAudioStream.current) {
        privateAudioStream.current.getTracks().forEach(track => track.stop());
      }
      socket.emit("leave-meeting", { roomId });
      socket.off("user-joined");
      socket.off("user-left");
      socket.off("private-call-request");
      socket.off("private-call-ended");
    };
  }, []);

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
    const guestName = sessionStorage.getItem("guestName");
    
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
    } else if (guestName) {
      setUserName(guestName);
      initializeMedia(guestName, null, false);
    } else {
      setShowNamePrompt(true);
    }
  };

  const handleJoinAsGuest = () => {
    if (tempName.trim()) {
      sessionStorage.setItem("guestName", tempName);
      setUserName(tempName);
      setShowNamePrompt(false);
      initializeMedia(tempName, null, false);
    }
  };

  const fetchMeetingInfo = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/meeting/${roomId}`);
      const data = await response.json();
      setMeetingInfo(data);
    } catch (error) {
      console.error("Failed to fetch meeting info");
    }
  };

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
      const peer = new Peer(undefined, {
        host: API_BASE_URL.replace('http://', '').replace('https://', ''),
        port: 5000,
        path: '/peerjs',
        secure: false,
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
        socket.emit("join-meeting", { 
          roomId, 
          userName: name, 
          peerId: id,
          userId: uid 
        });
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
        
        call.on('stream', (remoteStream) => {
          console.log('Received stream from:', peerId, remoteIsHost ? '(HOST)' : '(PARTICIPANT)');
          setRemoteStreams(prev => ({
            ...prev,
            [peerId]: { stream: remoteStream, userName: remoteUserName, isHost: remoteIsHost }
          }));
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
    sessionStorage.removeItem("guestName");
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/live");
    } else {
      navigate("/login");
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
          
          <label style={{ display: "block", marginBottom: 8, color: "#333", fontWeight: 500 }}>
            What's your name?
          </label>
          <input
            type="text"
            placeholder="Enter your name"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleJoinAsGuest()}
            style={{
              width: "100%",
              padding: 12,
              border: "2px solid #e0e0e0",
              borderRadius: 8,
              fontSize: 16,
              marginBottom: 20,
              boxSizing: "border-box"
            }}
            autoFocus
          />
          
          <button
            onClick={handleJoinAsGuest}
            disabled={!tempName.trim()}
            style={{
              width: "100%",
              padding: 12,
              background: tempName.trim() ? "#667eea" : "#ccc",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 500,
              cursor: tempName.trim() ? "pointer" : "not-allowed",
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
