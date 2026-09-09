import dotenv from "dotenv";
dotenv.config();

import { assertJwtSecret } from "./config/jwt";
assertJwtSecret();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma";
import authRoutes from "./routes/auth.routes";
import senderRoutes from "./routes/sender.routes";
import scheduleRoutes from "./routes/schedule.routes";
import adminQueuesRoutes from "./routes/admin-queues.routes";
import emailSearchRoutes from "./routes/email-search.routes";
import slackRoutes from "./routes/slack.routes";

const app = express();

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

app.use(
  cors({
    origin: [frontendUrl, "http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/auth", authRoutes);
app.use("/api/senders", senderRoutes);
app.use("/api/emails/schedule", scheduleRoutes);
app.use("/api/emails/search", emailSearchRoutes);
app.use("/api/emails", emailSearchRoutes);
app.use("/api/slack", slackRoutes);
app.use("/admin/queues", adminQueuesRoutes);

app.get("/", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Mail Scheduler API</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f9fafb; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
        .card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        h1 { font-size: 20px; font-weight: 700; margin: 0 0 12px 0; color: #111827; }
        p { font-size: 14px; color: #6b7280; line-height: 1.5; margin: 0 0 24px 0; }
        .badge { display: inline-block; background: #ecfdf5; color: #059669; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 9999px; margin-bottom: 16px; }
        ul { list-style: none; padding: 0; margin: 0; display: flex; flex-col; gap: 10px; flex-direction: column; }
        li a { display: block; padding: 12px 16px; background: #f3f4f6; border-radius: 10px; text-decoration: none; color: #374151; font-weight: 600; font-size: 14px; transition: background 0.15s; }
        li a:hover { background: #e5e7eb; color: #111827; }
        li a span { font-weight: 400; color: #9ca3af; font-size: 12px; display: block; margin-top: 2px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="badge">● API Server Active</div>
        <h1>Mail Scheduler Backend</h1>
        <p>This is the backend API server running on port 5000. Use the links below to access the application and tools:</p>
        <ul>
          <li>
            <a href="${frontendUrl}">
              Open Web Application
              <span>${frontendUrl}</span>
            </a>
          </li>
          <li>
            <a href="/admin/queues">
              Open Bull-Board Queues Dashboard
              <span>http://localhost:5000/admin/queues</span>
            </a>
          </li>
          <li>
            <a href="/health">
              API Health Status
              <span>/health</span>
            </a>
          </li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Mail Scheduler API is running",
  });
});

app.get("/health/db", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      database: "connected",
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected",
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});