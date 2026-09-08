import { Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { searchEmailQuerySchema } from "../validators/email-search.validator";
import { searchUserEmails } from "../services/email-search.service";

export const searchEmailsController = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

    const parsed = searchEmailQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: "Bad Request",
        message: "Invalid search query parameters",
        details: parsed.error.flatten(),
      });
      return;
    }

    const results = await searchUserEmails(userId, parsed.data);

    res.status(200).json({
      message: "Search completed successfully",
      ...results,
    });
  } catch (error: any) {
    console.error("[Email Search Controller] Search error:", error?.message || error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to perform email search",
    });
  }
};
