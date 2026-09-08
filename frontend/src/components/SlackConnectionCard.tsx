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
    className="inline-block align-middle"
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

  const [channels, setChannels] = useState<SlackChannelItem[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>("");
  const [customChannelInput, setCustomChannelInput] = useState<string>("");
  const [useCustomChannel, setUseCustomChannel] = useState<boolean>(false);
  const [isLoadingChannels, setIsLoadingChannels] = useState<boolean>(false);
  const [isSavingChannel, setIsSavingChannel] = useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);
  const [channelSuccessMessage, setChannelSuccessMessage] = useState<string | null>(null);
  const [channelErrorMessage, setChannelErrorMessage] = useState<string | null>(null);
  const [testNotificationMessage, setTestNotificationMessage] = useState<string | null>(null);
  const [testErrorMessage, setTestErrorMessage] = useState<string | null>(null);

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

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const slackAction = urlParams.get("slack");
    const teamParam = urlParams.get("team");
    const messageParam = urlParams.get("message");

    if (slackAction === "connected") {
      const decodedTeam = teamParam ? decodeURIComponent(teamParam) : "Workspace";
      setSuccessMessage(`Successfully connected Slack workspace: ${decodedTeam}!`);
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

  const handleSaveChannel = async () => {
    const channelToSave = useCustomChannel ? customChannelInput.trim() : selectedChannel;
    if (!channelToSave) {
      setChannelErrorMessage("Please select or enter a Slack channel before clicking Save.");
      return;
    }

    try {
      setIsSavingChannel(true);
      setErrorMessage(null);
      setChannelErrorMessage(null);
      setChannelSuccessMessage(null);
      setTestNotificationMessage(null);
      setTestErrorMessage(null);

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
      setChannelErrorMessage(err.message || "Failed to save channel");
    } finally {
      setIsSavingChannel(false);
    }
  };

  const handleSendTestNotification = async () => {
    if (!status?.channelId) {
      setTestErrorMessage("No notification channel configured. Please choose a channel and click 'Save Channel' first.");
      return;
    }

    try {
      setIsSendingTest(true);
      setErrorMessage(null);
      setTestNotificationMessage(null);
      setTestErrorMessage(null);
      setChannelErrorMessage(null);

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
      setTestErrorMessage(err.message || "Failed to send test alert to Slack");
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsDisconnecting(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      setChannelSuccessMessage(null);
      setChannelErrorMessage(null);
      setTestNotificationMessage(null);
      setTestErrorMessage(null);

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
    <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-7">
      {successMessage && (
        <div className="flex items-center justify-between p-3.5 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 mb-4 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={17} className="text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-500 hover:text-emerald-800 cursor-pointer p-0.5"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="flex items-center justify-between p-3.5 rounded-xl text-sm bg-red-50 border border-red-200 text-red-800 mb-4 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle size={17} className="text-red-600" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-500 hover:text-red-800 cursor-pointer p-0.5"
            title="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center flex-shrink-0 shadow-2xs">
            <SlackLogo size={26} />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-gray-900 m-0">Slack Integration</h3>
              {isLoading ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-gray-100 border border-gray-200 text-gray-500">
                  <Loader2 size={12} className="animate-spin" /> Checking...
                </span>
              ) : isConnected ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full text-xs font-semibold bg-gray-100 border border-gray-200 text-gray-500">
                  <span className="w-2 h-2 rounded-full bg-gray-400" /> Disconnected
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Synchronize dispatch metrics, failure alerts, and scheduling notices with your Slack workspace
            </p>
          </div>
        </div>

        <div>
          <button
            onClick={() => fetchStatus(true)}
            disabled={isLoading || isConnecting || isDisconnecting}
            className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition cursor-pointer"
            title="Refresh Slack Status"
            id="refresh-slack-status-btn"
          >
            <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div>
        {isLoading ? (
          <div className="flex items-center justify-center gap-3 py-10 text-gray-400 text-sm">
            <Loader2 size={22} className="animate-spin text-emerald-500" />
            <span>Checking Slack integration status...</span>
          </div>
        ) : isConnected ? (
          <div className="flex flex-col animate-fade-in">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1">
                  <Building2 size={14} />
                  <span>Workspace Name</span>
                </div>
                <div className="text-base font-bold text-gray-900 truncate">
                  {status?.teamName || "Connected Workspace"}
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1">
                  <Hash size={14} />
                  <span>Team ID</span>
                </div>
                <div className="text-xs font-mono text-gray-700 font-medium">
                  {status?.teamId || "—"}
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1">
                  <ShieldCheck size={14} />
                  <span>Bot User ID</span>
                </div>
                <div className="text-xs font-mono text-gray-700 font-medium">
                  {status?.botUserId || "—"}
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 uppercase mb-1">
                  <Clock size={14} />
                  <span>Connected At</span>
                </div>
                <div className="text-xs text-gray-700 font-medium">
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

            <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-4 py-2.5 rounded-xl mb-5">
              <ShieldCheck size={16} className="text-emerald-600 flex-shrink-0" />
              <span>
                Bot token encrypted with AES-256-GCM in PostgreSQL. Token is never stored or exposed to the client.
              </span>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 mb-5">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <BellRing size={16} className="text-emerald-600" />
                  <h4 className="text-sm font-bold text-gray-900 m-0">Alert Notification Channel</h4>
                </div>
                {status?.channelId ? (
                  <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 font-semibold text-xs px-3 py-1 rounded-full">
                    <Hash size={12} />
                    {status.channelName || status.channelId}
                  </span>
                ) : (
                  <span className="bg-amber-100 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full">
                    No channel configured
                  </span>
                )}
              </div>

              <p className="text-sm text-gray-500 mb-3.5">
                Select where rate-limit warnings and dispatch notifications will be posted. When an email sender reaches its hourly limit, an alert is automatically delivered here.
              </p>

              {channelSuccessMessage && (
                <div className="flex items-center justify-between p-3 mb-3.5 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 animate-fade-in">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>{channelSuccessMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChannelSuccessMessage(null)}
                    className="text-emerald-500 hover:text-emerald-800 cursor-pointer p-0.5"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {channelErrorMessage && (
                <div className="flex items-center justify-between p-3 mb-3.5 rounded-xl text-sm bg-red-50 border border-red-200 text-red-800 animate-fade-in">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
                    <span>{channelErrorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setChannelErrorMessage(null)}
                    className="text-red-500 hover:text-red-800 cursor-pointer p-0.5"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {testNotificationMessage && (
                <div className="flex items-center justify-between p-3 mb-3.5 rounded-xl text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 animate-fade-in">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" />
                    <span>{testNotificationMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestNotificationMessage(null)}
                    className="text-emerald-500 hover:text-emerald-800 cursor-pointer p-0.5"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {testErrorMessage && (
                <div className="flex items-center justify-between p-3 mb-3.5 rounded-xl text-sm bg-red-50 border border-red-200 text-red-800 animate-fade-in">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle size={16} className="text-red-600 flex-shrink-0" />
                    <span>{testErrorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTestErrorMessage(null)}
                    className="text-red-500 hover:text-red-800 cursor-pointer p-0.5"
                    title="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[260px]">
                  {!useCustomChannel ? (
                    <div className="flex items-center gap-3">
                      <select
                        id="slack-channel-select"
                        className="flex-1 h-10 bg-white border border-gray-200 rounded-xl px-3.5 text-sm text-gray-800 outline-none focus:border-emerald-500 cursor-pointer"
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
                        className="text-xs font-semibold text-emerald-600 hover:underline cursor-pointer flex-shrink-0"
                        onClick={() => setUseCustomChannel(true)}
                      >
                        Enter manually
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <input
                        id="slack-custom-channel-input"
                        type="text"
                        className="flex-1 h-10 bg-white border border-gray-200 rounded-xl px-3.5 text-sm text-gray-800 outline-none focus:border-emerald-500"
                        placeholder="#mail-scheduler-alerts or C0C0761S84B"
                        value={customChannelInput}
                        onChange={(e) => setCustomChannelInput(e.target.value)}
                        disabled={isSavingChannel}
                      />
                      <button
                        type="button"
                        className="text-xs font-semibold text-emerald-600 hover:underline cursor-pointer flex-shrink-0"
                        onClick={() => setUseCustomChannel(false)}
                      >
                        Choose from list
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    id="save-slack-channel-btn"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm px-4 py-2 rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    onClick={handleSaveChannel}
                    disabled={isSavingChannel || (!selectedChannel && !customChannelInput.trim())}
                  >
                    {isSavingChannel ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
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
                    className="bg-white border border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-semibold text-sm px-4 py-2 rounded-xl inline-flex items-center gap-1.5 transition cursor-pointer"
                    onClick={handleSendTestNotification}
                    disabled={isSendingTest}
                    title={!status?.channelId ? "Please save a channel first to send a test alert" : "Send a live test alert to Slack"}
                  >
                    {isSendingTest ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
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

            <div className="flex items-center gap-3">
              <button
                id="slack-reconnect-btn"
                className="bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:text-gray-900 font-semibold text-sm px-4 py-2.5 rounded-xl inline-flex items-center gap-2 transition cursor-pointer"
                onClick={handleConnectSlack}
                disabled={isConnecting || isDisconnecting}
                title="Change or re-authorize Slack workspace"
              >
                {isConnecting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
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
                className="bg-red-50 border border-red-200 text-red-600 hover:bg-red-100 font-semibold text-sm px-4 py-2.5 rounded-xl inline-flex items-center gap-2 transition cursor-pointer"
                onClick={handleDisconnect}
                disabled={isDisconnecting || isConnecting}
                title="Disconnect Slack workspace"
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
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
          <div className="flex flex-col animate-fade-in">
            <div className="flex flex-col gap-4">
              <div className="flex gap-2.5 flex-wrap">
                <div className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-3.5 py-1.5 rounded-full">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <span>Live Dispatch Alerts</span>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-3.5 py-1.5 rounded-full">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <span>Delivery Bounce Warnings</span>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 px-3.5 py-1.5 rounded-full">
                  <CheckCircle2 size={14} className="text-emerald-500" />
                  <span>AES-256 Server-Side Token Encryption</span>
                </div>
              </div>

              <div className="flex items-center gap-4 flex-wrap mt-2">
                <button
                  id="connect-slack-btn"
                  className="bg-gradient-to-br from-[#4A154B] to-[#611f69] text-white font-semibold text-sm px-6 py-2.5 rounded-xl inline-flex items-center gap-2.5 shadow-xs hover:opacity-95 transition cursor-pointer"
                  onClick={handleConnectSlack}
                  disabled={isConnecting}
                >
                  {isConnecting ? (
                    <>
                      <Loader2 size={17} className="animate-spin" />
                      <span>Initiating OAuth Handshake...</span>
                    </>
                  ) : (
                    <>
                      <SlackLogo size={18} />
                      <span>Connect Slack</span>
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-400 m-0">
                  Authorizes the Mail Scheduler bot in your Slack workspace. OAuth tokens are stored encrypted and never exposed to the frontend.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
