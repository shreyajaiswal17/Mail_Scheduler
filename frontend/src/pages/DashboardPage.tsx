import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Mail,
  LogOut,
  CheckCircle2,
  Clock,
  Send,
  Users,
  Shield,
  ArrowRight,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Server,
  KeyRound,
} from "lucide-react";
import { ComposeEmailModal } from "../components/ComposeEmailModal";

interface Sender {
  id: string;
  email: string;
  name: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  isActive: boolean;
  createdAt: string;
}

export const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [dbStatus, setDbStatus] = useState<string>("checking...");
  const [isCheckingDb, setIsCheckingDb] = useState(false);

  // Senders state
  const [senders, setSenders] = useState<Sender[]>([]);
  const [isLoadingSenders, setIsLoadingSenders] = useState(true);

  // Modal & form state (transient only — never stored in persistent storage)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    smtpHost: "smtp.ethereal.email",
    smtpPort: "587",
    smtpUser: "",
    smtpPassword: "",
  });

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const checkDb = async () => {
    setIsCheckingDb(true);
    try {
      const res = await fetch("http://localhost:5000/health/db");
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data.database === "connected" ? "Connected" : "Disconnected");
      } else {
        setDbStatus("Disconnected");
      }
    } catch {
      setDbStatus("Unreachable");
    } finally {
      setIsCheckingDb(false);
    }
  };

  const fetchSenders = useCallback(async () => {
    setIsLoadingSenders(true);
    try {
      const res = await fetch("http://localhost:5000/api/senders", {
        headers: getAuthHeaders(),
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        setSenders(data.senders || []);
      }
    } catch (error) {
      console.error("Failed to load senders:", error);
    } finally {
      setIsLoadingSenders(false);
    }
  }, []);

  useEffect(() => {
    checkDb();
    fetchSenders();
  }, [fetchSenders]);

  const handleOpenModal = (prefillEmail?: string, prefillName?: string) => {
    setFormData({
      name: prefillName || user?.name || "",
      email: prefillEmail || "",
      smtpHost: "smtp.ethereal.email",
      smtpPort: "587",
      smtpUser: prefillEmail || "",
      smtpPassword: "",
    });
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    if (isSubmitting) return;
    // Wipe transient state
    setFormData({
      name: "",
      email: "",
      smtpHost: "smtp.ethereal.email",
      smtpPort: "587",
      smtpUser: "",
      smtpPassword: "",
    });
    setSubmitError(null);
    setSubmitSuccess(null);
    setIsModalOpen(false);
  };

  const handleAddSenderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      const res = await fetch("http://localhost:5000/api/senders", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          name: formData.name.trim() || undefined,
          email: formData.email.trim(),
          smtpHost: formData.smtpHost.trim(),
          smtpPort: Number(formData.smtpPort),
          smtpUser: formData.smtpUser.trim(),
          smtpPassword: formData.smtpPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.message || "Failed to configure sender. Check your SMTP credentials."
        );
      }

      setSubmitSuccess("Sender configured and SMTP verified successfully!");

      // Clear password and form
      setFormData({
        name: "",
        email: "",
        smtpHost: "smtp.ethereal.email",
        smtpPort: "587",
        smtpUser: "",
        smtpPassword: "",
      });

      // Refresh list
      await fetchSenders();

      // Automatically close modal on success
      setTimeout(() => {
        setIsModalOpen(false);
        setSubmitSuccess(null);
      }, 1200);
    } catch (err: any) {
      setSubmitError(err.message || "Unable to configure sender. Check your SMTP credentials.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Senders metrics calculation
  const activeSenders = senders.filter((s) => s.isActive && s.smtpHost);
  const activeCount = activeSenders.length;

  return (
    <div className="dashboard-container">
      {/* Top Navbar */}
      <header className="dashboard-navbar">
        <div className="navbar-left">
          <div className="brand-logo">
            <div className="logo-icon-wrapper">
              <Mail className="logo-icon" size={20} />
            </div>
            <div className="brand-text">
              <span className="brand-title">MailFlow</span>
              <span className="brand-badge">Console</span>
            </div>
          </div>
        </div>

        <div className="navbar-right">
          {/* User Profile Pill */}
          <div className="user-profile-badge">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="user-avatar-img"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = "none";
                }}
              />
            ) : (
              <div className="user-avatar-fallback">
                {user?.name ? user.name.charAt(0).toUpperCase() : "U"}
              </div>
            )}
            <div className="user-profile-info">
              <span className="user-profile-name">{user?.name || "Authenticated User"}</span>
              <span className="user-profile-email">{user?.email}</span>
            </div>
          </div>

          <button
            id="nav-compose-btn"
            onClick={() => setIsComposeOpen(true)}
            className="nav-compose-btn"
            title="Compose New Email"
          >
            <Send size={14} />
            <span>Compose</span>
          </button>

          <button id="logout-btn" onClick={logout} className="logout-btn" title="Sign out">
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </header>

      {/* Main Dashboard Layout */}
      <main className="dashboard-content">
        {/* Welcome Banner */}
        <section className="welcome-banner">
          <div className="welcome-text">
            <div className="welcome-pill">
              <Sparkles size={14} className="sparkle-icon" />
              <span>OAuth 2.0 Handshake Complete</span>
            </div>
            <h1>
              Welcome back, <span className="gradient-text">{user?.name || "User"}</span>!
            </h1>
            <p>
              Your Google credentials have been verified and your profile is securely synchronized with PostgreSQL.
              Configure an SMTP sender below to begin scheduling automated emails.
            </p>
          </div>

          <div className="auth-verification-card">
            <div className="verification-header">
              <CheckCircle2 size={20} className="check-icon" />
              <div>
                <h3>Database State: Verified</h3>
                <p>Saved in PostgreSQL <code>User</code> table</p>
              </div>
            </div>
            <div className="verification-details">
              <div className="detail-row">
                <span className="detail-label">Database ID</span>
                <span className="detail-val mono-text">{user?.id}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Google Sub ID</span>
                <span className="detail-val mono-text">{user?.googleId}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Auth Provider</span>
                <span className="detail-val badge-provider">Google OAuth 2.0</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">PostgreSQL</span>
                <div className="db-badge-container">
                  <span
                    className={`status-pill ${
                      dbStatus === "Connected" ? "status-online" : "status-offline"
                    }`}
                  >
                    {dbStatus}
                  </span>
                  <button
                    onClick={checkDb}
                    className="icon-btn-tiny"
                    disabled={isCheckingDb}
                    title="Refresh DB status"
                  >
                    <RefreshCw size={12} className={isCheckingDb ? "spin" : ""} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Analytics & Metrics Grid */}
        <section className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-title">Active Senders</span>
              <div className="stat-icon-wrapper purple">
                <Users size={18} />
              </div>
            </div>
            <div className="stat-value">{activeCount}</div>
            <div className="stat-subtext">
              {activeCount > 0 ? (
                <span className="highlight-text">{activeCount} configured with SMTP</span>
              ) : (
                <span>No active SMTP senders</span>
              )}
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-title">Queued Emails</span>
              <div className="stat-icon-wrapper cyan">
                <Clock size={18} />
              </div>
            </div>
            <div className="stat-value">0</div>
            <div className="stat-subtext">BullMQ queue idle</div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-title">Sent Today</span>
              <div className="stat-icon-wrapper emerald">
                <Send size={18} />
              </div>
            </div>
            <div className="stat-value">0</div>
            <div className="stat-subtext">Ready for first campaign</div>
          </div>

          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-title">SMTP Transport</span>
              <div className="stat-icon-wrapper blue">
                <Shield size={18} />
              </div>
            </div>
            <div className="stat-value">{activeCount > 0 ? "Ready" : "Pending"}</div>
            <div className="stat-subtext">
              {activeCount > 0 ? "Verified SMTP credentials" : "SMTP configuration required"}
            </div>
          </div>
        </section>

        {/* Sender & Pipeline Section */}
        <section className="pipeline-section">
          <div className="section-header">
            <div>
              <h2>Configured Senders</h2>
              <p>Email accounts linked with verified SMTP credentials for dispatch</p>
            </div>
            <div className="section-header-actions">
              <button
                id="add-sender-btn"
                className="secondary-action-btn"
                onClick={() => handleOpenModal()}
              >
                <Plus size={16} />
                <span>Add Sender</span>
              </button>
              <button
                id="compose-email-btn"
                className="primary-action-btn"
                onClick={() => setIsComposeOpen(true)}
              >
                <Send size={16} />
                <span>Compose New Email</span>
              </button>
            </div>
          </div>

          <div className="sender-table-wrapper">
            {isLoadingSenders ? (
              <div className="table-loading-container">
                <Loader2 size={24} className="spin" />
                <span>Loading configured senders...</span>
              </div>
            ) : (
              <table className="sender-table">
                <thead>
                  <tr>
                    <th>Sender Name</th>
                    <th>Email Address</th>
                    <th>SMTP Host</th>
                    <th>Status</th>
                    <th>Rate Limit</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {senders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="empty-table-cell">
                        <div className="empty-state-box">
                          <Mail size={32} className="empty-state-icon" />
                          <h4>No Senders Configured</h4>
                          <p>
                            Configure an Ethereal or custom SMTP account to send automated emails.
                          </p>
                          <button
                            className="secondary-action-btn"
                            onClick={() => handleOpenModal()}
                          >
                            <Plus size={15} />
                            <span>Add Sender Now</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    senders.map((s) => {
                      const isConfigured = s.isActive && Boolean(s.smtpHost);

                      return (
                        <tr key={s.id}>
                          <td className="sender-cell-name">
                            <div className="table-avatar">
                              {s.name ? s.name.charAt(0).toUpperCase() : s.email.charAt(0).toUpperCase()}
                            </div>
                            <span>{s.name || "Default Sender"}</span>
                          </td>
                          <td className="mono-text">{s.email}</td>
                          <td className="mono-text">
                            {s.smtpHost ? `${s.smtpHost}:${s.smtpPort || 587}` : "Not Configured"}
                          </td>
                          <td>
                            {isConfigured ? (
                              <span className="badge-active">
                                <CheckCircle2 size={12} /> Active
                              </span>
                            ) : (
                              <span className="badge-unconfigured">
                                <AlertTriangle size={12} /> Unconfigured
                              </span>
                            )}
                          </td>
                          <td>{isConfigured ? "50 emails / hr" : "—"}</td>
                          <td>
                            {isConfigured ? (
                              <button className="link-action-btn" onClick={() => handleOpenModal(s.email, s.name || "")}>
                                <span>Reconfigure</span>
                                <ArrowRight size={13} />
                              </button>
                            ) : (
                              <button
                                className="action-btn-pill"
                                onClick={() => handleOpenModal(s.email, s.name || "")}
                              >
                                <span>Configure SMTP</span>
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>

      {/* Add / Configure Sender Modal */}
      {isModalOpen && (
        <div className="modal-backdrop animate-fade-in" onClick={handleCloseModal}>
          <div
            className="modal-container"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="modal-icon-badge">
                  <Server size={18} />
                </div>
                <div>
                  <h3 id="modal-title">Configure SMTP Sender</h3>
                  <p>Credentials will be verified via SMTP before saving</p>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={handleCloseModal}
                disabled={isSubmitting}
                title="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSenderSubmit} className="modal-form">
              {submitError && (
                <div className="modal-alert-error">
                  <AlertCircle size={18} className="alert-icon" />
                  <div className="alert-text">
                    <strong>SMTP Verification Failed</strong>
                    <p>{submitError}</p>
                  </div>
                </div>
              )}

              {submitSuccess && (
                <div className="modal-alert-success">
                  <CheckCircle2 size={18} className="alert-icon" />
                  <div className="alert-text">
                    <strong>Success</strong>
                    <p>{submitSuccess}</p>
                  </div>
                </div>
              )}

              <div className="modal-info-box">
                <KeyRound size={16} />
                <span>
                  Passwords are encrypted with AES-256-GCM on the backend and are never stored in your browser storage.
                </span>
              </div>

              <div className="form-group">
                <label htmlFor="sender-name" className="form-label">
                  Sender Display Name
                </label>
                <input
                  id="sender-name"
                  type="text"
                  placeholder="e.g. Outreach Team"
                  className="form-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-group">
                <label htmlFor="sender-email" className="form-label">
                  Sender Email Address <span className="required-star">*</span>
                </label>
                <input
                  id="sender-email"
                  type="email"
                  required
                  placeholder="e.g. test@ethereal.email"
                  className="form-input"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label htmlFor="smtp-host" className="form-label">
                    SMTP Host <span className="required-star">*</span>
                  </label>
                  <input
                    id="smtp-host"
                    type="text"
                    required
                    placeholder="smtp.ethereal.email"
                    className="form-input"
                    value={formData.smtpHost}
                    onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                    disabled={isSubmitting}
                  />
                </div>

                <div className="form-group flex-1">
                  <label htmlFor="smtp-port" className="form-label">
                    Port <span className="required-star">*</span>
                  </label>
                  <input
                    id="smtp-port"
                    type="number"
                    required
                    placeholder="587"
                    className="form-input"
                    value={formData.smtpPort}
                    onChange={(e) => setFormData({ ...formData, smtpPort: e.target.value })}
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="smtp-user" className="form-label">
                  SMTP Username <span className="required-star">*</span>
                </label>
                <input
                  id="smtp-user"
                  type="text"
                  required
                  placeholder="Ethereal or SMTP username"
                  className="form-input"
                  value={formData.smtpUser}
                  onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                  disabled={isSubmitting}
                  autoComplete="username"
                />
              </div>

              <div className="form-group">
                <label htmlFor="smtp-password" className="form-label">
                  SMTP Password <span className="required-star">*</span>
                </label>
                <input
                  id="smtp-password"
                  type="password"
                  required
                  placeholder="••••••••••••••••"
                  className="form-input"
                  value={formData.smtpPassword}
                  onChange={(e) => setFormData({ ...formData, smtpPassword: e.target.value })}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                />
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={handleCloseModal}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="btn-submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Verifying SMTP...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Verify & Save Sender</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Compose & Schedule Email Modal */}
      <ComposeEmailModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        senders={senders}
        onScheduledSuccess={fetchSenders}
      />
    </div>
  );
};
