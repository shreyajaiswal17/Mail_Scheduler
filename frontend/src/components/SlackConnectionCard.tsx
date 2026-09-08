import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Unlink,
  ExternalLink,
  ShieldCheck,
  Building2,
  Hash,
  Clock,
  X,
  Send,
  BellRing,
  Check,
} from "lucide-react";

interface SlackStatusResponse {
  connected: boolean;
  teamId?: string | null;
  teamName?: string | null;
  botUserId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  scope?: string | null;
  connectedAt?: string | null;
  updatedAt?: string | null;
}

interface SlackChannelItem {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
}

interface SlackConnectionCardProps {
  onStatusChange?: (status: SlackStatusResponse) => void;
}

const API_BASE_URL = "http://localhost:5000";

const SlackLogo: React.FC<{ size?: number }> = ({ size = 20 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 122.8 122.8"
    className="slack-svg-icon"
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <path
      d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
      fill="#E01E5A"
    />
    <path
      d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
      fill="#36C5F0"
    />
    <path
      d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C77.6 5.8 83.4 0 90.5 0s12.9 5.8 12.9 12.9v32.3z"
      fill="#2EB67D"
    />
    <path
      d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
      fill="#ECB22E"
    />
  </svg>
);

export const SlackConnectionCard: React.FC<SlackConnectionCardProps> = ({ onStatusChange }) => {
  const [status, setStatus] = useState<SlackStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isDisconnecting, setIsDisconnecting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Channels and Alerts State
  const [channels, setChannels] = useState<SlackChannelItem[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [customChannelInput, setCustomChannelInput] = useState<string>("");
  const [useCustomChannel, setUseCustomChannel] = useState<boolean>(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);
  const [isSavingChannel, setIsSavingChannel] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [channelSuccessMessage, setChannelSuccessMessage] = useState<string | null>(null);
  const [testNotificationMessage, setTestNotificationMessage] = useState<string | null>(null);

  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const fetchChannels = useCallback(async () => {
    try {
      setIsLoadingChannels(true);
      const res = await fetch(`${API_BASE_URL}/api/slack/channels`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.channels && Array.isArray(data.channels)) {
          setChannels(data.channels);
        }
      }
    } catch (err) {
      console.warn("[Slack] Failed to fetch channel list:", err);
    } finally {
      setIsLoadingChannels(false);
    }
  }, []);

  const fetchStatus = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setIsLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/slack/status`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });

      if (res.ok) {
        const data: SlackStatusResponse = await res.json();
        setStatus(data);
        if (data.channelName) {
          setSelectedChannel(data.channelName);
        } else if (data.channelId) {
          setSelectedChannel(data.channelId);
        }
        onStatusChangeRef.current?.(data);

        if (data.connected) {
          fetchChannels();
        }
      } else if (res.status === 401) {
        setStatus({ connected: false });
        onStatusChangeRef.current?.({ connected: false });
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data.message || "Unable to check Slack status");
      }
    } catch (err: any) {
      console.error("[Slack] Failed to fetch status:", err);
      setErrorMessage("Network error while checking Slack integration");
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [fetchChannels]);

  // Handle OAuth callback params on mount and fetch initial status
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const slackAction = urlParams.get("slack");
    const teamParam = urlParams.get("team");
    const messageParam = urlParams.get("message");

    if (slackAction === "connected") {
      const decodedTeam = teamParam ? decodeURIComponent(teamParam) : "Workspace";
      setSuccessMessage(`Successfully connected Slack workspace: ${decodedTeam}!`);
      // Clean query params so refresh doesn't replay toast
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } else if (slackAction === "error") {
      const decodedMsg = messageParam ? decodeURIComponent(messageParam) : "Authorization was cancelled or failed.";
      setErrorMessage(`Slack authorization failed: ${decodedMsg}`);
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }

    fetchStatus();
  }, [fetchStatus]);

  // Initiate real OAuth flow
  const handleConnectSlack = async () => {
    try {
      setIsConnecting(true);
      setErrorMessage(null);
      setSuccessMessage(null);

      const res = await fetch(`${API_BASE_URL}/api/slack/connect`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to initiate Slack authorization");
      }

      if (data.url) {
        // Redirect browser to Slack's real OAuth authorization page
        window.location.href = data.url;
      } else {
        throw new Error("No authorization URL received from server");
      }
    } catch (err: any) {
      console.error("[Slack] Initiate OAuth failed:", err);
      setErrorMessage(err.message || "Failed to initiate Slack authorization");
      setIsConnecting(false);
    }
  };

  // Save selected channel
  const handleSaveChannel = async () => {
    const channelToSave = useCustomChannel ? customChannelInput.trim() : selectedChannel;
    if (!channelToSave) {
      setErrorMessage("Please select or enter a Slack channel");
      return;
    }

    try {
      setIsSavingChannel(true);
      setErrorMessage(null);
      setChannelSuccessMessage(null);
      setTestNotificationMessage(null);

      const res = await fetch(`${API_BASE_URL}/api/slack/channel`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({ channel: channelToSave }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to configure Slack channel");
      }

      setChannelSuccessMessage(data.message || "Notification channel saved successfully!");
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              channelId: data.channelId,
              channelName: data.channelName,
            }
          : prev
      );
      fetchStatus(false);
    } catch (err: any) {
      console.error("[Slack] Failed to save channel:", err);
      setErrorMessage(err.message || "Failed to save channel");
    } finally {
      setIsSavingChannel(false);
    }
  };

  // Send live test notification
  const handleSendTestNotification = async () => {
    try {
      setIsSendingTest(true);
      setErrorMessage(null);
      setTestNotificationMessage(null);

      const res = await fetch(`${API_BASE_URL}/api/slack/test-notification`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to dispatch test notification");
      }

      setTestNotificationMessage(data.message || "Test alert delivered successfully to Slack!");
    } catch (err: any) {
      console.error("[Slack] Test notification failed:", err);
      setErrorMessage(err.message || "Failed to send test alert to Slack");
    } finally {
      setIsSendingTest(false);
    }
  };

  // Disconnect existing Slack connection
  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setChannelSuccessMessage(null);
      setTestNotificationMessage(null);

      const res = await fetch(`${API_BASE_URL}/api/slack/disconnect`, {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to disconnect Slack workspace");
      }

      const disconnectedState: SlackStatusResponse = { connected: false };
      setStatus(disconnectedState);
      setChannels([]);
      setSelectedChannel("");
      if (onStatusChange) onStatusChange(disconnectedState);
      setSuccessMessage("Slack workspace disconnected successfully.");
    } catch (err: any) {
      console.error("[Slack] Disconnect failed:", err);
      setErrorMessage(err.message || "Failed to disconnect Slack workspace");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = Boolean(status?.connected);


  return (
    <div className="slack-integration-card">
      {/* Success Banner */}
      {successMessage && (
        <div className="slack-alert-banner success animate-fade-in">
          <div className="alert-content">
            <CheckCircle2 size={18} className="alert-icon-success" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="slack-alert-close-btn"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="slack-alert-banner error animate-fade-in">
          <div className="alert-content">
            <AlertCircle size={18} className="alert-icon-error" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="slack-alert-close-btn"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="slack-card-header">
        <div className="slack-header-brand">
          <div className="slack-icon-container">
            <SlackLogo size={24} />
          </div>
          <div className="slack-header-info">
            <div className="slack-title-row">
              <h3>Slack Integration</h3>
              {isLoading ? (
                <span className="status-pill status-loading">
                  <Loader2 size={11} className="spin" /> Checking...
                </span>
              ) : isConnected ? (
                <span className="status-pill status-connected">
                  <span className="pulsing-green-dot" /> Connected
                </span>
              ) : (
                <span className="status-pill status-disconnected">
                  <span className="muted-dot" /> Disconnected
                </span>
              )}
            </div>
            <p className="slack-subtitle">
              Synchronize dispatch metrics, failure alerts, and scheduling notices with your Slack workspace
            </p>
          </div>
        </div>

        <div className="slack-header-actions">
          <button
            onClick={() => fetchStatus(true)}
            disabled={isLoading || isConnecting || isDisconnecting}
            className="icon-btn-refresh"
            title="Refresh Slack Status"
            id="refresh-slack-status-btn"
          >
            <RefreshCw size={14} className={isLoading ? "spin" : ""} />
          </button>
        </div>
      </div>

      <div className="slack-card-body">
        {isLoading ? (
          <div className="slack-loading-state">
            <Loader2 size={24} className="spin text-purple" />
            <span>Checking Slack integration status...</span>
          </div>
        ) : isConnected ? (
          /* Connected State */
          <div className="slack-connected-view animate-fade-in">
            <div className="slack-details-grid">
              <div className="slack-detail-box">
                <div className="detail-box-label">
                  <Building2 size={14} />
                  <span>Workspace Name</span>
                </div>
                <div className="detail-box-val highlight">
                  {status?.teamName || "Connected Workspace"}
                </div>
              </div>

              <div className="slack-detail-box">
                <div className="detail-box-label">
                  <Hash size={14} />
                  <span>Team ID</span>
                </div>
                <div className="detail-box-val mono-text">
                  {status?.teamId || "—"}
                </div>
              </div>

              <div className="slack-detail-box">
                <div className="detail-box-label">
                  <ShieldCheck size={14} />
                  <span>Bot User ID</span>
                </div>
                <div className="detail-box-val mono-text">
                  {status?.botUserId || "—"}
                </div>
              </div>

              <div className="slack-detail-box">
                <div className="detail-box-label">
                  <Clock size={14} />
                  <span>Connected At</span>
                </div>
                <div className="detail-box-val">
                  {status?.connectedAt
                    ? new Date(status.connectedAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Active"}
                </div>
              </div>
            </div>

            <div className="slack-security-note">
              <ShieldCheck size={14} className="security-icon" />
              <span>
                Bot token encrypted with AES-256-GCM in PostgreSQL. Token is never stored or exposed to the client.
              </span>
            </div>

          
            <div className="slack-channel-config-card">
              <div className="channel-config-header">
                <div className="channel-config-title">
                  <BellRing size={16} className="text-purple" />
                  <h4>Alert Notification Channel</h4>
                </div>
                {status?.channelId ? (
                  <span className="current-channel-badge">
                    <Hash size={12} />
                    {status.channelName || status.channelId}
                  </span>
                ) : (
                  <span className="current-channel-badge unconfigured">
                    No channel configured
                  </span>
                )}
              </div>

              <p className="channel-config-subtitle">
                Select where rate-limit warnings and dispatch notifications will be posted. When an email sender reaches its hourly limit, an alert is automatically delivered here.
              </p>

              {channelSuccessMessage && (
                <div className="slack-mini-alert success animate-fade-in">
                  <CheckCircle2 size={15} />
                  <span>{channelSuccessMessage}</span>
                </div>
              )}

              {testNotificationMessage && (
                <div className="slack-mini-alert success animate-fade-in">
                  <CheckCircle2 size={15} />
                  <span>{testNotificationMessage}</span>
                </div>
              )}

              <div className="channel-selection-row">
                <div className="channel-input-container">
                  {!useCustomChannel ? (
                    <div className="channel-select-wrap">
                      <select
                        id="slack-channel-select"
                        className="channel-dropdown-select"
                        value={selectedChannel}
                        onChange={(e) => setSelectedChannel(e.target.value)}
                        disabled={isLoadingChannels || isSavingChannel}
                      >
                        <option value="">-- Choose a Slack Channel --</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.name}>
                            #{ch.name} {ch.is_private ? "(private)" : ""} {!ch.is_member ? "(bot will auto-join)" : ""}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn-link-toggle"
                        onClick={() => setUseCustomChannel(true)}
                      >
                        Enter manually
                      </button>
                    </div>
                  ) : (
                    <div className="channel-custom-input-wrap">
                      <input
                        id="slack-custom-channel-input"
                        type="text"
                        className="channel-text-input"
                        placeholder="#mail-scheduler-alerts or C0C0761S84B"
                        value={customChannelInput}
                        onChange={(e) => setCustomChannelInput(e.target.value)}
                        disabled={isSavingChannel}
                      />
                      <button
                        type="button"
                        className="btn-link-toggle"
                        onClick={() => setUseCustomChannel(false)}
                      >
                        Choose from list
                      </button>
                    </div>
                  )}
                </div>

                <div className="channel-action-btns">
                  <button
                    id="save-slack-channel-btn"
                    className="btn-save-channel"
                    onClick={handleSaveChannel}
                    disabled={isSavingChannel || (!selectedChannel && !customChannelInput.trim())}
                  >
                    {isSavingChannel ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>Save Channel</span>
                      </>
                    )}
                  </button>

                  <button
                    id="send-slack-test-btn"
                    className="btn-test-notification"
                    onClick={handleSendTestNotification}
                    disabled={isSendingTest || !status?.channelId}
                    title={!status?.channelId ? "Please save a channel first" : "Send a live test alert to Slack"}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 size={14} className="spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>Send Test Alert</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="slack-action-toolbar">
              <button
                id="slack-reconnect-btn"
                className="btn-slack-reconnect"
                onClick={handleConnectSlack}
                disabled={isConnecting || isDisconnecting}
                title="Change or re-authorize Slack workspace"
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    <span>Redirecting to Slack...</span>
                  </>
                ) : (
                  <>
                    <ExternalLink size={15} />
                    <span>Reconnect / Change Workspace</span>
                  </>
                )}
              </button>

              <button
                id="slack-disconnect-btn"
                className="btn-slack-disconnect"
                onClick={handleDisconnect}
                disabled={isDisconnecting || isConnecting}
                title="Disconnect Slack workspace"
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    <span>Disconnecting...</span>
                  </>
                ) : (
                  <>
                    <Unlink size={15} />
                    <span>Disconnect</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Disconnected State */
          <div className="slack-disconnected-view animate-fade-in">
            <div className="slack-empty-content">
              <div className="slack-features-chips">
                <div className="feature-chip">
                  <CheckCircle2 size={13} className="chip-check" />
                  <span>Live Dispatch Alerts</span>
                </div>
                <div className="feature-chip">
                  <CheckCircle2 size={13} className="chip-check" />
                  <span>Delivery Bounce Warnings</span>
                </div>
                <div className="feature-chip">
                  <CheckCircle2 size={13} className="chip-check" />
                  <span>AES-256 Server-Side Token Encryption</span>
                </div>
              </div>

              <div className="slack-cta-box">
                <button
                  id="connect-slack-btn"
                  className="btn-connect-slack"
                  onClick={handleConnectSlack}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 size={18} className="spin" />
                      <span>Initiating OAuth Handshake...</span>
                    </>
                  ) : (
                    <>
                      <SlackLogo size={18} />
                      <span>Connect Slack</span>
                    </>
                  )}
                </button>
                <p className="slack-connect-hint">
                  Authorizes the MailFlow bot in your Slack workspace. OAuth tokens are stored encrypted and never exposed to the frontend.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
