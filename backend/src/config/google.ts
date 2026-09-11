import { OAuth2Client } from "google-auth-library";
import dotenv from "dotenv";

dotenv.config();

export const getGoogleClientId = (): string => process.env.GOOGLE_CLIENT_ID || "";
export const getGoogleClientSecret = (): string => process.env.GOOGLE_CLIENT_SECRET || "";
export const getGoogleCallbackUrl = (): string => {
  if (process.env.GOOGLE_CALLBACK_URL && process.env.GOOGLE_CALLBACK_URL.trim() !== "") {
    return process.env.GOOGLE_CALLBACK_URL.trim();
  }
  if (process.env.NODE_ENV === "production" || process.env.RENDER) {
    return "https://mail-scheduler-pj6y.onrender.com/api/auth/google/callback";
  }
  return "http://localhost:5000/api/auth/google/callback";
};

export const getOAuth2Client = (): OAuth2Client => {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const callbackUrl = getGoogleCallbackUrl();

  if (!clientId || !clientSecret) {
    console.warn(
      "[Auth Warning] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not defined in .env. Please configure them to enable Google OAuth."
    );
  }

  return new OAuth2Client(clientId, clientSecret, callbackUrl);
};
