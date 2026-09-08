import dotenv from "dotenv";

dotenv.config();

/**
 * Retrieves the required JWT_SECRET environment variable.
 * Throws a fatal error if the variable is missing or empty.
 */
export const getJwtSecret = (): string => {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "Fatal configuration error: JWT_SECRET environment variable is missing or empty. A valid JWT_SECRET must be configured in .env."
    );
  }
  return secret;
};

/**
 * Validates that JWT_SECRET is configured at server startup.
 * Fails fast with a clear diagnostic message if missing.
 */
export const assertJwtSecret = (): void => {
  try {
    getJwtSecret();
  } catch (error: any) {
    console.error(`\n[FATAL STARTUP ERROR] ${error.message}\n`);
    throw error;
  }
};
