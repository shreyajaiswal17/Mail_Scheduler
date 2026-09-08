import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Mail,
  ShieldCheck,
  Zap,
  Bell,
  CheckCircle,
  HelpCircle,
  AlertCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";

export const LoginPage: React.FC = () => {
  const { loginWithGoogle, error, clearError } = useAuth();
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  return (
    <div className="login-container">
      {/* Top Banner / Navigation */}
      <header className="login-header">
        <div className="brand-logo">
          <div className="logo-icon-wrapper">
            <Mail className="logo-icon" size={22} />
          </div>
          <div className="brand-text">
            <span className="brand-title">MailFlow</span>
            <span className="brand-badge">PRO</span>
          </div>
        </div>
        <div className="header-status">
          <span className="status-dot"></span>
          <span>Backend API Connected (Port 5000)</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="login-main">
        <div className="login-grid">
          {/* Left Column: Hero & Value Proposition */}
          <div className="hero-section">
            <div className="hero-pill">
              <Zap size={14} className="pill-icon" />
              <span>Smart Email Dispatch Engine</span>
            </div>
            <h1 className="hero-title">
              Automated cold outreach with <span className="gradient-text">guaranteed deliverability.</span>
            </h1>
            <p className="hero-subtitle">
              Schedule thousands of personalized emails with BullMQ queueing, randomized jitter delays, and real-time Slack delivery notifications.
            </p>

            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h4>Account Safety & Rate Limiting</h4>
                  <p>Stagger email dispatches with configurable hourly limits per sender account.</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon">
                  <Zap size={18} />
                </div>
                <div>
                  <h4>BullMQ + Redis Job Queue</h4>
                  <p>Robust background job processing with automatic retries and failure logging.</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon">
                  <Bell size={18} />
                </div>
                <div>
                  <h4>Slack Webhook Alerts</h4>
                  <p>Receive real-time alerts directly into your team channel on campaign completion.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Google OAuth Card */}
          <div className="auth-card-container">
            <div className="auth-card">
              <div className="card-header">
                <div className="auth-icon-circle">
                  <Mail size={28} className="auth-icon" />
                </div>
                <h2>Welcome Back</h2>
                <p>Sign in using your Google account to access your sender dashboard and campaigns.</p>
              </div>

              {error && (
                <div className="auth-error-banner">
                  <AlertCircle size={18} className="error-icon" />
                  <div className="error-text">
                    <strong>Authentication Notice</strong>
                    <p>{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearError}
                    className="error-dismiss-btn"
                    title="Dismiss notice"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="auth-action-box">
                {/* Official Google Button */}
                <button
                  id="google-login-btn"
                  className="google-btn"
                  onClick={loginWithGoogle}
                >
                  <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3.03h3.88c2.27-2.09 3.665-5.17 3.665-9.12z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.03c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.24v3.13C3.26 21.41 7.33 24 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.29c-.25-.72-.38-1.49-.38-2.29s.13-1.57.38-2.29V6.57H1.24C.45 8.14 0 9.97 0 12s.45 3.86 1.24 5.43l4.04-3.14z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.59 1.24 6.57l4.04 3.14c.95-2.83 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                <div className="flow-steps">
                  <div className="flow-step">
                    <CheckCircle size={14} className="flow-check" />
                    <span>Instant Google consent screen</span>
                  </div>
                  <div className="flow-step">
                    <CheckCircle size={14} className="flow-check" />
                    <span>Auto-sync with PostgreSQL database</span>
                  </div>
                  <div className="flow-step">
                    <CheckCircle size={14} className="flow-check" />
                    <span>Secure JWT session cookie</span>
                  </div>
                </div>
              </div>

              {/* Setup Guide Accordion */}
              <div className="setup-guide-box">
                <button
                  type="button"
                  className="setup-guide-toggle"
                  onClick={() => setShowSetupGuide(!showSetupGuide)}
                >
                  <div className="guide-title">
                    <HelpCircle size={16} />
                    <span>Configuring Google OAuth credentials?</span>
                  </div>
                  {showSetupGuide ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showSetupGuide && (
                  <div className="setup-guide-content">
                    <p className="guide-intro">
                      To complete setup, ensure these values are populated in <code>backend/.env</code>:
                    </p>
                    <div className="guide-code-block">
                      <code>GOOGLE_CLIENT_ID=your_client_id</code>
                      <code>GOOGLE_CLIENT_SECRET=your_secret</code>
                      <code>GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback</code>
                    </div>
                    <div className="guide-hint">
                      <span>In Google Cloud Console, ensure Authorized Redirect URI is:</span>
                      <strong>http://localhost:5000/api/auth/google/callback</strong>
                    </div>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="guide-link"
                    >
                      <span>Open Google Cloud Console</span>
                      <ExternalLink size={13} />
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
