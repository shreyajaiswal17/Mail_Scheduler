import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import {
  generateSlackOAuthState,
  buildSlackAuthorizeUrl,
  validateAndConsumeSlackState,
  exchangeSlackCode,
  saveSlackConnection,
  getSlackConnectionStatus,
  disconnectSlack,
} from "../services/slack.service";

const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

export const initiateSlackOAuth = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const state = await generateSlackOAuthState(userId);
    const url = buildSlackAuthorizeUrl(state);

    if (req.query.redirect === "true" || req.headers.accept?.includes("text/html")) {
      res.redirect(url);
      return;
    }

    res.status(200).json({ url, state });
  } catch (error: any) {
    console.error("[Slack Controller] Failed to initiate OAuth:", error?.message || error);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to initiate Slack authorization" });
  }
};

export const handleSlackCallback = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const { code, state, error, error_description } = req.query;
  const isHtmlClient = req.headers.accept?.includes("text/html");

  if (error) {
    const errorMsg = (error_description as string) || (error as string);
    console.warn(`[Slack Callback] OAuth error returned from Slack: ${errorMsg}`);

    if (isHtmlClient) {
      res.redirect(`${frontendUrl}/?slack=error&message=${encodeURIComponent(errorMsg)}`);
      return;
    }

    res.status(400).json({
      error: "OAuth Authorization Denied",
      message: errorMsg,
    });
    return;
  }

  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    if (isHtmlClient) {
      res.redirect(`${frontendUrl}/?slack=error&message=Missing+code+or+state`);
      return;
    }

    res.status(400).json({
      error: "Bad Request",
      message: "Missing authorization code or state parameter",
    });
    return;
  }

  try {
    const userId = await validateAndConsumeSlackState(state);
    if (!userId) {
      if (isHtmlClient) {
        res.redirect(`${frontendUrl}/?slack=error&message=Invalid+or+expired+state`);
        return;
      }

      res.status(400).json({
        error: "Invalid State",
        message: "OAuth state is invalid or has expired. Please try connecting again.",
      });
      return;
    }

    const oauthData = await exchangeSlackCode(code);
    const connection = await saveSlackConnection(userId, oauthData);

    if (isHtmlClient) {
      const teamParam = encodeURIComponent(connection.teamName || connection.teamId || "workspace");
      res.redirect(`${frontendUrl}/?slack=connected&team=${teamParam}`);
      return;
    }

    res.status(200).json({
      success: true,
      message: "Slack workspace connected successfully",
      teamId: connection.teamId,
      teamName: connection.teamName,
      connectedAt: connection.connectedAt,
    });
  } catch (err: any) {
    console.error("[Slack Callback] Failed to complete OAuth exchange:", err?.message || err);

    if (isHtmlClient) {
      res.redirect(`${frontendUrl}/?slack=error&message=${encodeURIComponent(err.message || "Exchange failed")}`);
      return;
    }

    res.status(500).json({
      error: "OAuth Exchange Failed",
      message: err.message || "Failed to exchange authorization code with Slack",
    });
  }
};

export const getSlackStatus = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const status = await getSlackConnectionStatus(userId);
    res.status(200).json(status);
  } catch (error: any) {
    console.error("[Slack Controller] Error fetching status:", error?.message || error);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to fetch Slack connection status" });
  }
};

export const disconnectSlackController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required" });
      return;
    }

    const disconnected = await disconnectSlack(userId);
    if (!disconnected) {
      res.status(404).json({ success: false, message: "No active Slack connection found" });
      return;
    }

    res.status(200).json({ success: true, message: "Slack disconnected successfully" });
  } catch (error: any) {
    console.error("[Slack Controller] Error disconnecting:", error?.message || error);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to disconnect Slack workspace" });
  }
};
