import dotenv from "dotenv";

dotenv.config();

export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Fatal configuration error: JWT_SECRET environment variable is missing or empty. A valid JWT_SECRET must be configured in .env."
    );
  }
  return secret;
};

export const assertJwtSecret = (): void => {
  try {
    getJwtSecret();
  } catch (error: any) {
    console.error(`\n[FATAL STARTUP ERROR] ${error.message}\n`);
    throw error;
  }
};
