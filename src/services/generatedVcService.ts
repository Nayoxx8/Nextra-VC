import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type OverwriteData,
  type VoiceBasedChannel
} from "discord.js";
import {
  buildBaseChannelName,
  resolveUniqueChannelNameExcludingSelf
} from "../utils/channelNaming.js";
import type { BotContext } from "../types.js";

const categoryLocks = new Map<string, Promise<void>>();

const categoryLockKey = (guildId: string, categoryId: string | null): string =>
  `${guildId}:${categoryId ?? "no-category"}`;

const UNKNOWN_CHANNEL_ERROR_CODE = 10003;
const UNKNOWN_MEMBER_ERROR_CODE = 10007;
const UNKNOWN_ROLE_ERROR_CODE = 10011;
const UNKNOWN_USER_ERROR_CODE = 10013;
const TRANSIENT_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET"
]);

const isUnknownChannelError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" && code === UNKNOWN_CHANNEL_ERROR_CODE;
};

export const isInvalidOverwriteTargetError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("Supplied parameter is not a cached User or Role");
};

const hasCachedOverwriteTarget = (guild: Guild, targetId: string): boolean => {
  if (targetId === guild.roles.everyone.id) {
    return true;
  }

  if (guild.roles.cache.has(targetId)) {
    return true;
  }

  return guild.members.cache.has(targetId);
};

const isUnknownOverwriteTargetError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = Reflect.get(error, "code");
  return (
    typeof code === "number" &&
    (code === UNKNOWN_MEMBER_ERROR_CODE ||
      code === UNKNOWN_ROLE_ERROR_CODE ||
      code === UNKNOWN_USER_ERROR_CODE)
  );
};

const isTransientFetchError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = Reflect.get(error, "status");
  if (typeof status === "number" && (status === 429 || status >= 500)) {
    return true;
  }

  const code = Reflect.get(error, "code");
  if (typeof code === "string" && TRANSIENT_NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const name = Reflect.get(error, "name");
  if (name === "AbortError") {
    return true;
  }

  const message = Reflect.get(error, "message");
  if (typeof message === "string" && /network|timeout|timed out/i.test(message)) {
    return true;
  }

  return false;
};

const isRetryBlockingFetchError = (error: unknown): boolean => {
  if (isUnknownOverwriteTargetError(error)) {
    return false;
  }

  return isTransientFetchError(error) || error instanceof Error || typeof error === "object";
};

const canResolveOverwriteTarget = async (
  guild: Guild,
  targetId: string
): Promise<{ resolved: boolean; resolvedByFetch: boolean; hasRetryBlockingFailure: boolean }> => {
  if (hasCachedOverwriteTarget(guild, targetId)) {
    return { resolved: true, resolvedByFetch: false, hasRetryBlockingFailure: false };
  }

  let hasRetryBlockingFailure = false;

  try {
    const role = await guild.roles.fetch(targetId);
    if (role) {
      return { resolved: true, resolvedByFetch: true, hasRetryBlockingFailure };
    }
  } catch (error) {
    if (isRetryBlockingFetchError(error)) {
      hasRetryBlockingFailure = true;
    }
  }

  try {
    const member = await guild.members.fetch(targetId);
    if (member) {
      return { resolved: true, resolvedByFetch: true, hasRetryBlockingFailure };
    }
  } catch (error) {
    if (isRetryBlockingFetchError(error)) {
      hasRetryBlockingFailure = true;
    }
  }

  return { resolved: false, resolvedByFetch: false, hasRetryBlockingFailure };
};

export const filterPermissionOverwritesByResolvableTargets = async (
  guild: Guild,
  permissionOverwrites: OverwriteData[],
  blacklistUserIds: ReadonlySet<string>
): Promise<{
  permissionOverwrites: OverwriteData[];
  removedTargetCount: number;
  removedBlacklistCount: number;
  resolvedByFetchCount: number;
  hasRetryBlockingFailure: boolean;
}> => {
  const filtered: OverwriteData[] = [];
  let removedTargetCount = 0;
  let removedBlacklistCount = 0;
  let resolvedByFetchCount = 0;
  let hasRetryBlockingFailure = false;

  for (const overwrite of permissionOverwrites) {
    const targetId = overwrite.id.toString();
    const { resolved, resolvedByFetch, hasRetryBlockingFailure: targetHasRetryBlockingFailure } =
      await canResolveOverwriteTarget(guild, targetId);

    if (targetHasRetryBlockingFailure) {
      hasRetryBlockingFailure = true;
    }

    if (!resolved) {
      removedTargetCount += 1;
      if (blacklistUserIds.has(targetId)) {
        removedBlacklistCount += 1;
      }
      continue;
    }

    if (resolvedByFetch) {
      resolvedByFetchCount += 1;
    }

    filtered.push(overwrite);
  }

  return {
    permissionOverwrites: filtered,
    removedTargetCount,
    removedBlacklistCount,
    resolvedByFetchCount,
    hasRetryBlockingFailure
  };
};

export const runWithCategoryLock = async <T>(
  guildId: string,
  categoryId: string | null,
  task: () => Promise<T>
): Promise<T> => {
  const key = categoryLockKey(guildId, categoryId);
  const previous = categoryLocks.get(key) ?? Promise.resolve();

  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const lockTail = previous.then(() => next);
  categoryLocks.set(key, lockTail);

  await previous;
  try {
    return await task();
  } finally {
    release?.();
    if (categoryLocks.get(key) === lockTail) {
      categoryLocks.delete(key);
    }
  }
};

export const buildGeneratedVcPermissionOverwrites = (
  guild: Guild,
  ownerUserId: string,
  isPrivate: boolean,
  accessLists: { whitelist: string[]; blacklist: string[] }
): OverwriteData[] => {
  const blacklist = new Set(accessLists.blacklist);
  const whitelist = accessLists.whitelist.filter(
    (userId) => !blacklist.has(userId) && userId !== ownerUserId
  );

  const overwrites: OverwriteData[] = [];

  if (isPrivate) {
    overwrites.push({
      id: guild.roles.everyone.id,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]
    });

    overwrites.push({
      id: ownerUserId,
      type: OverwriteType.Member,
      allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]
    });

    for (const userId of whitelist) {
      overwrites.push({
        id: userId,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]
      });
    }
  }

  for (const userId of blacklist) {
    overwrites.push({
      id: userId,
      type: OverwriteType.Member,
      deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel]
    });
  }

  return overwrites;
};

export const renameOwnedGeneratedVcIfConnected = async (
  guild: Guild,
  userId: string,
  context: BotContext
): Promise<string | null> => {
  const member = await guild.members.fetch(userId).catch(() => null);
  const activeChannel = member?.voice.channel;

  if (!activeChannel || activeChannel.type !== ChannelType.GuildVoice) {
    return null;
  }

  const generated = await context.repo.findGeneratedVcByChannel(activeChannel.id);
  if (!generated || generated.owner_user_id !== userId) {
    return null;
  }

  const pref = await context.repo.getOrCreateUserPreference(userId, context.defaults);
  const accessLists = await context.repo.getAccessControlLists(userId);
  const baseName = buildBaseChannelName(pref.icon, pref.name);

  return runWithCategoryLock(guild.id, activeChannel.parentId, async () => {
    const siblingChannels = activeChannel.parent?.children.cache.filter(
      (child): child is VoiceBasedChannel => child.type === ChannelType.GuildVoice
    );
    const siblingChannelList = siblingChannels
      ? Array.from(siblingChannels.values())
      : [];

    const nextName = resolveUniqueChannelNameExcludingSelf(
      siblingChannelList.map((voice) => ({ id: voice.id, name: voice.name })),
      baseName,
      activeChannel.id
    );

    if (activeChannel.name !== nextName) {
      try {
        await activeChannel.setName(nextName, "Apply latest user VC settings");
      } catch (error) {
        if (isUnknownChannelError(error)) {
          console.warn(
            `[generatedVcService] skip rename sync because channel is already gone: channelId=${activeChannel.id}`
          );
          return null;
        }

        throw error;
      }
    }

    if (activeChannel.userLimit !== pref.user_limit) {
      try {
        await activeChannel.setUserLimit(pref.user_limit, "Apply latest user VC settings");
      } catch (error) {
        if (isUnknownChannelError(error)) {
          console.warn(
            `[generatedVcService] skip user-limit sync because channel is already gone: channelId=${activeChannel.id}`
          );
          return null;
        }

        throw error;
      }
    }

    try {
      await activeChannel.permissionOverwrites.set(
        buildGeneratedVcPermissionOverwrites(guild, userId, pref.is_private, accessLists),
        "Apply latest user VC settings"
      );
    } catch (error) {
      if (isUnknownChannelError(error)) {
        console.warn(
          `[generatedVcService] skip permission sync because channel is already gone: channelId=${activeChannel.id}`
        );
        return null;
      }

      if (!isInvalidOverwriteTargetError(error)) {
        throw error;
      }

      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(
        `[generatedVcService] ignored invalid overwrite target while syncing permissions: channelId=${activeChannel.id} ownerUserId=${userId} message=${message}`
      );
    }

    await context.repo.updateGeneratedVcBaseName(activeChannel.id, baseName);
    return nextName;
  });
};
