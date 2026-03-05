import { useEffect, useState } from "react";
import socket from "../socket";

export default function LiveOddsCard() {
  const [matches, setMatches] = useState([]);

  useEffect(() => {
    socket.on("odds_update", (data) => {
      setMatches(data.matches || []);
    });

    return () => socket.off("odds_update");
  }, []);

  return (
    <div style={{ padding: 20 }}>
      {matches.map((match, index) => (
        <div
          key={index}
          style={{
            background: "#1e293b",
            color: "white",
            padding: 15,
            borderRadius: 10,
            marginBottom: 15,
          }}
        >
          <h3>{match.teamA} vs {match.teamB}</h3>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            {match.odds?.map((odd, i) => (
              <button
                key={i}
                style={{
                  background: i === 0 ? "#3498db" : "#e74c3c",
                  color: "white",
                  padding: "10px 20px",
                  border: "none",
                  borderRadius: 5,
                  cursor: "pointer",
                  fontSize: 14
                }}
              >
                {odd.name}: {odd.price}
              </button>
            ))}
          </div>

          {match.bookmaker && (
            <p style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
              Bookmaker: {match.bookmaker}
            </p>
          )}

          {match.session && <p>Session 6 Over: {match.session}</p>}
          {match.lambi && <p>Lambi 20 Over: {match.lambi}</p>}
        </div>
      ))}
    </div>
  );
}