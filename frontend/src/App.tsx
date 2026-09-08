import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { Mail } from "lucide-react";
import "./App.css";

const MainContent: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="logo-icon-wrapper" style={{ width: 48, height: 48, marginBottom: 8 }}>
          <Mail size={26} />
        </div>
        <div className="loading-spinner"></div>
        <p>Verifying secure session...</p>
      </div>
    );
  }

  return user ? <DashboardPage /> : <LoginPage />;
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
