import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getDecryptedBotToken } from "../services/slack.service";

async function main() {
  const user = await prisma.user.findFirst({ where: { email: "codex1712@gmail.com" } });
  if (!user) return console.log("No user");
  const token = await getDecryptedBotToken(user.id);
  const res = await fetch("https://slack.com/api/conversations.list?types=public_channel,private_channel", {
    headers: { Authorization: "Bearer " + token },
  });
  const data = await res.json();
  console.log("Channels:", data.channels?.map((c: any) => ({ name: c.name, id: c.id, is_member: c.is_member })));
}

main().catch(console.error);
