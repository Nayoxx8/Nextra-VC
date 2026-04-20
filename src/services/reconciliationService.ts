import { ChannelType, type Client } from "discord.js";
import type { BotContext } from "../types.js";
import { shouldDeleteGeneratedChannel } from "../utils/voiceChannelCleanup.js";

const MANAGED_VC_PREFIX = "✧";

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

  const hubs = await context.repo.listHubs();

  for (const hub of hubs) {
    const guild = client.guilds.cache.get(hub.guild_id);
    if (!guild) {
      continue;
    }

    const channels = await guild.channels.fetch();
    const orphanCandidates = channels.filter(
      (channel) =>
        channel?.type === ChannelType.GuildVoice &&
        channel.parentId === hub.category_id &&
        channel.id !== hub.creator_voice_channel_id &&
        channel.name.startsWith(MANAGED_VC_PREFIX) &&
        !knownChannelIds.has(channel.id)
    );

    for (const channel of orphanCandidates.values()) {
      if (!channel || channel.type !== ChannelType.GuildVoice) {
        continue;
      }

      const occupants = Array.from(channel.members.values()).map((member) => ({
        isBot: member.user.bot
      }));

      if (shouldDeleteGeneratedChannel(occupants)) {
        try {
          await channel.delete("Cleanup unmanaged generated VC found at startup");
        } catch (error) {
          const message = error instanceof Error ? error.message : "unknown error";
          console.error(
            `[startup-reconcile] Failed to delete unmanaged VC ${channel.id}: ${message}`
          );
        }
        continue;
      }

      const owner = channel.members.find((member) => !member.user.bot);
      if (!owner) {
        continue;
      }

      try {
        await context.repo.upsertGeneratedVc({
          channel_id: channel.id,
          guild_id: guild.id,
          owner_user_id: owner.id,
          base_name: toBaseName(channel.name)
        });
        knownChannelIds.add(channel.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(
          `[startup-reconcile] Failed to re-register unmanaged VC ${channel.id}: ${message}`
        );
      }
    }
  }
};
