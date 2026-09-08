import "dotenv/config";
import nodemailer from "nodemailer";
import { mailer } from "../lib/mailer";

async function main() {
  const info = await mailer.sendMail({
    from: process.env.SMTP_USER,
    to: "test@example.com",
    subject: "Mail Scheduler SMTP Test",
    text: "This is a test email sent through Ethereal SMTP.",
  });

  console.log("Email accepted by Ethereal");
  console.log("Message ID:", info.messageId);

  const previewUrl = nodemailer.getTestMessageUrl(info);

  if (previewUrl) {
    console.log("Preview URL:", previewUrl);
  }
}

main().catch((error) => {
  console.error("Failed to send test email:", error);
  process.exitCode = 1;
});