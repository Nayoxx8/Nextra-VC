import {
  ChannelType,
  Events,
  type Client,
  type Guild,
  type VoiceChannel,
  type VoiceState
} from "discord.js";
import {
  buildGeneratedVcPermissionOverwrites,
  filterPermissionOverwritesByResolvableTargets,
  isInvalidOverwriteTargetError,
  runWithCategoryLock
} from "./services/generatedVcService.js";
import { buildBaseChannelName, resolveUniqueChannelName } from "./utils/channelNaming.js";
import { shouldDeleteGeneratedChannel } from "./utils/voiceChannelCleanup.js";
import type { BotContext } from "./types.js";

const CLEANUP_RETRY_DELAY_MS = 10_000;
const CLEANUP_MAX_RETRIES = 3;
const cleanupRetryCounts = new Map<string, number>();
const UNKNOWN_CHANNEL_ERROR_CODE = 10003;

const isUnknownChannelError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" && code === UNKNOWN_CHANNEL_ERROR_CODE;
};

type RollbackCapableChannel = {
  id: string;
  delete: (reason?: string) => Promise<unknown>;
};

type CreateChannelOptions = Parameters<Guild["channels"]["create"]>[0];

const resolveGuildBitrateCap = (guild: Guild): number | null => {
  const bitrate = Reflect.get(guild, "maximumBitrate");
  if (typeof bitrate !== "number" || !Number.isFinite(bitrate) || bitrate <= 0) {
    return null;
  }

  return bitrate;
};

const isBitrateOptionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = Reflect.get(error, "message");
  if (typeof message === "string" && message.toLowerCase().includes("bitrate")) {
    return true;
  }

  const rawError = Reflect.get(error, "rawError");
  const rawErrors =
    rawError && typeof rawError === "object" ? Reflect.get(rawError, "errors") : null;

  return Boolean(rawErrors && typeof rawErrors === "object" && Reflect.has(rawErrors, "bitrate"));
};

const createVoiceChannelWithSafeBitrate = async (
  guild: Guild,
  createOptions: CreateChannelOptions,
  ownerUserId: string
): Promise<VoiceChannel> => {
  const bitrateCap = resolveGuildBitrateCap(guild);
  if (bitrateCap === null) {
    return (await guild.channels.create(createOptions)) as unknown as VoiceChannel;
  }

  try {
    return (await guild.channels.create({
      ...createOptions,
      bitrate: bitrateCap
    })) as unknown as VoiceChannel;
  } catch (error) {
    if (!isBitrateOptionError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(
      `[voiceStateUpdate] bitrate option rejected and retrying VC create without bitrate: ownerUserId=${ownerUserId} reason=${message}`
    );

    return (await guild.channels.create(createOptions)) as unknown as VoiceChannel;
  }
};

export const deleteGeneratedChannelAndRecord = async (
  deleteChannel: () => Promise<void>,
  deleteRecord: () => Promise<void>
): Promise<boolean> => {
  try {
    await deleteChannel();
    await deleteRecord();
    return true;
  } catch (error) {
    if (isUnknownChannelError(error)) {
      try {
        await deleteRecord();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
};

export const persistGeneratedVcOrRollback = async (
  channel: RollbackCapableChannel,
  upsertGeneratedVc: () => Promise<void>
): Promise<boolean> => {
  try {
    await upsertGeneratedVc();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(
      `[voiceStateUpdate] Failed to upsert generated VC record for ${channel.id}: ${message}`
    );

    try {
      await channel.delete("Rollback generated VC because DB upsert failed");
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : "unknown error";
      console.error(
        `[voiceStateUpdate] Failed to rollback orphan VC ${channel.id} after DB upsert failure: ${rollbackMessage}`
      );
    }

    return false;
  }
};

const createFromHubIfNeeded = async (
  state: VoiceState,
  context: BotContext
): Promise<void> => {
  if (!state.channelId || !state.guild || state.member?.user.bot) {
    return;
  }

  const hub = await context.repo.findHubByCreatorChannel(state.channelId);
  if (!hub) {
    return;
  }

  const guild = state.guild;

  await runWithCategoryLock(guild.id, hub.category_id, async () => {
    const category = guild.channels.cache.get(hub.category_id);

    const siblingNames =
      category?.type === ChannelType.GuildCategory
        ? category.children.cache
            .filter((child): child is VoiceChannel => child.type === ChannelType.GuildVoice)
            .map((voice) => voice.name)
        : [];

    const [pref, accessLists] = await Promise.all([
      context.repo.getOrCreateUserPreference(state.id, context.defaults),
      context.repo.getAccessControlLists(state.id)
    ]);
    const baseName = buildBaseChannelName(pref.icon, pref.name);
    const channelName = resolveUniqueChannelName(siblingNames, baseName);

    const initialPermissionOverwrites = buildGeneratedVcPermissionOverwrites(
      guild,
      state.id,
      pref.is_private,
      accessLists
    );

    let created: VoiceChannel;
    const createStartedAt = Date.now();
    try {
      created = await createVoiceChannelWithSafeBitrate(guild, {
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: hub.category_id,
        userLimit: pref.user_limit,
        permissionOverwrites: initialPermissionOverwrites,
        reason: "Create user voice channel from hub"
      }, state.id);
    } catch (error) {
      if (!isInvalidOverwriteTargetError(error)) {
        throw error;
      }

      const {
        permissionOverwrites,
        removedTargetCount,
        removedBlacklistCount,
        resolvedByFetchCount,
        hasRetryBlockingFailure
      } = await filterPermissionOverwritesByResolvableTargets(
        guild,
        initialPermissionOverwrites,
        new Set(accessLists.blacklist)
      );

      if (hasRetryBlockingFailure) {
        console.warn(
          `[voiceStateUpdate] skip overwrite-filter fallback because role/member fetch had temporary or indeterminate failure(s): ownerUserId=${state.id}`
        );
        throw error;
      }

      const retryStartedAt = Date.now();
      const retryStartElapsedMs = retryStartedAt - createStartedAt;

      console.warn(
        `[voiceStateUpdate] filtered ${removedTargetCount} unresolved overwrite target(s) (blacklist removed=${removedBlacklistCount}, resolvedByFetch=${resolvedByFetchCount}) and retrying VC create once: ownerUserId=${state.id} totalElapsedMs=${retryStartElapsedMs} retryElapsedMs=0`
      );

      try {
        created = await createVoiceChannelWithSafeBitrate(guild, {
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: hub.category_id,
          userLimit: pref.user_limit,
          permissionOverwrites,
          reason: "Create user voice channel from hub (retry filtered overwrites)"
        }, state.id);
      } catch (retryError) {
        const totalElapsedMs = Date.now() - createStartedAt;
        const retryElapsedMs = Date.now() - retryStartedAt;
        const retryMessage = retryError instanceof Error ? retryError.message : "unknown error";
        console.error(
          `[voiceStateUpdate] overwrite-filter retry failed: ownerUserId=${state.id} totalElapsedMs=${totalElapsedMs} retryElapsedMs=${retryElapsedMs} reason=${retryMessage}`
        );
        throw retryError;
      }

      const totalElapsedMs = Date.now() - createStartedAt;
      const retryElapsedMs = Date.now() - retryStartedAt;
      console.info(
        `[voiceStateUpdate] overwrite-filter retry succeeded: ownerUserId=${state.id} totalElapsedMs=${totalElapsedMs} retryElapsedMs=${retryElapsedMs}`
      );
    }

    const persisted = await persistGeneratedVcOrRollback(created, () =>
      context.repo.upsertGeneratedVc({
        channel_id: created.id,
        guild_id: guild.id,
        owner_user_id: state.id,
        base_name: baseName
      })
    );

    if (!persisted) {
      return;
    }

    await state.setChannel(created).catch(async (error) => {
      try {
        await created.delete("Move to generated VC failed");
        await context.repo.deleteGeneratedVc(created.id);
      } catch {
        const message = error instanceof Error ? error.message : "unknown error";
        console.error(
          `[voiceStateUpdate] Failed to rollback generated VC ${created.id}; DB record kept for reconciliation. reason=${message}`
        );
      }
    });
  });
};

const retryCleanup = (
  guild: Guild,
  channelId: string,
  context: BotContext,
  reason: string
): void => {
  const attempt = (cleanupRetryCounts.get(channelId) ?? 0) + 1;
  if (attempt > CLEANUP_MAX_RETRIES) {
    console.error(
      `[voiceStateUpdate] cleanup retry exhausted for ${channelId}. DB record retained for startup reconciliation.`
    );
    cleanupRetryCounts.delete(channelId);
    return;
  }

  cleanupRetryCounts.set(channelId, attempt);
  console.warn(
    `[voiceStateUpdate] cleanup retry scheduled (${attempt}/${CLEANUP_MAX_RETRIES}) for ${channelId}: ${reason}`
  );

  setTimeout(async () => {
    try {
      const fetched = await guild.channels.fetch(channelId).catch(() => null);
      if (!fetched || fetched.type !== ChannelType.GuildVoice) {
        await context.repo.deleteGeneratedVc(channelId);
        cleanupRetryCounts.delete(channelId);
        return;
      }

      const occupants = Array.from(fetched.members.values()).map((member) => ({
        isBot: member.user.bot
      }));

      if (!shouldDeleteGeneratedChannel(occupants)) {
        cleanupRetryCounts.delete(channelId);
        return;
      }

      try {
        await fetched.delete("Generated VC cleanup retry");
      } catch (deleteError) {
        if (!isUnknownChannelError(deleteError)) {
          throw deleteError;
        }
      }

      await context.repo.deleteGeneratedVc(channelId);
      cleanupRetryCounts.delete(channelId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      retryCleanup(guild, channelId, context, message);
    }
  }, CLEANUP_RETRY_DELAY_MS);
};

const cleanupGeneratedIfNeeded = async (
  state: VoiceState,
  context: BotContext
): Promise<void> => {
  if (!state.channelId || !state.guild) {
    return;
  }

  const generated = await context.repo.findGeneratedVcByChannel(state.channelId);
  if (!generated) {
    return;
  }

  const channelId = state.channelId;

  const channel = state.guild.channels.cache.get(state.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    await context.repo.deleteGeneratedVc(state.channelId);
    return;
  }

  const occupants = Array.from(channel.members.values()).map((member) => ({
    isBot: member.user.bot
  }));

  if (!shouldDeleteGeneratedChannel(occupants)) {
    return;
  }

  const deleted = await deleteGeneratedChannelAndRecord(
    async () => {
      await channel.delete("Generated VC became empty or bot-only");
    },
    () => context.repo.deleteGeneratedVc(channelId)
  );

  if (deleted) {
    cleanupRetryCounts.delete(channelId);
    return;
  }

  console.error(
    `[voiceStateUpdate] Failed to delete generated VC ${channelId}; DB record retained.`
  );
  retryCleanup(state.guild, channelId, context, "delete failed");
};

export const registerVoiceStateHandler = (
  client: Client,
  context: BotContext
): void => {
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      if (oldState.channelId && oldState.channelId !== newState.channelId) {
        await cleanupGeneratedIfNeeded(oldState, context);
      }

      if (newState.channelId && newState.channelId !== oldState.channelId) {
        await createFromHubIfNeeded(newState, context);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[voiceStateUpdate] ${message}`);
    }
  });
};
