import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Clock,
  Send,
  Users,
  Search,
  Filter,
  RotateCw,
  Plus,
  Star,
  ChevronDown,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Server,
  LogOut,
  Mail,
  Trash2,
  Archive,
  ArrowLeft,
  MessageSquare,
} from "lucide-react";
import { ComposeEmailModal } from "../components/ComposeEmailModal";
import { SlackConnectionCard } from "../components/SlackConnectionCard";

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

interface EmailItem {
  id: string;
  recipientEmail: string;
  subject: string;
  snippet?: string;
  body?: string;
  status: string;
  date?: string;
  scheduledAt?: string;
  sentAt?: string;
  starred?: boolean;
  senderName?: string;
  senderEmail?: string;
}

export const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();

  const [activeTab, setActiveTab] = useState<"sent" | "scheduled" | "senders" | "slack">("scheduled");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const [senders, setSenders] = useState<Sender[]>([]);
  const [isLoadingSenders, setIsLoadingSenders] = useState(true);
  const [dbStatus, setDbStatus] = useState<string>("checking...");

  const [realEmails, setRealEmails] = useState<EmailItem[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [scheduledCount, setScheduledCount] = useState<number>(0);
  const [sentCount, setSentCount] = useState<number>(0);

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);

  const [isSenderModalOpen, setIsSenderModalOpen] = useState(false);
  const [isSubmittingSender, setIsSubmittingSender] = useState(false);
  const [senderSubmitError, setSenderSubmitError] = useState<string | null>(null);
  const [senderSubmitSuccess, setSenderSubmitSuccess] = useState<string | null>(null);
  const [senderFormData, setSenderFormData] = useState({
    name: "",
    email: "",
    smtpHost: "smtp.ethereal.email",
    smtpPort: "587",
    smtpUser: "",
    smtpPassword: "",
  });

  const [slackStatus, setSlackStatus] = useState<{
    connected: boolean;
    teamName?: string | null;
    teamId?: string | null;
  } | null>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem("auth_token");
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  const checkDb = async () => {
    try {
      const res = await fetch("http://localhost:5000/health/db");
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data.database === "connected" ? "Connected" : "Disconnected");
      }
    } catch {
      setDbStatus("Unreachable");
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
    } catch (err) {
      console.warn("Failed to load senders:", err);
    } finally {
      setIsLoadingSenders(false);
    }
  }, []);

  const fetchEmailCounts = useCallback(async () => {
    try {
      const [schedRes, sentRes] = await Promise.all([
        fetch("http://localhost:5000/api/emails?status=SCHEDULED&limit=1", {
          headers: getAuthHeaders(),
          credentials: "include",
        }),
        fetch("http://localhost:5000/api/emails?status=SENT&limit=1", {
          headers: getAuthHeaders(),
          credentials: "include",
        }),
      ]);
      if (schedRes.ok) {
        const data = await schedRes.json();
        setScheduledCount(typeof data.total === "number" ? data.total : 0);
      }
      if (sentRes.ok) {
        const data = await sentRes.json();
        setSentCount(typeof data.total === "number" ? data.total : 0);
      }
    } catch (err) {
      console.warn("Failed to fetch email counts:", err);
    }
  }, []);

  const hasLoadedInitialEmails = useRef<Record<string, boolean>>({});

  const fetchEmails = useCallback(async (isSilent = false) => {
    const isInitial = !hasLoadedInitialEmails.current[activeTab];
    try {
      if (!isSilent && isInitial) {
        setIsLoadingEmails(true);
      }
      const statusParam = activeTab === "scheduled" ? "SCHEDULED" : "SENT";
      const res = await fetch(`http://localhost:5000/api/emails?status=${statusParam}`, {
        headers: getAuthHeaders(),
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        hasLoadedInitialEmails.current[activeTab] = true;
        if (data.emails && data.emails.length > 0) {
          const mapped: EmailItem[] = data.emails.map((e: any) => ({
            id: e.id,
            recipientEmail: e.recipientEmail,
            subject: e.subject,
            snippet: e.body ? e.body.replace(/<[^>]+>/g, "").slice(0, 75) + "..." : "No preview available",
            body: e.body || "",
            status: e.status,
            date: e.sentAt
              ? new Date(e.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : e.scheduledAt
              ? new Date(e.scheduledAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : "Recently",
            starred: false,
          }));
          setRealEmails(mapped);
          if (activeTab === "scheduled") setScheduledCount(data.total ?? mapped.length);
          if (activeTab === "sent") setSentCount(data.total ?? mapped.length);
        } else {
          setRealEmails([]);
          if (activeTab === "scheduled") setScheduledCount(0);
          if (activeTab === "sent") setSentCount(0);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch emails:", err);
    } finally {
      setIsLoadingEmails(false);
    }
  }, [activeTab]);

  useEffect(() => {
    checkDb();
    fetchSenders();
    fetchEmailCounts();
  }, [fetchSenders, fetchEmailCounts]);

  useEffect(() => {
    if (activeTab === "scheduled" || activeTab === "sent") {
      fetchEmails(false);
      fetchEmailCounts();
    }
  }, [activeTab, fetchEmails, fetchEmailCounts]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchEmailCounts();
      if (activeTab === "scheduled" || activeTab === "sent") {
        fetchEmails(true);
      }
    }, 6000);
    return () => clearInterval(interval);
  }, [activeTab, fetchEmails, fetchEmailCounts]);

  const displayedEmails = useMemo(() => {
    if (!searchQuery.trim()) return realEmails;

    const q = searchQuery.toLowerCase();
    return realEmails.filter(
      (e) =>
        e.recipientEmail.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        (e.snippet && e.snippet.toLowerCase().includes(q))
    );
  }, [realEmails, searchQuery]);

  const handleOpenSenderModal = (prefillEmail?: string, prefillName?: string) => {
    setSenderFormData({
      name: prefillName || user?.name || "",
      email: prefillEmail || "",
      smtpHost: "smtp.ethereal.email",
      smtpPort: "587",
      smtpUser: prefillEmail || "",
      smtpPassword: "",
    });
    setSenderSubmitError(null);
    setSenderSubmitSuccess(null);
    setIsSenderModalOpen(true);
  };

  const handleAddSenderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingSender(true);
    setSenderSubmitError(null);
    setSenderSubmitSuccess(null);

    try {
      const res = await fetch("http://localhost:5000/api/senders", {
        method: "POST",
        headers: getAuthHeaders(),
        credentials: "include",
        body: JSON.stringify({
          name: senderFormData.name.trim() || undefined,
          email: senderFormData.email.trim(),
          smtpHost: senderFormData.smtpHost.trim(),
          smtpPort: Number(senderFormData.smtpPort),
          smtpUser: senderFormData.smtpUser.trim(),
          smtpPassword: senderFormData.smtpPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to configure sender. Check SMTP credentials.");
      }

      setSenderSubmitSuccess("Sender configured and SMTP verified successfully!");
      await fetchSenders();
      setTimeout(() => {
        setIsSenderModalOpen(false);
        setSenderSubmitSuccess(null);
      }, 1200);
    } catch (err: any) {
      setSenderSubmitError(err.message || "Unable to configure sender.");
    } finally {
      setIsSubmittingSender(false);
    }
  };

  const activeSendersCount = senders.filter((s) => s.isActive && s.smtpHost).length;

  return (
    <div className="flex min-h-screen bg-white text-gray-900 font-sans antialiased overflow-x-hidden">
      <aside className="w-64 flex-shrink-0 bg-white border-r border-gray-100 p-5 flex flex-col min-h-screen">
        <div className="mb-6 pl-1.5">
          <span className="text-3xl font-black font-display tracking-tight text-black leading-none select-none">
            ONB
          </span>
        </div>

        <div className="relative mb-5">
          <button
            type="button"
            className="w-full flex items-center gap-3 bg-gray-50 border border-gray-100 hover:border-gray-200 hover:bg-gray-100/80 rounded-xl p-2.5 cursor-pointer transition text-left"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
          >
            <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0 bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name || "User"}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = "none";
                  }}
                />
              ) : (
                <span>{user?.name ? user.name.charAt(0).toUpperCase() : "O"}</span>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-sm font-semibold text-gray-900 truncate leading-tight">
                {user?.name || user?.email?.split("@")[0] || "Account"}
              </span>
              <span className="text-xs text-gray-500 truncate leading-tight mt-0.5">
                {user?.email || "Signed In"}
              </span>
            </div>

            <ChevronDown size={15} className="text-gray-400 flex-shrink-0 ml-auto" />
          </button>

          {isUserMenuOpen && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg p-3.5 z-50 animate-fade-in">
              <div className="flex flex-col gap-1 text-sm pb-2.5 border-b border-gray-100">
                <strong className="text-sm text-gray-900">{user?.name || "User"}</strong>
                <span className="text-xs text-gray-500 truncate">{user?.email}</span>
                <div className="inline-flex items-center gap-1.5 mt-1.5 text-xs text-gray-600 bg-gray-50 px-2.5 py-1 rounded-md w-fit">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      dbStatus === "Connected" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                  />
                  <span>DB: {dbStatus}</span>
                </div>
              </div>

              <button
                type="button"
                className="w-full flex items-center gap-2 px-2.5 py-2 mt-1.5 rounded-lg text-sm font-semibold text-red-600 hover:bg-red-50 transition cursor-pointer"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  logout();
                }}
              >
                <LogOut size={15} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>

        <div className="mb-7">
          <button
            type="button"
            id="sidebar-compose-btn"
            className="w-full py-3 rounded-full bg-white border-2 border-emerald-500 text-emerald-600 font-semibold text-[14.5px] hover:bg-emerald-50 hover:border-emerald-600 transition text-center shadow-xs cursor-pointer tracking-wide"
            onClick={() => setIsComposeOpen(true)}
          >
            Compose
          </button>
        </div>

        <div className="flex flex-col">
          <span className="text-xs font-bold text-gray-400 tracking-wider uppercase mb-2.5 pl-2">
            CORE
          </span>

          <nav className="flex flex-col gap-1">
            <button
              type="button"
              id="nav-tab-scheduled"
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[14.5px] transition text-left cursor-pointer ${
                activeTab === "scheduled"
                  ? "bg-emerald-50 text-emerald-800 font-semibold"
                  : "text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setActiveTab("scheduled");
                setSelectedEmail(null);
              }}
            >
              <div className="flex items-center gap-3">
                <Clock size={18} className="flex-shrink-0" />
                <span>Scheduled</span>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full ${
                  activeTab === "scheduled" ? "bg-emerald-100 text-emerald-800 font-semibold" : "text-gray-400 font-normal"
                }`}
              >
                {scheduledCount}
              </span>
            </button>

            <button
              type="button"
              id="nav-tab-sent"
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[14.5px] transition text-left cursor-pointer ${
                activeTab === "sent"
                  ? "bg-emerald-50 text-emerald-800 font-semibold"
                  : "text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setActiveTab("sent");
                setSelectedEmail(null);
              }}
            >
              <div className="flex items-center gap-3">
                <Send size={18} className="flex-shrink-0" />
                <span>Sent</span>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full ${
                  activeTab === "sent" ? "bg-emerald-100 text-emerald-800 font-semibold" : "text-gray-400 font-normal"
                }`}
              >
                {sentCount}
              </span>
            </button>
          </nav>
        </div>

        <div className="flex flex-col mt-7">
          <span className="text-xs font-bold text-gray-400 tracking-wider uppercase mb-2.5 pl-2">
            MANAGEMENT
          </span>

          <nav className="flex flex-col gap-1">
            <button
              type="button"
              id="nav-tab-senders"
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[14.5px] transition text-left cursor-pointer ${
                activeTab === "senders"
                  ? "bg-emerald-50 text-emerald-800 font-semibold"
                  : "text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setActiveTab("senders");
                setSelectedEmail(null);
              }}
            >
              <div className="flex items-center gap-3">
                <Users size={18} className="flex-shrink-0" />
                <span>Senders</span>
              </div>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full ${
                  activeTab === "senders" ? "bg-emerald-100 text-emerald-800 font-semibold" : "text-gray-400 font-normal"
                }`}
              >
                {activeSendersCount}
              </span>
            </button>

            <button
              type="button"
              id="nav-tab-slack"
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-[14.5px] transition text-left cursor-pointer ${
                activeTab === "slack"
                  ? "bg-emerald-50 text-emerald-800 font-semibold"
                  : "text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900"
              }`}
              onClick={() => {
                setActiveTab("slack");
                setSelectedEmail(null);
              }}
            >
              <div className="flex items-center gap-3">
                <MessageSquare size={18} className="flex-shrink-0" />
                <span>Slack Alerts</span>
              </div>
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  slackStatus?.connected ? "bg-emerald-500 shadow-[0_0_8px_#10b981]" : "bg-gray-300"
                }`}
              />
            </button>
          </nav>
        </div>
      </aside>

      <main className="flex-1 min-w-0 bg-white flex flex-col px-8 lg:px-10 py-7 overflow-y-auto">
        {selectedEmail ? (
          <div className="w-full max-w-3xl animate-fade-in">
            <div className="flex items-center justify-between pb-4 mb-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                  onClick={() => setSelectedEmail(null)}
                  title="Back to list"
                >
                  <ArrowLeft size={20} />
                </button>
                <h3 className="text-xl font-bold text-gray-900 m-0">
                  {selectedEmail.subject}
                </h3>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:text-amber-500 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                  title="Star"
                >
                  <Star size={18} />
                </button>
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                  title="Archive"
                >
                  <Archive size={18} />
                </button>
                <button
                  type="button"
                  className="p-2 text-gray-500 hover:text-red-600 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                  title="Delete"
                >
                  <Trash2 size={18} />
                </button>
                <div className="w-8 h-8 rounded-full overflow-hidden ml-1.5 bg-emerald-600 text-white text-xs font-semibold flex items-center justify-center">
                  {user?.name?.charAt(0)?.toUpperCase() || "U"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3.5 mb-6">
              <div className="w-11 h-11 rounded-full bg-emerald-500 text-white font-bold text-lg flex items-center justify-center flex-shrink-0">
                {selectedEmail.recipientEmail.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-bold text-gray-900">
                    To: {selectedEmail.recipientEmail}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                      selectedEmail.status === "SENT"
                        ? "bg-gray-100 text-gray-600"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {selectedEmail.status === "SENT" ? "Sent" : "Scheduled"}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                  <span>From: {user?.name || user?.email || "Me"}</span>
                </div>
              </div>
              <span className="text-sm text-gray-400">{selectedEmail.date || "Recently"}</span>
            </div>

            <div className="text-[15px] leading-relaxed text-gray-800 bg-gray-50/60 rounded-2xl p-7 border border-gray-100 whitespace-pre-wrap font-sans">
              {selectedEmail.body ? (
                selectedEmail.body
              ) : (
                <span className="text-gray-400 italic">No message content available for this email.</span>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3.5 mb-6">
              <div className="relative flex-1 max-w-2xl">
                <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  id="dashboard-search-input"
                  className="w-full h-11 bg-gray-100/90 border border-transparent focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 rounded-full pl-11 pr-5 text-[14.5px] text-gray-900 placeholder:text-gray-400 outline-none transition"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                  title="Filter"
                >
                  <Filter size={18} />
                </button>
                <button
                  type="button"
                  className="w-10 h-10 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition cursor-pointer"
                  title="Refresh"
                  onClick={() => {
                    fetchEmails();
                    fetchSenders();
                    fetchEmailCounts();
                  }}
                >
                  <RotateCw size={18} className={isLoadingEmails ? "animate-spin" : ""} />
                </button>
              </div>
            </div>

            {(activeTab === "scheduled" || activeTab === "sent") && (
              <div className="w-full">
                {isLoadingEmails && realEmails.length === 0 ? (
                  <div className="flex items-center justify-center gap-3 py-16 text-gray-400 text-sm">
                    <Loader2 size={22} className="animate-spin text-emerald-500" />
                    <span>Loading emails...</span>
                  </div>
                ) : displayedEmails.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-20 text-gray-500">
                    <Mail size={36} className="text-gray-300 mb-3" />
                    <h4 className="text-base font-semibold text-gray-800 mb-1">
                      No {activeTab} emails found
                    </h4>
                    <p className="text-xs text-gray-400 max-w-sm mb-4">
                      {searchQuery
                        ? `No results match "${searchQuery}"`
                        : `Your ${activeTab} mailbox is currently empty. Click Compose to schedule an email.`}
                    </p>
                    <button
                      type="button"
                      className="bg-emerald-600 text-white px-4 py-2 rounded-full text-xs font-semibold hover:bg-emerald-700 transition cursor-pointer shadow-xs"
                      onClick={() => setIsComposeOpen(true)}
                    >
                      Compose Email
                    </button>
                  </div>
                ) : (
                  <div className="w-full flex flex-col">
                    {displayedEmails.map((email) => (
                      <div
                        key={email.id}
                        className="flex items-center px-5 py-3.5 border-b border-gray-100 hover:bg-gray-50/80 transition cursor-pointer gap-4 rounded-xl"
                        onClick={() => setSelectedEmail(email)}
                      >
                        <div className="w-48 flex-shrink-0 font-semibold text-[14.5px] text-gray-900 truncate">
                          <span>To: {email.recipientEmail}</span>
                        </div>

                        <div className="flex-shrink-0">
                          <span
                            className={`text-xs font-semibold px-3 py-0.5 rounded-full ${
                              email.status === "SENT"
                                ? "bg-gray-100 text-gray-700"
                                : "bg-emerald-100 text-emerald-800"
                            }`}
                          >
                            {email.status === "SENT" ? "Sent" : "Scheduled"}
                          </span>
                        </div>

                        <div className="flex-1 min-w-0 flex items-center gap-2 truncate text-[14.5px]">
                          <span className="font-semibold text-gray-900 flex-shrink-0">
                            {email.subject}
                          </span>
                          {email.snippet && (
                            <span className="text-gray-500 truncate">- {email.snippet}</span>
                          )}
                        </div>

                        <div
                          className="flex items-center gap-3 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <button
                            type="button"
                            className={`p-1.5 text-gray-300 hover:text-amber-400 transition cursor-pointer ${
                              email.starred ? "text-amber-400" : ""
                            }`}
                            title="Star email"
                          >
                            <Star size={18} fill={email.starred ? "#f59e0b" : "none"} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "senders" && (
              <div className="w-full max-w-4xl animate-fade-in">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 m-0">Configured Senders</h3>
                    <p className="text-xs text-gray-500 m-0 mt-1">
                      Link and verify SMTP accounts for automated campaign dispatches
                    </p>
                  </div>
                  <button
                    type="button"
                    id="add-sender-btn"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                    onClick={() => handleOpenSenderModal()}
                  >
                    <Plus size={15} />
                    <span>Add Sender</span>
                  </button>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
                  {isLoadingSenders ? (
                    <div className="flex items-center justify-center gap-3 py-12 text-gray-400 text-sm">
                      <Loader2 size={22} className="animate-spin text-emerald-500" />
                      <span>Loading senders...</span>
                    </div>
                  ) : senders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-12 text-gray-500">
                      <Server size={36} className="text-gray-300 mb-3" />
                      <h4 className="text-sm font-semibold text-gray-800 mb-1">
                        No Senders Configured
                      </h4>
                      <p className="text-xs text-gray-400 max-w-sm mb-4">
                        Add your SMTP credentials (e.g. Ethereal, Gmail, Sendgrid) to start scheduling campaigns.
                      </p>
                      <button
                        type="button"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition cursor-pointer"
                        onClick={() => handleOpenSenderModal()}
                      >
                        <Plus size={15} />
                        <span>Add Sender Now</span>
                      </button>
                    </div>
                  ) : (
                    <table className="w-full text-left text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                          <th className="pb-3 px-3">Sender Name</th>
                          <th className="pb-3 px-3">Email Address</th>
                          <th className="pb-3 px-3">SMTP Host</th>
                          <th className="pb-3 px-3">Status</th>
                          <th className="pb-3 px-3">Rate Limit</th>
                          <th className="pb-3 px-3">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {senders.map((s) => {
                          const isConfigured = s.isActive && Boolean(s.smtpHost);
                          return (
                            <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/70">
                              <td className="py-3.5 px-3 font-semibold text-gray-900">
                                {s.name || "Default Sender"}
                              </td>
                              <td className="py-3.5 px-3 text-gray-500 font-mono text-xs">{s.email}</td>
                              <td className="py-3.5 px-3 text-gray-500 font-mono text-xs">
                                {s.smtpHost ? `${s.smtpHost}:${s.smtpPort || 587}` : "Unconfigured"}
                              </td>
                              <td className="py-3.5 px-3">
                                {isConfigured ? (
                                  <span className="bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                                    Active
                                  </span>
                                ) : (
                                  <span className="bg-gray-100 text-gray-600 text-[11px] font-semibold px-2 py-0.5 rounded-full">
                                    Pending
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-3 text-xs text-gray-500">
                                {isConfigured ? "50 / hr" : "—"}
                              </td>
                              <td className="py-3.5 px-3">
                                <button
                                  type="button"
                                  className="text-xs font-semibold text-emerald-600 hover:underline cursor-pointer"
                                  onClick={() => handleOpenSenderModal(s.email, s.name || "")}
                                >
                                  Configure
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {activeTab === "slack" && (
              <div className="w-full max-w-4xl animate-fade-in">
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-gray-900 m-0">Slack Integration & Notifications</h3>
                  <p className="text-xs text-gray-500 m-0 mt-1">
                    Manage workspace authorization, alert channels, and test notifications
                  </p>
                </div>

                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-xs">
                  <SlackConnectionCard
                    onStatusChange={(st) =>
                      setSlackStatus({
                        connected: st.connected,
                        teamName: st.teamName,
                        teamId: st.teamId,
                      })
                    }
                  />
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {isSenderModalOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in"
          onClick={() => setIsSenderModalOpen(false)}
        >
          <div
            className="bg-white w-full max-w-lg rounded-2xl shadow-xl border border-gray-200 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-gray-900 m-0">Configure SMTP Sender</h3>
              <button
                type="button"
                className="p-1 text-gray-400 hover:text-gray-700 cursor-pointer"
                onClick={() => setIsSenderModalOpen(false)}
                disabled={isSubmittingSender}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSenderSubmit} className="flex flex-col gap-4">
              {senderSubmitError && (
                <div className="flex items-center gap-2 p-3 rounded-lg text-xs bg-red-50 border border-red-200 text-red-700">
                  <AlertCircle size={15} />
                  <span>{senderSubmitError}</span>
                </div>
              )}
              {senderSubmitSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-lg text-xs bg-emerald-50 border border-emerald-200 text-emerald-700">
                  <CheckCircle2 size={15} />
                  <span>{senderSubmitSuccess}</span>
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Sender Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Outreach Team"
                  className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                  value={senderFormData.name}
                  onChange={(e) => setSenderFormData({ ...senderFormData, name: e.target.value })}
                  disabled={isSubmittingSender}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">Sender Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. test@ethereal.email"
                  className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                  value={senderFormData.email}
                  onChange={(e) => setSenderFormData({ ...senderFormData, email: e.target.value })}
                  disabled={isSubmittingSender}
                />
              </div>

              <div className="flex gap-3">
                <div className="flex-2 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">SMTP Host *</label>
                  <input
                    type="text"
                    required
                    placeholder="smtp.ethereal.email"
                    className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                    value={senderFormData.smtpHost}
                    onChange={(e) => setSenderFormData({ ...senderFormData, smtpHost: e.target.value })}
                    disabled={isSubmittingSender}
                  />
                </div>

                <div className="flex-1 flex flex-col gap-1">
                  <label className="text-xs font-semibold text-gray-600">Port *</label>
                  <input
                    type="number"
                    required
                    placeholder="587"
                    className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                    value={senderFormData.smtpPort}
                    onChange={(e) => setSenderFormData({ ...senderFormData, smtpPort: e.target.value })}
                    disabled={isSubmittingSender}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">SMTP Username *</label>
                <input
                  type="text"
                  required
                  placeholder="Username"
                  className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                  value={senderFormData.smtpUser}
                  onChange={(e) => setSenderFormData({ ...senderFormData, smtpUser: e.target.value })}
                  disabled={isSubmittingSender}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-gray-600">SMTP Password *</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••••••"
                  className="w-full h-9 bg-gray-50 border border-gray-200 rounded-lg px-3 text-xs text-gray-900 outline-none focus:bg-white focus:border-emerald-500"
                  value={senderFormData.smtpPassword}
                  onChange={(e) => setSenderFormData({ ...senderFormData, smtpPassword: e.target.value })}
                  disabled={isSubmittingSender}
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 mt-2">
                <button
                  type="button"
                  className="px-3.5 py-2 text-xs font-medium text-gray-600 hover:text-gray-800 cursor-pointer"
                  onClick={() => setIsSenderModalOpen(false)}
                  disabled={isSubmittingSender}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition cursor-pointer"
                  disabled={isSubmittingSender}
                >
                  {isSubmittingSender ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Verifying SMTP...</span>
                    </>
                  ) : (
                    <span>Verify & Save</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ComposeEmailModal
        isOpen={isComposeOpen}
        onClose={() => setIsComposeOpen(false)}
        senders={senders}
        onScheduledSuccess={() => {
          fetchEmails();
          fetchSenders();
          fetchEmailCounts();
        }}
      />
    </div>
  );
};
