import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatar?: string | null;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  loginWithGoogle: () => void;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE_URL = "http://localhost:5000";

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const checkAuth = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Check URL parameters for token or error from OAuth redirect
      const urlParams = new URLSearchParams(window.location.search);
      const tokenFromUrl = urlParams.get("token");
      const errorFromUrl = urlParams.get("error");

      if (errorFromUrl) {
        setError(decodeURIComponent(errorFromUrl));
      }

      if (tokenFromUrl || errorFromUrl) {
        if (tokenFromUrl) {
          localStorage.setItem("auth_token", tokenFromUrl);
        }
        // Clean URL parameters cleanly so refresh doesn't keep old error/token
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }

      const token = localStorage.getItem("auth_token");

      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
        if (response.status === 401 && token) {
          localStorage.removeItem("auth_token");
        }
      }
    } catch (err: any) {
      console.error("Auth check failed:", err);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const loginWithGoogle = () => {
    // Redirect browser to backend Google OAuth initiation endpoint
    window.location.href = `${API_BASE_URL}/api/auth/google`;
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch (err) {
      console.error("Logout request error:", err);
    } finally {
      localStorage.removeItem("auth_token");
      setUser(null);
      window.location.href = "/";
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        error,
        loginWithGoogle,
        logout,
        checkAuth,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
