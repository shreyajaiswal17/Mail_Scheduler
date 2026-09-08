import React, { useState, useMemo, useEffect } from "react";
import {
  X,
  Send,
  Upload,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Users,
  Trash2,
  Calendar,
  Layers,
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
  const [manualInput, setManualInput] = useState<string>("");
  const [uploadedEmails, setUploadedEmails] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>(getDefaultStartTime());
  const [delaySeconds, setDelaySeconds] = useState<string>("2");
  const [hourlyLimit, setHourlyLimit] = useState<string>("50");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  // Default to first active sender if available
  useEffect(() => {
    if (activeSenders.length > 0 && !senderId) {
      setSenderId(activeSenders[0].id);
    }
  }, [activeSenders, senderId]);

  // Compute unified, normalized, and deduplicated recipient list
  const manualEmails = useMemo(() => extractEmails(manualInput), [manualInput]);

  const allRecipients = useMemo(() => {
    return Array.from(new Set([...uploadedEmails, ...manualEmails]));
  }, [uploadedEmails, manualEmails]);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const parsed = extractEmails(content);
        setUploadedEmails(parsed);
        setUploadedFileName(`${file.name} (${parsed.length} parsed)`);
      }
    };
    reader.readAsText(file);
  };

  const handleClearFile = () => {
    setUploadedEmails([]);
    setUploadedFileName(null);
  };

  const handleResetForm = () => {
    setSubject("");
    setBody("");
    setManualInput("");
    setUploadedEmails([]);
    setUploadedFileName(null);
    setStartTime(getDefaultStartTime());
    setDelaySeconds("2");
    setHourlyLimit("50");
    setSubmitError(null);
    setSubmitSuccess(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    // Validation
    if (!senderId) {
      setSubmitError("Please select a configured sender.");
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

    if (allRecipients.length === 0) {
      setSubmitError("Please provide at least one valid recipient email (via file upload or manual entry).");
      return;
    }

    if (allRecipients.length > 10000) {
      setSubmitError("Maximum 10,000 recipients allowed per campaign.");
      return;
    }

    const localStartDate = new Date(startTime);
    if (isNaN(localStartDate.getTime())) {
      setSubmitError("Please choose a valid start time.");
      return;
    }

    const delayMs = Math.round(Number(delaySeconds) * 1000);
    if (isNaN(delayMs) || delayMs < 0) {
      setSubmitError("Delay must be 0 or greater.");
      return;
    }

    const parsedHourlyLimit = Number(hourlyLimit);
    if (isNaN(parsedHourlyLimit) || parsedHourlyLimit <= 0) {
      setSubmitError("Hourly limit must be a positive integer.");
      return;
    }

    // Convert local start time to ISO UTC
    const isoUtcStartTime = localStartDate.toISOString();

    const token = localStorage.getItem("auth_token");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    setIsSubmitting(true);

    try {
      // NOTE: Do not send userId from the frontend (backend sets it from req.user)
      const res = await fetch("http://localhost:5000/api/emails/schedule", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          senderId,
          subject: subject.trim(),
          body: body.trim(),
          recipients: allRecipients,
          startTime: isoUtcStartTime,
          delayMs,
          hourlyLimit: parsedHourlyLimit,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.message || "Failed to schedule emails");
      }

      setSubmitSuccess(
        `Successfully scheduled ${data.totalEmails || allRecipients.length} email(s) via BullMQ!`
      );

      handleResetForm();

      if (onScheduledSuccess) {
        onScheduledSuccess();
      }

      setTimeout(() => {
        onClose();
        setSubmitSuccess(null);
      }, 1500);
    } catch (err: any) {
      setSubmitError(err.message || "Unable to schedule email campaign.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop animate-fade-in" onClick={onClose}>
      <div
        className="modal-container compose-modal-container"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-modal-title"
      >
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-icon-badge purple">
              <Send size={18} />
            </div>
            <div>
              <h3 id="compose-modal-title">Compose & Schedule Campaign</h3>
              <p>BullMQ will stagger dispatches with randomized jitter delays</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            title="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="modal-form compose-modal-form">
          {submitError && (
            <div className="modal-alert-error">
              <AlertCircle size={18} className="alert-icon" />
              <div className="alert-text">
                <strong>Scheduling Error</strong>
                <p>{submitError}</p>
              </div>
            </div>
          )}

          {submitSuccess && (
            <div className="modal-alert-success">
              <CheckCircle2 size={18} className="alert-icon" />
              <div className="alert-text">
                <strong>Campaign Queued</strong>
                <p>{submitSuccess}</p>
              </div>
            </div>
          )}

          {/* Sender Selection */}
          <div className="form-group">
            <label htmlFor="compose-sender" className="form-label">
              Sending Account (SMTP) <span className="required-star">*</span>
            </label>
            {activeSenders.length === 0 ? (
              <div className="sender-warning-box">
                <AlertCircle size={15} />
                <span>
                  No active SMTP sender found. Please configure an SMTP sender in the dashboard before scheduling.
                </span>
              </div>
            ) : (
              <select
                id="compose-sender"
                className="form-input"
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                disabled={isSubmitting}
                required
              >
                {senders.map((s) => {
                  const isReady = s.isActive && Boolean(s.smtpHost);
                  return (
                    <option key={s.id} value={s.id} disabled={!isReady}>
                      {s.name ? `${s.name} (${s.email})` : s.email}
                      {isReady ? " — Ready (SMTP)" : " — [Unconfigured SMTP]"}
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {/* Subject Line */}
          <div className="form-group">
            <label htmlFor="compose-subject" className="form-label">
              Subject Line <span className="required-star">*</span>
            </label>
            <input
              id="compose-subject"
              type="text"
              className="form-input"
              placeholder="e.g. Quick question regarding MailFlow outreach"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isSubmitting}
              required
              maxLength={255}
            />
          </div>

          {/* Email Body */}
          <div className="form-group">
            <label htmlFor="compose-body" className="form-label">
              Email Content (Body) <span className="required-star">*</span>
            </label>
            <textarea
              id="compose-body"
              className="form-input form-textarea"
              placeholder="Write your email body here..."
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={isSubmitting}
              required
            />
          </div>

          {/* Recipients Section (File Upload & Manual Entry) */}
          <div className="recipients-section">
            <div className="recipients-header">
              <label className="form-label">
                Recipients <span className="required-star">*</span>
              </label>
              <div className="recipient-counter-badge">
                <Users size={13} />
                <span>
                  <strong>{allRecipients.length}</strong> unique detected
                </span>
              </div>
            </div>

            {/* CSV / TXT Upload Box */}
            <div className="upload-dropzone">
              <input
                type="file"
                id="recipient-file-upload"
                accept=".csv, .txt, text/csv, text/plain"
                onChange={handleFileUpload}
                disabled={isSubmitting}
                className="file-input-hidden"
              />
              <label htmlFor="recipient-file-upload" className="file-upload-label">
                <Upload size={16} />
                <span>Upload CSV or TXT file</span>
              </label>

              {uploadedFileName && (
                <div className="uploaded-file-chip">
                  <FileText size={14} />
                  <span>{uploadedFileName}</span>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="file-remove-btn"
                    title="Remove file"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>

            {/* Manual Entry */}
            <textarea
              id="compose-recipients-manual"
              className="form-input form-textarea-recipients"
              placeholder="Or enter recipient emails manually (separated by commas, spaces, or newlines)..."
              rows={2}
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          {/* Scheduling Configuration Row */}
          <div className="form-row">
            {/* Start Time (Datetime Local) */}
            <div className="form-group flex-2">
              <label htmlFor="compose-start-time" className="form-label">
                <Calendar size={13} className="inline-icon" /> Start Time (Local) <span className="required-star">*</span>
              </label>
              <input
                id="compose-start-time"
                type="datetime-local"
                className="form-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                disabled={isSubmitting}
                required
              />
              <span className="field-hint">Auto-converted to ISO UTC on dispatch</span>
            </div>

            {/* Delay between emails */}
            <div className="form-group flex-1">
              <label htmlFor="compose-delay" className="form-label">
                <Clock size={13} className="inline-icon" /> Delay (sec) <span className="required-star">*</span>
              </label>
              <input
                id="compose-delay"
                type="number"
                min="0"
                step="1"
                className="form-input"
                value={delaySeconds}
                onChange={(e) => setDelaySeconds(e.target.value)}
                disabled={isSubmitting}
                required
              />
              <span className="field-hint">e.g. 2s = 2000ms delay</span>
            </div>

            {/* Hourly Limit */}
            <div className="form-group flex-1">
              <label htmlFor="compose-hourly-limit" className="form-label">
                <Layers size={13} className="inline-icon" /> Hourly Limit <span className="required-star">*</span>
              </label>
              <input
                id="compose-hourly-limit"
                type="number"
                min="1"
                step="1"
                className="form-input"
                value={hourlyLimit}
                onChange={(e) => setHourlyLimit(e.target.value)}
                disabled={isSubmitting}
                required
              />
              <span className="field-hint">Max emails / hour</span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="modal-footer">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn-submit btn-submit-purple"
              disabled={isSubmitting || activeSenders.length === 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Scheduling Campaign...</span>
                </>
              ) : (
                <>
                  <Send size={16} />
                  <span>Schedule {allRecipients.length > 0 ? `(${allRecipients.length})` : ""} Emails</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
