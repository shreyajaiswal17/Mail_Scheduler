import "dotenv/config";
import nodemailer from "nodemailer";

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT || 587);
const user = process.env.SMTP_USER;
const password = process.env.SMTP_PASSWORD;

if (!host || !user || !password) {
  throw new Error("SMTP configuration is missing");
}

export const mailer = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: {
    user,
    pass: password,
  },
});