import "dotenv/config";
import { mailer } from "../lib/mailer";

async function main() {
  await mailer.verify();
  console.log("Ethereal SMTP connection successful");
}

main().catch((error) => {
  console.error("SMTP connection failed:", error);
  process.exitCode = 1;
});