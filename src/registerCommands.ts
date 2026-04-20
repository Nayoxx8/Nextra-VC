import { Events, type Client, type Guild } from "discord.js";
import { setVcCreateCommand } from "./commands/setVcCreate.js";
import { resendPanelCommand } from "./commands/resendPanel.js";
import { setRecruitmentRoleCommand } from "./commands/setRecruitmentRole.js";

const DEFAULT_MAX_ATTEMPTS = 3;

type RegisterableGuild = Pick<Guild, "id" | "name" | "commands">;
const commandPayload = [
  setVcCreateCommand.toJSON(),
  resendPanelCommand.toJSON(),
  setRecruitmentRoleCommand.toJSON()
] as const;

const buildGuildLabel = (guild: Pick<RegisterableGuild, "id" | "name">): string =>
  `${guild.name} (${guild.id})`;

const registerCommandsForGuildWithRetry = async (
  guild: RegisterableGuild,
  maxAttempts: number
): Promise<{ success: boolean; attempts: number }> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await guild.commands.set(commandPayload);
      console.log(
        `[commandRegistration] guild=${buildGuildLabel(guild)} attempt=${attempt}/${maxAttempts} result=success`
      );
      return { success: true, attempts: attempt };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      const isFinalAttempt = attempt === maxAttempts;
      const result = isFinalAttempt ? "failure" : "retry";
      const log =
        `[commandRegistration] guild=${buildGuildLabel(guild)} ` +
        `attempt=${attempt}/${maxAttempts} result=${result} error=${message}`;

      if (isFinalAttempt) {
        console.error(log);
      } else {
        console.warn(log);
      }
    }
  }

  return { success: false, attempts: maxAttempts };
};

export const registerCommandsOnReady = (
  client: Client,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS
): void => {
  client.on(Events.ClientReady, async (readyClient) => {
    const guilds = [...readyClient.guilds.cache.values()];
    let successCount = 0;
    let failureCount = 0;

    for (const guild of guilds) {
      const result = await registerCommandsForGuildWithRetry(guild, maxAttempts);
      if (result.success) {
        successCount += 1;
      } else {
        failureCount += 1;
      }
    }

    console.log(
      `[commandRegistration][startup-summary] total=${guilds.length} success=${successCount} failure=${failureCount}`
    );
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.GuildCreate, async (guild) => {
    await registerCommandsForGuildWithRetry(guild, maxAttempts);
  });
};
