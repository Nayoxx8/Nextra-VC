import { ChannelType, type Client } from "discord.js";
import type { BotContext } from "../types.js";
import { shouldDeleteGeneratedChannel } from "../utils/voiceChannelCleanup.js";

const toBaseName = (channelName: string): string =>
  channelName.replace(/\s\d+$/, "");

export const reconcileGeneratedVcsOnStartup = async (
  client: Client,
  context: BotContext
): Promise<void> => {
  const records = await context.repo.listGeneratedVcs();
  const knownChannelIds = new Set(records.map((record) => record.channel_id));

  for (const record of records) {
    const guild = client.guilds.cache.get(record.guild_id);
    if (!guild) {
      await context.repo.deleteGeneratedVc(record.channel_id);
      continue;
    }

    const channel = await guild.channels.fetch(record.channel_id).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      await context.repo.deleteGeneratedVc(record.channel_id);
      knownChannelIds.delete(record.channel_id);
      continue;
    }

    const occupants = Array.from(channel.members.values()).map((member) => ({
      isBot: member.user.bot
    }));

    if (shouldDeleteGeneratedChannel(occupants)) {
      try {
        await channel.delete("Cleanup empty generated VC found at startup");
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(
          `[startup-reconcile] Failed to delete empty VC ${channel.id}: ${message}`
        );
      }
      await context.repo.deleteGeneratedVc(record.channel_id);
      knownChannelIds.delete(record.channel_id);
      continue;
    }

    knownChannelIds.add(record.channel_id);
  }

};
