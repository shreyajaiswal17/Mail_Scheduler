const envUrl = import.meta.env.VITE_API_BASE_URL;

export const API_BASE_URL: string = (
  envUrl && typeof envUrl === "string" && envUrl.trim() !== ""
    ? envUrl.trim().replace(/\/+$/, "")
    : "http://localhost:5000"
);
