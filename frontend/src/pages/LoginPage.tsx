import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { AlertCircle, Loader2 } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { user, loginWithGoogle, loginWithEmail, error, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setLocalError("Please enter your Email ID");
      return;
    }
    if (!password) {
      setLocalError("Please enter your password");
      return;
    }

    setLocalError(null);
    clearError();
    setIsSubmitting(true);

    try {
      const ok = await loginWithEmail(email.trim(), password);
      if (ok) {
        window.location.href = "/dashboard";
      }
    } catch (err: any) {
      setLocalError(err?.message || "Failed to log in");
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = localError || error;

  return (
    <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] bg-white border border-gray-100 rounded-2xl p-8 sm:p-10 shadow-[0_4px_24px_rgba(0,0,0,0.04)] transition-all">
        <h1 className="text-3xl font-bold font-display text-gray-900 text-center tracking-tight mb-8">
          Login
        </h1>

        {displayError && (
          <div className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-100 text-red-700 text-sm flex items-start gap-2.5">
            <AlertCircle size={17} className="shrink-0 mt-0.5" />
            <div className="flex-1 leading-snug">{displayError}</div>
          </div>
        )}

        <button
          type="button"
          id="google-login-btn"
          onClick={loginWithGoogle}
          className="w-full h-12 px-5 rounded-xl bg-[#EAF7ED] hover:bg-[#dcf2e1] active:bg-[#d2edd8] flex items-center justify-center gap-3 text-sm font-semibold text-gray-800 transition cursor-pointer"
        >
          <svg className="w-4.5 h-4.5 shrink-0" viewBox="0 0 24 24">
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
          <span>Login with Google</span>
        </button>

        <div className="relative my-6.5 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-100"></div>
          </div>
          <div className="relative bg-white px-3.5 text-xs text-gray-400 font-medium">
            or sign up through email
          </div>
        </div>

        <form onSubmit={handleEmailLogin} className="flex flex-col gap-3.5">
          <div>
            <input
              type="email"
              id="login-email-input"
              placeholder="Email ID"
              className="w-full h-12 px-4 bg-[#F2F4F5] border border-transparent rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-emerald-500/10 transition"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <input
              type="password"
              id="login-password-input"
              placeholder="Password"
              className="w-full h-12 px-4 bg-[#F2F4F5] border border-transparent rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:bg-white focus:border-gray-300 focus:ring-2 focus:ring-emerald-500/10 transition"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <button
            type="submit"
            id="email-login-btn"
            disabled={isSubmitting}
            className="w-full h-12 mt-2 rounded-xl bg-[#009A49] hover:bg-[#008740] active:bg-[#007a39] text-white text-sm font-semibold flex items-center justify-center gap-2 transition cursor-pointer shadow-xs disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Logging in...</span>
              </>
            ) : (
              <span>Login</span>
            )}
          </button>
        </form>

        {user && (
          <div className="mt-6 pt-4 border-t border-gray-100 text-center">
            <span className="text-xs text-gray-400 block mb-1">
              Active session: <span className="font-semibold text-gray-700">{user.email}</span>
            </span>
            <a
              href="/dashboard"
              className="text-sm font-semibold text-emerald-600 hover:text-emerald-700 transition"
            >
              Continue to Dashboard →
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
