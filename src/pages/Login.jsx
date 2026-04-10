import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const fontUi =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const inputShell = (focused) => ({
  display: "flex",
  alignItems: "center",
  gap: 10,
  borderRadius: 12,
  border: focused ? "2px solid #667eea" : "2px solid #e2e6ef",
  background: "#f8f9fc",
  padding: "4px 4px 4px 14px",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
  boxShadow: focused ? "0 0 0 4px rgba(102, 126, 234, 0.18)" : "none"
});

const inputInner = {
  flex: 1,
  minWidth: 0,
  border: "none",
  background: "transparent",
  padding: "12px 8px 12px 0",
  fontSize: 16,
  fontFamily: fontUi,
  outline: "none",
  color: "#1a252f"
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusField, setFocusField] = useState(null);
  const [btnHover, setBtnHover] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Invalid email or password");
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      navigate("/");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const linkBase = {
    color: "#667eea",
    fontWeight: 600,
    textDecoration: "none",
    borderBottom: "2px solid transparent",
    transition: "border-color 0.2s ease, color 0.2s ease"
  };

  const linkHover = (e, enter) => {
    if (enter) {
      e.currentTarget.style.borderBottomColor = "#667eea";
      e.currentTarget.style.color = "#5a67d8";
    } else {
      e.currentTarget.style.borderBottomColor = "transparent";
      e.currentTarget.style.color = "#667eea";
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        fontFamily: fontUi,
        background: "linear-gradient(145deg, #667eea 0%, #764ba2 45%, #5b21b6 100%)",
        position: "relative",
        overflow: "auto"
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(255,255,255,0.25), transparent 55%)",
          pointerEvents: "none"
        }}
      />

      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          background: "rgba(255, 255, 255, 0.97)",
          boxShadow:
            "0 4px 6px rgba(0,0,0,0.07), 0 24px 48px rgba(0,0,0,0.18), 0 0 0 1px rgba(255,255,255,0.5) inset",
          padding: "40px 36px 36px",
          animation: "adminLoginIn 0.45s ease-out"
        }}
      >
        <style>
          {`
            @keyframes adminLoginIn {
              from { opacity: 0; transform: translateY(12px) scale(0.98); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}
        </style>

        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 26,
            marginBottom: 20,
            boxShadow: "0 8px 20px rgba(102, 126, 234, 0.4)"
          }}
        >
          🛡️
        </div>

        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: 26,
            fontWeight: 700,
            color: "#1a252f",
            letterSpacing: "-0.03em"
          }}
        >
          Login
        </h1>
        <p style={{ margin: "0 0 28px 0", fontSize: 15, color: "#5c6578", lineHeight: 1.5 }}>
          Host sign-in — manage meetings, clients, and live sessions.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <label
            htmlFor="admin-login-email"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "#3d4a5c",
              marginBottom: 8
            }}
          >
            Email
          </label>
          <div style={{ ...inputShell(focusField === "email"), marginBottom: 18 }}>
            <span style={{ fontSize: 18, opacity: 0.55, userSelect: "none" }} aria-hidden>
              ✉️
            </span>
            <input
              id="admin-login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusField("email")}
              onBlur={() => setFocusField((f) => (f === "email" ? null : f))}
              style={inputInner}
              autoComplete="username"
              required
              disabled={loading}
            />
          </div>

          <label
            htmlFor="admin-login-password"
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "#3d4a5c",
              marginBottom: 8
            }}
          >
            Password
          </label>
          <div style={{ ...inputShell(focusField === "pw"), marginBottom: 20 }}>
            <span style={{ fontSize: 18, opacity: 0.55, userSelect: "none" }} aria-hidden>
              🔑
            </span>
            <input
              id="admin-login-password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocusField("pw")}
              onBlur={() => setFocusField((f) => (f === "pw" ? null : f))}
              style={inputInner}
              autoComplete="current-password"
              required
              disabled={loading}
            />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowPassword((s) => !s)}
              disabled={loading}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
                flexShrink: 0,
                marginRight: 6,
                padding: "8px 10px",
                border: "none",
                borderRadius: 8,
                background: showPassword ? "rgba(102, 126, 234, 0.15)" : "transparent",
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: 18,
                lineHeight: 1,
                transition: "background 0.2s ease, transform 0.15s ease",
                opacity: loading ? 0.5 : 1
              }}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.background = "rgba(102, 126, 234, 0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = showPassword
                  ? "rgba(102, 126, 234, 0.15)"
                  : "transparent";
              }}
            >
              {showPassword ? "🙈" : "👁"}
            </button>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 18,
                padding: "12px 14px",
                borderRadius: 10,
                background: "linear-gradient(180deg, #fdecea 0%, #fad7d4 100%)",
                border: "1px solid #f5c2c0",
                color: "#842029",
                fontSize: 14,
                lineHeight: 1.45,
                animation: "adminLoginIn 0.25s ease-out"
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            onMouseEnter={() => !loading && setBtnHover(true)}
            onMouseLeave={() => setBtnHover(false)}
            style={{
              width: "100%",
              padding: "14px 20px",
              border: "none",
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 600,
              fontFamily: fontUi,
              cursor: loading ? "not-allowed" : "pointer",
              color: "white",
              backgroundImage: loading
                ? undefined
                : btnHover
                  ? "linear-gradient(180deg, #5a6fd6 0%, #4c5fd5 100%)"
                  : "linear-gradient(180deg, #667eea 0%, #5a67d8 100%)",
              backgroundColor: loading ? "#7c8fd9" : undefined,
              boxShadow: loading
                ? "none"
                : btnHover
                  ? "0 6px 20px rgba(102, 126, 234, 0.45)"
                  : "0 4px 14px rgba(102, 126, 234, 0.35)",
              transform: btnHover && !loading ? "translateY(-1px)" : "none",
              transition: "transform 0.15s ease, box-shadow 0.2s ease, filter 0.2s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10
            }}
          >
            {loading && (
              <span
                style={{
                  width: 18,
                  height: 18,
                  border: "2px solid rgba(255,255,255,0.35)",
                  borderTopColor: "white",
                  borderRadius: "50%",
                  animation: "spin 0.7s linear infinite"
                }}
                aria-hidden
              />
            )}
            {loading ? "Signing in…" : "Login"}
          </button>
        </form>

        <p
          style={{
            margin: "24px 0 0 0",
            textAlign: "center",
            fontSize: 14,
            color: "#6b7280"
          }}
        >
          Don&apos;t have an account?{" "}
          <Link
            to="/register"
            style={linkBase}
            onMouseEnter={(e) => linkHover(e, true)}
            onMouseLeave={(e) => linkHover(e, false)}
          >
            Register
          </Link>
        </p>
        <p
          style={{
            margin: "14px 0 0 0",
            textAlign: "center",
            fontSize: 14,
            color: "#6b7280",
            lineHeight: 1.5
          }}
        >
          <Link
            to="/client/login"
            style={linkBase}
            onMouseEnter={(e) => linkHover(e, true)}
            onMouseLeave={(e) => linkHover(e, false)}
          >
            Client login
          </Link>
          <span style={{ color: "#9ca3af" }}> — meetings from your host</span>
        </p>
      </div>
    </div>
  );
}
