import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Live from "./pages/Live";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Meeting from "./pages/Meeting";
import MeetingRecordings from "./pages/MeetingRecordings";
import ClientLogin from "./pages/ClientLogin";
import ClientPortal from "./pages/ClientPortal";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" />;
}

function ClientProtectedRoute({ children }) {
  const token = localStorage.getItem("clientToken");
  return token ? children : <Navigate to="/client/login" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/client/login" element={<ClientLogin />} />
        <Route
          path="/client"
          element={
            <ClientProtectedRoute>
              <ClientPortal />
            </ClientProtectedRoute>
          }
        />
        <Route path="/" element={
          <ProtectedRoute>
            <Live />
          </ProtectedRoute>
        } />
        <Route path="/meeting/:roomId" element={<Meeting />} />
        <Route
          path="/meeting/:roomId/recordings"
          element={
            <ProtectedRoute>
              <MeetingRecordings />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;