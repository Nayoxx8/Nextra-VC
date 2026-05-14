import prisma from "./prisma.js";

export async function checkSubscription(guildId: string, botName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ status: string; selectedBots: string[] }>>`
    SELECT status, "selectedBots" FROM nextra."GuildSubscription" WHERE "guildId" = ${guildId}
  `;
  if (!rows.length) return false;
  const row = rows[0]!;
  return row.status === "ACTIVE" && row.selectedBots.includes(botName);
}
