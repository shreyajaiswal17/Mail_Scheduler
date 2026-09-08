import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Paperclip,
  Clock,
  Send,
  Upload,
  Calendar,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Undo,
  Redo,
  Type,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  List,
  Quote,
  Code,
  Strikethrough,
  ChevronDown,
  FileText,
} from "lucide-react";

export interface Sender {
  id: string;
  email: string;
  name: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ComposeEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  senders: Sender[];
  onScheduledSuccess?: () => void;
}

export const extractEmails = (text: string): string[] => {
  if (!text) return [];
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  return Array.from(new Set(matches.map((e) => e.trim().toLowerCase())));
};

const getDefaultStartTime = (): string => {
  const date = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const ComposeEmailModal: React.FC<ComposeEmailModalProps> = ({
  isOpen,
  onClose,
  senders,
  onScheduledSuccess,
}) => {
  const activeSenders = useMemo(
    () => senders.filter((s) => s.isActive && Boolean(s.smtpHost)),
    [senders]
  );

  const [senderId, setSenderId] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [recipientInput, setRecipientInput] = useState<string>("");
  const [recipientsList, setRecipientsList] = useState<string[]>([]);
  const [startTime, setStartTime] = useState<string>(getDefaultStartTime());
  const [delaySeconds, setDelaySeconds] = useState<string>("2");
  const [hourlyLimit, setHourlyLimit] = useState<string>("50");

  const [showSendLaterPopover, setShowSendLaterPopover] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<Array<{ name: string; size: string }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default to first active sender if available
  useEffect(() => {
    if (activeSenders.length > 0 && !senderId) {
      setSenderId(activeSenders[0].id);
    }
  }, [activeSenders, senderId]);

  if (!isOpen) return null;

  const handleAddRecipient = (value: string) => {
    const extracted = extractEmails(value);
    if (extracted.length > 0) {
      setRecipientsList((prev) => Array.from(new Set([...prev, ...extracted])));
      setRecipientInput("");
    }
  };

  const handleKeyDownRecipient = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      handleAddRecipient(recipientInput);
    }
  };

  const handleRemoveRecipient = (emailToRemove: string) => {
    setRecipientsList((prev) => prev.filter((r) => r !== emailToRemove));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = extractEmails(content);
        if (parsed.length > 0) {
          setRecipientsList((prev) => Array.from(new Set([...prev, ...parsed])));
        }
      }
    };
    reader.readAsText(file);
  };

  const handleSchedulePreset = (preset: "tomorrow" | "10am" | "11am" | "3pm") => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (preset === "10am") {
      d.setHours(10, 0, 0, 0);
    } else if (preset === "11am") {
      d.setHours(11, 0, 0, 0);
    } else if (preset === "3pm") {
      d.setHours(15, 0, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0);
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    setStartTime(`${year}-${month}-${day}T${hours}:${minutes}`);
    setShowSendLaterPopover(false);
  };

  const handleScheduleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    let finalRecipients = [...recipientsList];
    if (recipientInput.trim()) {
      const extra = extractEmails(recipientInput);
      finalRecipients = Array.from(new Set([...finalRecipients, ...extra]));
      setRecipientsList(finalRecipients);
      setRecipientInput("");
    }

    if (!senderId) {
      setSubmitError("Please select a configured sender.");
      return;
    }

    if (finalRecipients.length === 0) {
      setSubmitError("Please provide at least one valid recipient email.");
      return;
    }

    if (!subject.trim()) {
      setSubmitError("Subject is required.");
      return;
    }

    if (!body.trim()) {
      setSubmitError("Email body is required.");
      return;
    }

    const localStartDate = new Date(startTime);
    if (isNaN(localStartDate.getTime())) {
      setSubmitError("Please choose a valid start time.");
      return;
    }

    const delayMs = Math.round(Number(delaySeconds) * 1000);
    const parsedHourlyLimit = Number(hourlyLimit);

    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    setIsSubmitting(true);

    try {
      const res = await fetch("http://localhost:5000/api/emails/schedule", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          senderId,
          subject: subject.trim(),
          body: body.trim(),
          recipients: finalRecipients,
          startTime: localStartDate.toISOString(),
          delayMs: isNaN(delayMs) ? 2000 : delayMs,
          hourlyLimit: isNaN(parsedHourlyLimit) ? 50 : parsedHourlyLimit,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to schedule emails");
      }

      setSubmitSuccess(`Campaign scheduled for ${finalRecipients.length} recipient(s)!`);
      if (onScheduledSuccess) {
        onScheduledSuccess();
      }

      setTimeout(() => {
        onClose();
        setSubmitSuccess(null);
      }, 1200);
    } catch (err: any) {
      setSubmitError(err.message || "Unable to schedule email campaign.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl border border-gray-200 p-6 flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Top Header (Figma Screenshots 1-3) */}
        <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-md transition cursor-pointer"
              onClick={onClose}
              title="Back"
            >
              <ArrowLeft size={18} />
            </button>
            <h2 className="text-lg font-bold text-gray-900 m-0">Compose New Email</h2>
          </div>

          <div className="flex items-center gap-4 relative">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="p-1.5 text-gray-400 hover:text-gray-700 relative cursor-pointer"
                title={attachedFiles.length > 0 ? `Attachments (${attachedFiles.length})` : "Attach files"}
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.onchange = (e: any) => {
                    const files = Array.from(e.target.files || []) as File[];
                    if (files.length > 0) {
                      setAttachedFiles((prev) => [
                        ...prev,
                        ...files.map((f) => ({
                          name: f.name,
                          size: `${(f.size / (1024 * 1024)).toFixed(1)} MB`,
                        })),
                      ]);
                    }
                  };
                  input.click();
                }}
              >
                <Paperclip size={18} />
                {attachedFiles.length > 0 && (
                  <span className="absolute -top-0.5 -right-1 text-[10px] font-bold text-emerald-600">
                    {attachedFiles.length}
                  </span>
                )}
              </button>

              <button
                type="button"
                className="p-1.5 text-gray-400 hover:text-gray-700 cursor-pointer"
                title="Schedule Send"
                onClick={() => setShowSendLaterPopover(!showSendLaterPopover)}
              >
                <Clock size={18} />
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                className="bg-white border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-semibold text-xs px-4 py-2 rounded-full transition cursor-pointer"
                onClick={() => setShowSendLaterPopover(!showSendLaterPopover)}
                disabled={isSubmitting}
              >
                Send Later
              </button>

              <button
                type="button"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs px-4 py-2 rounded-full inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                onClick={() => handleScheduleSubmit()}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <>
                    <Send size={14} />
                    <span>Send</span>
                  </>
                )}
              </button>
            </div>

            {/* Send Later Popover (Figma Screenshot 3) */}
            {showSendLaterPopover && (
              <div className="absolute top-full right-0 mt-2 w-72 bg-white border border-gray-200 rounded-xl shadow-xl p-4 z-50 animate-fade-in">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-900 m-0">Send Later</h4>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-600 cursor-pointer p-0.5"
                    onClick={() => setShowSendLaterPopover(false)}
                  >
                    <X size={14} />
                  </button>
                </div>

                <div className="mb-3 relative flex items-center">
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:border-emerald-500 pr-8"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                  <Calendar size={15} className="absolute right-2.5 text-gray-400 pointer-events-none" />
                </div>

                <div className="flex flex-col gap-1 mb-4">
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-md cursor-pointer transition"
                    onClick={() => handleSchedulePreset("tomorrow")}
                  >
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-md cursor-pointer transition"
                    onClick={() => handleSchedulePreset("10am")}
                  >
                    Tomorrow, 10:00 AM
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-md cursor-pointer transition"
                    onClick={() => handleSchedulePreset("11am")}
                  >
                    Tomorrow, 11:00 AM
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50 rounded-md cursor-pointer transition"
                    onClick={() => handleSchedulePreset("3pm")}
                  >
                    Tomorrow, 3:00 PM
                  </button>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    className="text-xs text-gray-500 hover:text-gray-800 px-3 py-1 cursor-pointer"
                    onClick={() => setShowSendLaterPopover(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 font-semibold text-xs px-3.5 py-1 rounded-full cursor-pointer transition"
                    onClick={() => setShowSendLaterPopover(false)}
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Banners */}
        {submitError && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg text-xs bg-red-50 border border-red-200 text-red-700 animate-fade-in">
            <AlertCircle size={15} />
            <span>{submitError}</span>
          </div>
        )}
        {submitSuccess && (
          <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 animate-fade-in">
            <CheckCircle2 size={15} />
            <span>{submitSuccess}</span>
          </div>
        )}

        {/* Compose Form */}
        <div className="flex flex-col">
          {/* From Line */}
          <div className="flex items-center gap-4 py-2.5 border-b border-gray-100">
            <label className="w-14 text-xs font-semibold text-gray-400">From</label>
            <div className="inline-flex items-center bg-gray-50 border border-gray-200 rounded-full px-3 py-1 relative">
              <select
                className="appearance-none bg-transparent border-none text-xs font-medium text-gray-800 outline-none pr-5 cursor-pointer"
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                disabled={activeSenders.length === 0}
              >
                {activeSenders.length === 0 ? (
                  <option value="">No configured SMTP senders</option>
                ) : (
                  activeSenders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.email} {s.name ? `(${s.name})` : ""}
                    </option>
                  ))
                )}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* To Line */}
          <div className="flex items-start gap-4 py-2.5 border-b border-gray-100">
            <label className="w-14 text-xs font-semibold text-gray-400 pt-1">To</label>
            <div className="flex-1 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap flex-1">
                {recipientsList.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white border border-emerald-500 text-emerald-700 text-xs font-medium"
                  >
                    <span>{r}</span>
                    <button
                      type="button"
                      className="text-emerald-500 hover:text-emerald-800 p-0.5 cursor-pointer"
                      onClick={() => handleRemoveRecipient(r)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}

                <input
                  type="email"
                  className="flex-1 min-w-[160px] border-none outline-none text-xs text-gray-800 placeholder:text-gray-400"
                  placeholder={
                    recipientsList.length === 0
                      ? "recipient@example.com (comma or Enter to add)"
                      : "Add more..."
                  }
                  value={recipientInput}
                  onChange={(e) => setRecipientInput(e.target.value)}
                  onKeyDown={handleKeyDownRecipient}
                  onBlur={() => handleAddRecipient(recipientInput)}
                />
              </div>

              <div className="flex-shrink-0">
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.txt"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                <button
                  type="button"
                  className="text-xs font-semibold text-emerald-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={13} />
                  <span>Upload List</span>
                </button>
              </div>
            </div>
          </div>

          {/* Subject Line */}
          <div className="flex items-center gap-4 py-2.5 border-b border-gray-100">
            <label className="w-14 text-xs font-semibold text-gray-400">Subject</label>
            <input
              type="text"
              className="flex-1 border-none outline-none text-sm text-gray-900 placeholder:text-gray-400 font-medium"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          {/* Controls: Delay & Hourly Limit */}
          <div className="flex items-center gap-8 py-2.5 border-b border-gray-100 text-xs text-gray-600">
            <div className="flex items-center gap-2">
              <span>Delay between 2 emails</span>
              <input
                type="number"
                min="0"
                className="w-14 h-8 bg-white border border-gray-200 rounded-lg text-center text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500"
                placeholder="00"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <span>Hourly Limit</span>
              <input
                type="number"
                min="1"
                className="w-14 h-8 bg-white border border-gray-200 rounded-lg text-center text-xs font-semibold text-gray-800 outline-none focus:border-emerald-500"
                placeholder="00"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value)}
              />
            </div>
          </div>

          {/* Email Body & Rich Toolbar (Screenshots 1 & 2) */}
          <div className="bg-gray-50/80 border border-gray-200/80 rounded-xl p-4 mt-3.5 flex flex-col">
            <textarea
              className="w-full bg-transparent border-none outline-none text-sm text-gray-900 placeholder:text-gray-400 resize-none min-h-[170px] font-sans leading-relaxed"
              placeholder="Type Your Reply..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
            />

            {/* Bottom Toolbar */}
            <div className="bg-white border border-gray-200 rounded-full px-3.5 py-1.5 flex items-center gap-2 w-fit mt-3 shadow-xs">
              <div className="flex items-center gap-1">
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Undo">
                  <Undo size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Redo">
                  <Redo size={13} />
                </button>
              </div>

              <div className="w-[1px] h-3.5 bg-gray-200" />

              <div className="flex items-center gap-1">
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Font Style">
                  <Type size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer font-bold" title="Bold">
                  <Bold size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer italic" title="Italic">
                  <Italic size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer underline" title="Underline">
                  <Underline size={13} />
                </button>
              </div>

              <div className="w-[1px] h-3.5 bg-gray-200" />

              <div className="flex items-center gap-1">
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Align">
                  <AlignLeft size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="List">
                  <List size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Quote">
                  <Quote size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Code">
                  <Code size={13} />
                </button>
                <button type="button" className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded cursor-pointer" title="Strikethrough">
                  <Strikethrough size={13} />
                </button>
              </div>
            </div>
          </div>

          {/* Attached Files Preview */}
          {attachedFiles.length > 0 && (
            <div className="flex gap-3 mt-4 flex-wrap">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="w-36 bg-white border border-gray-200 rounded-lg overflow-hidden shadow-xs relative group">
                  <div className="w-full h-16 bg-gray-50 flex items-center justify-center text-gray-400 border-b border-gray-100">
                    <FileText size={24} className="text-gray-400" />
                  </div>
                  <div className="p-2 flex flex-col">
                    <span className="text-[11px] font-semibold text-gray-900 truncate">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-gray-400">{file.size}</span>
                  </div>
                  <button
                    type="button"
                    className="absolute top-1 right-1 p-1 bg-white/90 hover:bg-white rounded-full text-gray-400 hover:text-rose-600 shadow-xs transition cursor-pointer"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    title="Remove attachment"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
