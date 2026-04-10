import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function MeetingRecordings() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const token = useMemo(() => localStorage.getItem("token"), []);

  const fetchAll = async () => {
    setError("");
    setLoading(true);
    try {
      const [mRes, rRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/meeting/${roomId}`),
        fetch(`${API_BASE_URL}/api/meeting/${roomId}/recordings`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      if (!mRes.ok) throw new Error("Failed to load meeting");
      const m = await mRes.json();
      setMeeting(m);

      if (!rRes.ok) {
        const body = await rRes.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load recordings (host only)");
      }
      const r = await rRes.json();
      setRecordings(r.recordings || []);
    } catch (e) {
      setError(e?.message || "Failed to load recordings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const transcribe = async (recordingId) => {
    setError("");
    setBusyId(recordingId);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/meeting/${roomId}/recordings/${recordingId}/transcribe`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Transcription failed");
      }
      await fetchAll();
    } catch (e) {
      setError(e?.message || "Transcription failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
        padding: 30,
        boxSizing: "border-box"
      }}
    >
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          background: "rgba(255,255,255,0.95)",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid rgba(0,0,0,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#2c3e50" }}>
              Recordings
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#7f8c8d" }}>
              {meeting?.title || "Meeting"} • Room:{" "}
              <span style={{ fontFamily: "monospace" }}>{roomId}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => window.open(`/meeting/${roomId}`, "_blank", "noopener,noreferrer")}
              style={{
                padding: "10px 14px",
                background: "#9b59b6",
                border: "none",
                borderRadius: 10,
                color: "white",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13
              }}
              title="Open meeting in new tab"
            >
              Open Meeting
            </button>
            <button
              onClick={() => navigate("/")}
              style={{
                padding: "10px 14px",
                background: "rgba(0,0,0,0.08)",
                border: "1px solid rgba(0,0,0,0.1)",
                borderRadius: 10,
                color: "#2c3e50",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: 13
              }}
            >
              Back
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              margin: 16,
              padding: 12,
              background: "#fee",
              border: "1px solid #fcc",
              borderRadius: 12,
              color: "#c33",
              fontSize: 13
            }}
          >
            {error}
          </div>
        )}

        <div style={{ padding: 18 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#7f8c8d" }}>
              Loading...
            </div>
          ) : recordings.length === 0 ? (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "#7f8c8d",
                background: "white",
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.06)"
              }}
            >
              No recordings found for this meeting yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              {["client", "host"].flatMap((kind) => {
                const filtered = recordings.filter((rec) =>
                  kind === "client"
                    ? rec.recordingSource === "client"
                    : rec.recordingSource !== "client"
                );
                if (filtered.length === 0) return [];
                const label =
                  kind === "client" ? "Client mic segments" : "Host recordings";
                return [
                  <div key={`h-${kind}`} style={{ marginTop: 6, marginBottom: 4 }}>
                    <div
                      style={{
                        fontSize: 15,
                        fontWeight: 800,
                        color: "#2c3e50",
                        marginBottom: 10
                      }}
                    >
                      {label}{" "}
                      <span style={{ fontWeight: 600, color: "#7f8c8d" }}>
                        ({filtered.length})
                      </span>
                    </div>
                    <div style={{ display: "grid", gap: 14 }}>
                      {filtered
                        .slice()
                        .sort(
                          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
                        )
                        .map((r) => (
                  <div
                    key={r._id}
                    style={{
                      padding: 16,
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.08)",
                      background: "white"
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                        flexWrap: "wrap"
                      }}
                    >
                      <div style={{ minWidth: 240 }}>
                        <div style={{ fontWeight: 800, color: "#2c3e50" }}>
                          Saved: {new Date(r.createdAt).toLocaleString()}
                        </div>
                        {r.segmentStartedAt && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 12,
                              color: "#7f8c8d"
                            }}
                          >
                            Mic on from:{" "}
                            {new Date(r.segmentStartedAt).toLocaleString()}
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: 12,
                            color: "#7f8c8d",
                            display: "flex",
                            gap: 10,
                            flexWrap: "wrap"
                          }}
                        >
                          <span>
                            {r.recordingSource === "client" ? (
                              <>
                                Client: <b>{r.byName || "—"}</b>
                                {r.clientLoginId && (
                                  <span style={{ fontFamily: "monospace" }}>
                                    {" "}
                                    ({r.clientLoginId})
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                By: <b>{r.byName || "Host"}</b>
                              </>
                            )}
                          </span>
                          <span>{formatBytes(r.sizeBytes)}</span>
                          {r.mimeType && <span>{r.mimeType}</span>}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <a
                          href={`${API_BASE_URL}/uploads/${r.relativePath}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: "10px 14px",
                            background: "#27ae60",
                            borderRadius: 10,
                            color: "white",
                            textDecoration: "none",
                            fontWeight: 800,
                            fontSize: 13
                          }}
                        >
                          Download
                        </a>
                        <button
                          onClick={() => transcribe(r._id)}
                          disabled={!!r.transcript?.text || busyId === r._id}
                          style={{
                            padding: "10px 14px",
                            background: r.transcript?.text
                              ? "rgba(39,174,96,0.15)"
                              : "#667eea",
                            border: r.transcript?.text
                              ? "1px solid rgba(39,174,96,0.35)"
                              : "none",
                            borderRadius: 10,
                            color: r.transcript?.text ? "#1f7a46" : "white",
                            cursor:
                              r.transcript?.text || busyId === r._id
                                ? "default"
                                : "pointer",
                            fontWeight: 800,
                            fontSize: 13,
                            opacity: busyId === r._id ? 0.7 : 1
                          }}
                          title={
                            r.transcript?.text
                              ? "Already transcribed"
                              : "Transcribe (needs OPENAI_API_KEY on backend)"
                          }
                        >
                          {busyId === r._id
                            ? "Working..."
                            : r.transcript?.text
                              ? "Transcribed"
                              : "Transcribe"}
                        </button>
                      </div>
                    </div>

                    {r.transcript?.text && (
                      <div
                        style={{
                          marginTop: 12,
                          padding: 14,
                          borderRadius: 12,
                          background: "rgba(102,126,234,0.07)",
                          border: "1px solid rgba(102,126,234,0.15)",
                          whiteSpace: "pre-wrap",
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: "#2c3e50"
                        }}
                      >
                        {r.transcript.text}
                      </div>
                    )}
                  </div>
                        ))}
                    </div>
                  </div>
                ];
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

