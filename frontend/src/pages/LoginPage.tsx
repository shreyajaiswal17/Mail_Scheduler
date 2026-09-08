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
    <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col font-sans">
      {/* Top Banner / Navigation */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-neutral-200/80 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-500/20">
            <Mail size={20} />
          </div>
          <div className="flex items-center gap-1.5 font-bold text-lg tracking-tight text-neutral-900">
            <span>MailFlow</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              PRO
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-600 bg-neutral-100 border border-neutral-200/80 px-3 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Backend API Connected (Port 5000)</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center">
          {/* Left Column: Hero & Value Proposition */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
              <Zap size={14} className="text-emerald-600" />
              <span>Smart Email Dispatch Engine</span>
            </div>
            <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-neutral-900 leading-[1.15]">
              Automated cold outreach with{" "}
              <span className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
                guaranteed deliverability.
              </span>
            </h1>
            <p className="text-base text-neutral-600 leading-relaxed max-w-xl">
              Schedule thousands of personalized emails with BullMQ queueing, randomized jitter delays, and real-time Slack delivery notifications.
            </p>

            <div className="space-y-3.5 pt-2">
              <div className="flex items-start gap-4 p-3.5 rounded-xl bg-white border border-neutral-200/80 shadow-xs hover:border-neutral-300 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                  <ShieldCheck size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-neutral-900">Account Safety & Rate Limiting</h4>
                  <p className="text-xs text-neutral-500 mt-0.5 leading-normal">
                    Stagger email dispatches with configurable hourly limits per sender account.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-3.5 rounded-xl bg-white border border-neutral-200/80 shadow-xs hover:border-neutral-300 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                  <Zap size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-neutral-900">BullMQ + Redis Job Queue</h4>
                  <p className="text-xs text-neutral-500 mt-0.5 leading-normal">
                    Robust background job processing with automatic retries and failure logging.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 p-3.5 rounded-xl bg-white border border-neutral-200/80 shadow-xs hover:border-neutral-300 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                  <Bell size={18} />
                </div>
                <div>
                  <h4 className="font-semibold text-sm text-neutral-900">Slack Webhook Alerts</h4>
                  <p className="text-xs text-neutral-500 mt-0.5 leading-normal">
                    Receive real-time alerts directly into your team channel on campaign completion.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Google OAuth Card */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-xl shadow-neutral-200/50 p-8 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center mx-auto mb-3 shadow-xs">
                  <Mail size={28} />
                </div>
                <h2 className="text-xl font-bold text-neutral-900 tracking-tight">Welcome Back</h2>
                <p className="text-xs text-neutral-500 leading-relaxed">
                  Sign in using your Google account to access your sender dashboard and campaigns.
                </p>
              </div>

              {error && (
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">
                  <AlertCircle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <strong className="block font-semibold">Authentication Notice</strong>
                    <p className="mt-0.5">{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearError}
                    className="text-rose-400 hover:text-rose-600 transition-colors p-1"
                    title="Dismiss notice"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div className="space-y-4">
                {/* Official Google Button */}
                <button
                  id="google-login-btn"
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border border-neutral-300 bg-white hover:bg-neutral-50 active:bg-neutral-100 text-neutral-800 font-semibold text-sm shadow-xs hover:shadow transition-all cursor-pointer"
                  onClick={loginWithGoogle}
                >
                  <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
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

                <div className="space-y-2 pt-4 border-t border-neutral-100 text-xs text-neutral-500">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                    <span>Instant Google consent screen</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                    <span>Auto-sync with PostgreSQL database</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle size={14} className="text-emerald-600 shrink-0" />
                    <span>Secure JWT session cookie</span>
                  </div>
                </div>
              </div>

              {/* Setup Guide Accordion */}
              <div className="pt-4 border-t border-neutral-100">
                <button
                  type="button"
                  className="w-full flex items-center justify-between text-xs font-medium text-neutral-500 hover:text-neutral-800 transition-colors py-1 cursor-pointer"
                  onClick={() => setShowSetupGuide(!showSetupGuide)}
                >
                  <div className="flex items-center gap-1.5">
                    <HelpCircle size={15} />
                    <span>Configuring Google OAuth credentials?</span>
                  </div>
                  {showSetupGuide ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>

                {showSetupGuide && (
                  <div className="mt-3 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200 text-xs text-neutral-600 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
                    <p className="text-neutral-600">
                      To complete setup, ensure these values are populated in <code className="bg-neutral-200 px-1 py-0.5 rounded text-[11px] font-mono">backend/.env</code>:
                    </p>
                    <div className="bg-neutral-900 text-emerald-400 p-2.5 rounded-lg font-mono text-[11px] space-y-1 overflow-x-auto">
                      <div className="text-neutral-300">GOOGLE_CLIENT_ID=your_client_id</div>
                      <div className="text-neutral-300">GOOGLE_CLIENT_SECRET=your_secret</div>
                      <div className="text-neutral-300">GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback</div>
                    </div>
                    <div className="text-[11px] text-neutral-500 bg-neutral-100 p-2 rounded-lg border border-neutral-200/80">
                      <span className="block">In Google Cloud Console, ensure Authorized Redirect URI is:</span>
                      <strong className="text-neutral-800 break-all">http://localhost:5000/api/auth/google/callback</strong>
                    </div>
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
                    >
                      <span>Open Google Cloud Console</span>
                      <ExternalLink size={12} />
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
