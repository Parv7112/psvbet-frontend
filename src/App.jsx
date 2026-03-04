import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Live from "./pages/Live";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Meeting from "./pages/Meeting";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");
  return token ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/live" element={
          <ProtectedRoute>
            <Live />
          </ProtectedRoute>
        } />
        <Route path="/meeting/:roomId" element={<Meeting />} />
        <Route path="/" element={<Navigate to="/live" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;