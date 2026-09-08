import React, { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { Mail } from "lucide-react";
import "./App.css";

const MainContent: React.FC = () => {
  const { user, isLoading } = useAuth();
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white text-gray-600">
        <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-white mb-2 shadow-sm">
          <Mail size={24} />
        </div>
        <div className="w-7 h-7 border-2 border-gray-200 border-t-emerald-500 rounded-full animate-spin"></div>
        <p className="text-sm font-medium text-gray-500">Verifying secure session...</p>
      </div>
    );
  }

  if (currentPath === "/dashboard" && user) {
    return <DashboardPage />;
  }

  return <LoginPage />;
};

export default function App() {
  return (
    <AuthProvider>
      <MainContent />
    </AuthProvider>
  );
}
