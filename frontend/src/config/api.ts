const envUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL: string = (
  envUrl && typeof envUrl === "string" && envUrl.trim() !== ""
    ? envUrl.trim().replace(/\/+$/, "")
    : import.meta.env.DEV
      ? "http://localhost:5000"
      : "https://mail-scheduler-pj6y.onrender.com"
);
