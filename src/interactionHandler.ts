import {
  ChannelType,
  Events,
  GuildMember,
  type InteractionReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction
} from "discord.js";
import { executeSetVcCreate } from "./commands/setVcCreate.js";
import { executeResendPanel } from "./commands/resendPanel.js";
import { executeSetRecruitmentRole } from "./commands/setRecruitmentRole.js";
import { executeSendRecruitmentPanel } from "./commands/sendRecruitmentPanel.js";
import {
  ACCESS_LIST_ADD_SELECT_PREFIX,
  ACCESS_LIST_LABELS,
  ACCESS_LIST_REMOVE_SELECT_PREFIX,
  MANAGE_BLACKLIST_OPTION_VALUE,
  MANAGE_WHITELIST_OPTION_VALUE,
  buildAccessListManagementComponents,
  buildNameEditModal,
  buildUserLimitEditModal,
  ICON_BUTTON_PREFIX,
  ICON_PRESETS,
  LIMIT_BUTTON_PREFIX,
  LIMIT_CUSTOM_BUTTON_ID,
  LIMIT_INPUT_ID,
  LIMIT_MODAL_ID,
  NAME_BUTTON_ID,
  NAME_INPUT_ID,
  NAME_MODAL_ID,
  OTHER_SETTINGS_BUTTON_ID,
  OTHER_SETTINGS_SELECT_ID,
  buildOtherSettingsSelect,
  type AccessListSelectOption,
  TOGGLE_PRIVATE_OPTION_VALUE
} from "./panels/settingsPanel.js";
import {
  TEMPLATE_BUTTON_ID,
  TEMPLATE_APPLY_SELECT_ID,
  TEMPLATE_SAVE_BUTTON_ID,
  TEMPLATE_SAVE_SLOT_SELECT_ID,
  TEMPLATE_SAVE_MODAL_PREFIX,
  TEMPLATE_SAVE_NAME_INPUT_ID,
  TEMPLATE_DELETE_SELECT_ID,
  buildTemplatePanelEmbed,
  buildTemplateApplySelect,
  buildTemplateSaveButton,
  buildTemplateDeleteSelect,
  buildTemplateSaveSlotSelect,
  buildTemplateSaveModal
} from "./panels/templatePanel.js";
import { renameOwnedGeneratedVcIfConnected } from "./services/generatedVcService.js";
import { RECRUIT_BUTTON_ID, RECRUIT_MODAL_ID, RECRUIT_INPUT_ID, buildRecruitModal } from "./panels/recruitmentPanel.js";
import { getJstTimeSlot } from "./utils/timeSlot.js";
import type { AccessListKind, BotContext, VcTemplateRecord } from "./types.js";

const UNKNOWN_INTERACTION_ERROR_CODE = 10062;
type ModalDefaultsCacheEntry = {
  name?: string;
  userLimit?: number;
};

const modalDefaultsCache = new Map<string, ModalDefaultsCacheEntry>();
const inFlightSettingsPanelUsers = new Set<string>();

type SettingsPanelInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

const ACCESS_LIST_OPTION_VALUES: Record<string, AccessListKind> = {
  [MANAGE_WHITELIST_OPTION_VALUE]: "whitelist",
  [MANAGE_BLACKLIST_OPTION_VALUE]: "blacklist"
};

const SETTINGS_PANEL_EXACT_CUSTOM_IDS = new Set<string>([
  NAME_BUTTON_ID,
  LIMIT_CUSTOM_BUTTON_ID,
  OTHER_SETTINGS_BUTTON_ID,
  OTHER_SETTINGS_SELECT_ID,
  NAME_MODAL_ID,
  LIMIT_MODAL_ID,
  TEMPLATE_BUTTON_ID,
  TEMPLATE_APPLY_SELECT_ID,
  TEMPLATE_SAVE_BUTTON_ID,
  TEMPLATE_SAVE_SLOT_SELECT_ID,
  TEMPLATE_DELETE_SELECT_ID
]);

const SETTINGS_PANEL_CUSTOM_ID_PREFIXES = [
  ICON_BUTTON_PREFIX,
  LIMIT_BUTTON_PREFIX,
  ACCESS_LIST_ADD_SELECT_PREFIX,
  ACCESS_LIST_REMOVE_SELECT_PREFIX,
  TEMPLATE_SAVE_MODAL_PREFIX
];

const isUnknownInteractionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = Reflect.get(error, "code");
  return typeof code === "number" && code === UNKNOWN_INTERACTION_ERROR_CODE;
};

const sendSafeInteractionResponse = async (
  interaction: Interaction,
  options: InteractionReplyOptions
): Promise<void> => {
  if (!interaction.isRepliable()) {
    return;
  }

  if (interaction.deferred) {
    const editOptions: Omit<InteractionReplyOptions, "flags"> = { ...options };
    Reflect.deleteProperty(editOptions, "flags");
    await interaction.editReply(editOptions);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(options);
    return;
  }

  await interaction.reply(options);
};

const handleSetVcCreate = async (
  interaction: ChatInputCommandInteraction,
  context: BotContext
): Promise<void> => {
  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
  ) {
    await interaction.reply({
      content: "このコマンドには Manage Channels 権限が必要です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await executeSetVcCreate(interaction, context);
};

const handleResendPanel = async (
  interaction: ChatInputCommandInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    await interaction.reply({
      content: "このコマンドには Manage Channels 権限が必要です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await executeResendPanel(interaction, context);
};

const safelyReplyWithError = async (
  interaction: Interaction
): Promise<void> => {
  const payload = {
    content: "処理中にエラーが発生しました。時間をおいて再試行してください。",
    flags: MessageFlags.Ephemeral
  } satisfies InteractionReplyOptions;

  try {
    await sendSafeInteractionResponse(interaction, payload);
  } catch (responseError) {
    if (isUnknownInteractionError(responseError)) {
      console.warn("[interaction] unknown interaction while replying to error", responseError);
      return;
    }

    throw responseError;
  }
};

const runWithSettingsPanelUserLock = async (
  interaction: SettingsPanelInteraction,
  run: () => Promise<void>
): Promise<void> => {
  const guildId = interaction.guildId ?? interaction.guild?.id ?? "unknown";
  const userId = interaction.user.id;
  const lockKey = `${guildId}:${userId}`;

  if (inFlightSettingsPanelUsers.has(lockKey)) {
    await sendSafeInteractionResponse(interaction, {
      content: "前の設定操作を処理中です。完了後に再度お試しください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  inFlightSettingsPanelUsers.add(lockKey);
  try {
    await run();
  } finally {
    inFlightSettingsPanelUsers.delete(lockKey);
  }
};

const shouldApplySettingsPanelLock = (
  interaction: SettingsPanelInteraction
): boolean => {
  if (SETTINGS_PANEL_EXACT_CUSTOM_IDS.has(interaction.customId)) {
    return true;
  }

  return SETTINGS_PANEL_CUSTOM_ID_PREFIXES.some((prefix) =>
    interaction.customId.startsWith(prefix)
  );
};

const runWithOptionalSettingsPanelUserLock = async (
  interaction: SettingsPanelInteraction,
  run: () => Promise<void>
): Promise<void> => {
  if (!shouldApplySettingsPanelLock(interaction)) {
    await run();
    return;
  }

  await runWithSettingsPanelUserLock(interaction, run);
};

const replyUnknownCustomId = async (
  interaction: Interaction,
  kind: "button" | "select" | "modal"
): Promise<void> => {
  await sendSafeInteractionResponse(interaction, {
    content: `未対応の${kind}操作です。設定パネルを開き直して再度お試しください。`,
    flags: MessageFlags.Ephemeral
  });
};

const resolveAccessListKindByValue = (value: string): AccessListKind | null =>
  ACCESS_LIST_OPTION_VALUES[value] ?? null;

const resolveAccessListKindByCustomId = (
  customId: string,
  prefix: string
): AccessListKind | null => {
  if (!customId.startsWith(prefix)) {
    return null;
  }

  const raw = customId.slice(prefix.length);
  return raw === "whitelist" || raw === "blacklist" ? raw : null;
};

const buildAccessListAddDiagnostics = (
  interaction: UserSelectMenuInteraction,
  kind: AccessListKind,
  startedAt: number
): string => {
  const guildId = interaction.guildId ?? interaction.guild?.id ?? "unknown";
  const elapsedMs = Date.now() - startedAt;
  return (
    `customId=${interaction.customId} ` +
    `elapsedMs=${elapsedMs} ` +
    `userId=${interaction.user.id} ` +
    `guildId=${guildId} ` +
    `kind=${kind}`
  );
};

const rememberModalDefaults = (
  userId: string,
  patch: { name?: string; userLimit?: number }
): void => {
  const existing = modalDefaultsCache.get(userId) ?? {};
  const next: ModalDefaultsCacheEntry = { ...existing };

  if (typeof patch.name === "string") {
    const trimmed = patch.name.trim();
    next.name = trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof patch.userLimit === "number" && Number.isInteger(patch.userLimit)) {
    next.userLimit = patch.userLimit >= 0 && patch.userLimit <= 99
      ? patch.userLimit
      : undefined;
  }

  if (next.name === undefined && next.userLimit === undefined) {
    modalDefaultsCache.delete(userId);
    return;
  }

  modalDefaultsCache.set(userId, next);
};

const readModalDefaultName = (userId: string): string | undefined =>
  modalDefaultsCache.get(userId)?.name;

const readModalDefaultUserLimit = (userId: string): number | undefined =>
  modalDefaultsCache.get(userId)?.userLimit;

const readStringProperty = (target: unknown, key: string): string | undefined => {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const value = Reflect.get(target, key);
  return typeof value === "string" ? value : undefined;
};

const readNumberProperty = (target: unknown, key: string): number | undefined => {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const value = Reflect.get(target, key);
  return typeof value === "number" ? value : undefined;
};

const isUserSelectInteraction = (
  interaction: Interaction
): interaction is UserSelectMenuInteraction => {
  const maybeFn = Reflect.get(interaction as object, "isUserSelectMenu");
  if (typeof maybeFn !== "function") {
    return false;
  }

  return Boolean(maybeFn.call(interaction));
};

const formatAccessListOverview = async (
  interaction: StringSelectMenuInteraction | UserSelectMenuInteraction,
  userIds: string[]
): Promise<string> => {
  if (userIds.length === 0) {
    return "- （未登録）";
  }

  const lines = await Promise.all(
    userIds.map(async (userId) => {
      const member = await interaction.guild?.members.fetch(userId).catch(() => null);
      const displayName = member?.displayName ?? userId;
      return `- ${displayName} (<@${userId}>)`;
    })
  );

  return lines.join("\n");
};

const resolveAccessListSelectOptions = async (
  interaction: StringSelectMenuInteraction | UserSelectMenuInteraction,
  userIds: string[]
): Promise<AccessListSelectOption[]> => {
  const options = await Promise.all(
    userIds.map(async (userId) => {
      const member = await interaction.guild?.members.fetch(userId).catch(() => null);
      return {
        userId,
        label: member?.displayName ?? userId
      };
    })
  );

  return options;
};

const replyWithAccessListManager = async (
  interaction: StringSelectMenuInteraction | UserSelectMenuInteraction,
  context: BotContext,
  kind: AccessListKind,
  statusMessage?: string
): Promise<void> => {
  const lists = await context.repo.getAccessControlLists(interaction.user.id);
  const targetUserIds = lists[kind];
  const overview = await formatAccessListOverview(interaction, targetUserIds);
  const removeSelectOptions = await resolveAccessListSelectOptions(interaction, targetUserIds);
  const label = ACCESS_LIST_LABELS[kind];

  const header = statusMessage ? `${statusMessage}\n\n` : "";
  await sendSafeInteractionResponse(interaction, {
    content:
      `${header}${label}一覧 (${targetUserIds.length}件)\n` +
      `${overview}\n\n` +
      "追加: ユーザーセレクトで1人選択\n" +
      "除外: 下のセレクトから対象を選択",
    components: buildAccessListManagementComponents(kind, removeSelectOptions),
    flags: MessageFlags.Ephemeral
  });
};

const handleRecruitButton = async (
  interaction: ButtonInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) return;

  const member = interaction.member;
  const voiceChannelId = member instanceof GuildMember ? member.voice.channelId : null;
  if (!voiceChannelId) {
    await sendSafeInteractionResponse(interaction, {
      content: "通話作成で作成されたVCに参加してから通話募集をしてください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const generated = await context.repo.findGeneratedVcByChannel(voiceChannelId);
  if (!generated) {
    await sendSafeInteractionResponse(interaction, {
      content: "通話作成で作成されたVCに参加してから通話募集をしてください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const pref = await context.repo.getOrCreateUserPreference(generated.owner_user_id, context.defaults);
  if (pref.is_private) {
    await sendSafeInteractionResponse(interaction, {
      content: "非公開VCからは通話募集できません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(buildRecruitModal());
};

const handleRecruitModalSubmit = async (
  interaction: ModalSubmitInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild || !interaction.guildId) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = interaction.member;
  const voiceChannelId = member instanceof GuildMember ? member.voice.channelId : null;
  if (!voiceChannelId) {
    await sendSafeInteractionResponse(interaction, {
      content: "通話作成で作成されたVCに参加していません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const generated = await context.repo.findGeneratedVcByChannel(voiceChannelId);
  if (!generated) {
    await sendSafeInteractionResponse(interaction, {
      content: "通話作成で作成されたVCに参加していません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const pref = await context.repo.getOrCreateUserPreference(generated.owner_user_id, context.defaults);
  if (pref.is_private) {
    await sendSafeInteractionResponse(interaction, {
      content: "非公開VCからは通話募集できません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const voiceChannel =
    interaction.guild.channels.cache.get(voiceChannelId) ??
    await interaction.guild.channels.fetch(voiceChannelId).catch(() => null);
  const categoryId = voiceChannel?.parentId;
  if (!categoryId) {
    await sendSafeInteractionResponse(interaction, {
      content: "VCのカテゴリが見つかりません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const hub = await context.repo.findHubByCategoryId(categoryId);
  if (!hub) {
    await sendSafeInteractionResponse(interaction, {
      content: "通話作成ハブが見つかりません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const settingsChannel =
    interaction.guild.channels.cache.get(hub.settings_text_channel_id) ??
    await interaction.guild.channels.fetch(hub.settings_text_channel_id).catch(() => null);

  if (!settingsChannel || settingsChannel.type !== ChannelType.GuildText) {
    await sendSafeInteractionResponse(interaction, {
      content: "設定チャンネルが見つかりません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const slot = getJstTimeSlot();
  const roleId = await context.repo.getTimeSlotRole(interaction.guildId, slot);
  const roleMention = roleId ? `<@&${roleId}> ` : "";
  const userMessage = interaction.fields.getTextInputValue(RECRUIT_INPUT_ID).trim();

  await settingsChannel.send({
    content: [
      `${roleMention}${interaction.user} が通話を募集しています！`,
      `> ${userMessage}`,
      `📞 <#${voiceChannelId}>`
    ].join("\n")
  });

  await sendSafeInteractionResponse(interaction, {
    content: "通話募集を送信しました！",
    flags: MessageFlags.Ephemeral
  });
};

const handleButton = async (
  interaction: ButtonInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  if (interaction.customId === NAME_BUTTON_ID) {
    await interaction.showModal(buildNameEditModal(readModalDefaultName(interaction.user.id)));
    return;
  }

  if (interaction.customId === LIMIT_CUSTOM_BUTTON_ID) {
    await interaction.showModal(buildUserLimitEditModal(readModalDefaultUserLimit(interaction.user.id)));
    return;
  }

  if (interaction.customId === TEMPLATE_BUTTON_ID) {
    await handleTemplateButton(interaction, context);
    return;
  }

  if (interaction.customId === TEMPLATE_SAVE_BUTTON_ID) {
    await handleTemplateSaveButton(interaction, context);
    return;
  }

  if (interaction.customId === RECRUIT_BUTTON_ID) {
    await handleRecruitButton(interaction, context);
    return;
  }

  if (interaction.customId === OTHER_SETTINGS_BUTTON_ID) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let isPrivate: boolean;

    try {
      const preference = await context.repo.getOrCreateUserPreference(
        interaction.user.id,
        context.defaults
      );
      rememberModalDefaults(interaction.user.id, {
        name: preference.name,
        userLimit: preference.user_limit
      });
      isPrivate = preference.is_private;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[interaction] failed to load private preference: ${message}`, error);
      await sendSafeInteractionResponse(interaction, {
        content: "設定の読み込みに失敗しました。時間をおいて再試行してください。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await sendSafeInteractionResponse(interaction, {
      content: "その他の設定を選択してください。",
      components: [buildOtherSettingsSelect(isPrivate)],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId.startsWith(LIMIT_BUTTON_PREFIX)) {
    const parsed = Number.parseInt(
      interaction.customId.slice(LIMIT_BUTTON_PREFIX.length),
      10
    );
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 99) {
      await sendSafeInteractionResponse(interaction, {
        content: "不正な人数設定です。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const updatedPreference = await context.repo.updateUserPreference(
        interaction.user.id,
        { user_limit: parsed },
        context.defaults
      );
      rememberModalDefaults(interaction.user.id, {
        name: readStringProperty(updatedPreference, "name"),
        userLimit: readNumberProperty(updatedPreference, "user_limit") ?? parsed
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[interaction] failed to update user limit preference: ${message}`, error);
      await sendSafeInteractionResponse(interaction, {
        content: "設定の保存に失敗しました。時間をおいて再試行してください。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await sendSafeInteractionResponse(interaction, {
      content: `人数上限を ${parsed} 人に更新しました。`,
      flags: MessageFlags.Ephemeral
    });

    void renameOwnedGeneratedVcIfConnected(
      interaction.guild,
      interaction.user.id,
      context
    ).catch((error) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[interaction] user limit saved but VC sync failed: ${message}`, error);
    });
    return;
  }

  if (!interaction.customId.startsWith(ICON_BUTTON_PREFIX)) {
    await replyUnknownCustomId(interaction, "button");
    return;
  }

  const presetKey = interaction.customId.slice(ICON_BUTTON_PREFIX.length) as keyof typeof ICON_PRESETS;
  const icon = ICON_PRESETS[presetKey];

  if (!icon) {
    await sendSafeInteractionResponse(interaction, {
      content: "不明なプリセットです。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const updatedPreference = await context.repo.updateUserPreference(
      interaction.user.id,
      { icon },
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: readStringProperty(updatedPreference, "name"),
      userLimit: readNumberProperty(updatedPreference, "user_limit")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to update icon preference: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    content: `アイコンを ${icon} に更新しました。`,
    flags: MessageFlags.Ephemeral
  });

  void renameOwnedGeneratedVcIfConnected(
    interaction.guild,
    interaction.user.id,
    context
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] icon preference saved but VC rename failed: ${message}`, error);
  });
};

const handleNameModalSubmit = async (
  interaction: ModalSubmitInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const nextName = interaction.fields.getTextInputValue(NAME_INPUT_ID).trim();
  if (!nextName) {
    await sendSafeInteractionResponse(interaction, {
      content: "名前は1文字以上で入力してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const updatedPreference = await context.repo.updateUserPreference(
      interaction.user.id,
      { name: nextName },
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: readStringProperty(updatedPreference, "name") ?? nextName,
      userLimit: readNumberProperty(updatedPreference, "user_limit")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to update name preference: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    content: `名前を「${nextName}」に更新しました。`,
    flags: MessageFlags.Ephemeral
  });

  void renameOwnedGeneratedVcIfConnected(
    interaction.guild,
    interaction.user.id,
    context
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] name preference saved but VC rename failed: ${message}`, error);
  });
};

const handleUserLimitModalSubmit = async (
  interaction: ModalSubmitInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const raw = interaction.fields.getTextInputValue(LIMIT_INPUT_ID).trim();
  if (!/^\d{1,2}$/.test(raw)) {
    await sendSafeInteractionResponse(interaction, {
      content: "人数上限は 0 から 99 の整数で入力してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const userLimit = Number.parseInt(raw, 10);
  if (userLimit < 0 || userLimit > 99) {
    await sendSafeInteractionResponse(interaction, {
      content: "人数上限は 0 から 99 の整数で入力してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    const updatedPreference = await context.repo.updateUserPreference(
      interaction.user.id,
      { user_limit: userLimit },
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: readStringProperty(updatedPreference, "name"),
      userLimit: readNumberProperty(updatedPreference, "user_limit") ?? userLimit
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to update user limit preference: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    content: `人数上限を ${userLimit} 人に更新しました。`,
    flags: MessageFlags.Ephemeral
  });

  void renameOwnedGeneratedVcIfConnected(
    interaction.guild,
    interaction.user.id,
    context
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] user limit saved but VC sync failed: ${message}`, error);
  });
};

const handleOtherSettingsSelect = async (
  interaction: StringSelectMenuInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  const selectedValue = interaction.values[0];
  const accessListKind = resolveAccessListKindByValue(selectedValue);

  if (accessListKind) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await replyWithAccessListManager(interaction, context, accessListKind);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[interaction] failed to show access list manager: ${message}`, error);
      await sendSafeInteractionResponse(interaction, {
        content: "設定の読み込みに失敗しました。時間をおいて再試行してください。",
        flags: MessageFlags.Ephemeral
      });
    }
    return;
  }

  if (selectedValue !== TOGGLE_PRIVATE_OPTION_VALUE) {
    await sendSafeInteractionResponse(interaction, {
      content: "不明な設定項目です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let nextIsPrivate: boolean;
  try {
    const currentPreference = await context.repo.getOrCreateUserPreference(
      interaction.user.id,
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: currentPreference.name,
      userLimit: currentPreference.user_limit
    });
    nextIsPrivate = !currentPreference.is_private;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to read private preference: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let updatedPreference: { is_private: boolean };

  try {
    updatedPreference = await context.repo.updateUserPreference(
      interaction.user.id,
      { is_private: nextIsPrivate },
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: readStringProperty(updatedPreference, "name"),
      userLimit: readNumberProperty(updatedPreference, "user_limit")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to update private preference: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    content: updatedPreference.is_private ? "VCを非公開に設定しました。" : "VCを公開に設定しました。",
    flags: MessageFlags.Ephemeral
  });

  void renameOwnedGeneratedVcIfConnected(
    interaction.guild,
    interaction.user.id,
    context
  ).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] private preference saved but VC sync failed: ${message}`, error);
  });
};

const handleAccessListAddSelect = async (
  interaction: UserSelectMenuInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  const kind = resolveAccessListKindByCustomId(interaction.customId, ACCESS_LIST_ADD_SELECT_PREFIX);
  if (!kind) {
    await replyUnknownCustomId(interaction, "select");
    return;
  }

  const startedAt = Date.now();

  try {
    await interaction.deferUpdate();
  } catch (error) {
    const diagnostics = buildAccessListAddDiagnostics(interaction, kind, startedAt);
    if (isUnknownInteractionError(error)) {
      console.warn(
        `[interaction] access list add ack failed: unknown interaction (${diagnostics})`,
        error
      );
      return;
    }

    throw error;
  }

  const targetUserId = interaction.values[0];

  if (!targetUserId) {
    await sendSafeInteractionResponse(interaction, {
      content: "対象ユーザーの選択に失敗しました。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (targetUserId === interaction.user.id) {
    await replyWithAccessListManager(
      interaction,
      context,
      kind,
      "自分自身はリストに追加できません。"
    );
    return;
  }

  try {
    await context.repo.upsertAccessListEntry(interaction.user.id, targetUserId, kind);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    const diagnostics = buildAccessListAddDiagnostics(interaction, kind, startedAt);
    console.error(`[interaction] failed to update access list: ${message} (${diagnostics})`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const status = `<@${targetUserId}> を${ACCESS_LIST_LABELS[kind]}に追加しました。`;

  await replyWithAccessListManager(interaction, context, kind, status);

  void renameOwnedGeneratedVcIfConnected(interaction.guild, interaction.user.id, context).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    const diagnostics = buildAccessListAddDiagnostics(interaction, kind, startedAt);
    console.error(`[interaction] access list saved but VC sync failed: ${message} (${diagnostics})`, error);
  });
};

const handleAccessListRemoveSelect = async (
  interaction: StringSelectMenuInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  const kind = resolveAccessListKindByCustomId(interaction.customId, ACCESS_LIST_REMOVE_SELECT_PREFIX);
  if (!kind) {
    await replyUnknownCustomId(interaction, "select");
    return;
  }

  const targetUserIds = interaction.values.filter((userId) => userId !== "__none__");
  await interaction.deferUpdate();

  try {
    await context.repo.removeAccessListEntries(interaction.user.id, kind, targetUserIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to remove access list entry: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const status =
    targetUserIds.length > 0
      ? `${ACCESS_LIST_LABELS[kind]}から ${targetUserIds.length} 件を除外しました。`
      : "除外対象がありません。";

  await replyWithAccessListManager(interaction, context, kind, status);

  void renameOwnedGeneratedVcIfConnected(interaction.guild, interaction.user.id, context).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] access list removal saved but VC sync failed: ${message}`, error);
  });
};

const replyWithTemplatePanelRefresh = async (
  interaction: SettingsPanelInteraction,
  context: BotContext,
  statusMessage?: string
): Promise<void> => {
  let templates: VcTemplateRecord[];
  try {
    templates = await context.repo.getTemplates(interaction.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to reload templates: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const header = statusMessage ? `${statusMessage}\n\n` : "";
  await sendSafeInteractionResponse(interaction, {
    content: header || "",
    embeds: [buildTemplatePanelEmbed(templates)],
    components: [
      buildTemplateApplySelect(templates),
      buildTemplateSaveButton(),
      buildTemplateDeleteSelect(templates)
    ],
    flags: MessageFlags.Ephemeral
  });
};

const handleTemplateButton = async (
  interaction: ButtonInteraction,
  context: BotContext
): Promise<void> => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let templates: VcTemplateRecord[];
  try {
    templates = await context.repo.getTemplates(interaction.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to load templates: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    embeds: [buildTemplatePanelEmbed(templates)],
    components: [
      buildTemplateApplySelect(templates),
      buildTemplateSaveButton(),
      buildTemplateDeleteSelect(templates)
    ],
    flags: MessageFlags.Ephemeral
  });
};

const handleTemplateApplySelect = async (
  interaction: StringSelectMenuInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    return;
  }

  await interaction.deferUpdate();

  const slotRaw = interaction.values[0];
  const slot = Number.parseInt(slotRaw, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    await sendSafeInteractionResponse(interaction, {
      content: "不正なスロット指定です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let templates: VcTemplateRecord[];
  try {
    templates = await context.repo.getTemplates(interaction.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to load templates for apply: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const template = templates.find((t) => t.slot === slot);
  if (!template) {
    await sendSafeInteractionResponse(interaction, {
      content: "指定したテンプレートが見つかりません。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  try {
    await context.repo.updateUserPreference(
      interaction.user.id,
      {
        icon: template.icon,
        name: template.vc_name,
        user_limit: template.user_limit,
        is_private: template.is_private
      },
      context.defaults
    );
    rememberModalDefaults(interaction.user.id, {
      name: template.vc_name,
      userLimit: template.user_limit
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to apply template: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の適用に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await replyWithTemplatePanelRefresh(
    interaction,
    context,
    `テンプレート「${template.template_name}」を適用しました。`
  );

  void renameOwnedGeneratedVcIfConnected(interaction.guild, interaction.user.id, context).catch((error) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] template applied but VC sync failed: ${message}`, error);
  });
};

const handleTemplateSaveButton = async (
  interaction: ButtonInteraction,
  context: BotContext
): Promise<void> => {
  await interaction.deferUpdate();

  let templates: VcTemplateRecord[];
  try {
    templates = await context.repo.getTemplates(interaction.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to load templates for save: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await sendSafeInteractionResponse(interaction, {
    content: "保存先のスロットを選択してください。",
    embeds: [],
    components: [buildTemplateSaveSlotSelect(templates)],
    flags: MessageFlags.Ephemeral
  });
};

const handleTemplateSaveSlotSelect = async (
  interaction: StringSelectMenuInteraction
): Promise<void> => {
  const slotRaw = interaction.values[0];
  const slot = Number.parseInt(slotRaw, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    await sendSafeInteractionResponse(interaction, {
      content: "不正なスロット指定です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.showModal(buildTemplateSaveModal(slot));
};

const handleTemplateSaveModalSubmit = async (
  interaction: ModalSubmitInteraction,
  context: BotContext
): Promise<void> => {
  await interaction.deferUpdate();

  const slotRaw = interaction.customId.slice(TEMPLATE_SAVE_MODAL_PREFIX.length);
  const slot = Number.parseInt(slotRaw, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    await sendSafeInteractionResponse(interaction, {
      content: "不正なスロット指定です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const templateName = interaction.fields.getTextInputValue(TEMPLATE_SAVE_NAME_INPUT_ID).trim();
  if (!templateName) {
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレート名は1文字以上で入力してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let preference: { icon: string; name: string; user_limit: number; is_private: boolean };
  try {
    preference = await context.repo.getOrCreateUserPreference(
      interaction.user.id,
      context.defaults
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to load preference for template save: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "設定の読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const record: VcTemplateRecord = {
    owner_user_id: interaction.user.id,
    slot: slot as 1 | 2 | 3,
    template_name: templateName,
    icon: preference.icon,
    vc_name: preference.name,
    user_limit: preference.user_limit,
    is_private: preference.is_private
  };

  try {
    await context.repo.upsertTemplate(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to save template: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの保存に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await replyWithTemplatePanelRefresh(
    interaction,
    context,
    `テンプレート「${templateName}」をスロット ${slot} に保存しました。`
  );
};

const handleTemplateDeleteSelect = async (
  interaction: StringSelectMenuInteraction,
  context: BotContext
): Promise<void> => {
  await interaction.deferUpdate();

  const slotRaw = interaction.values[0];
  const slot = Number.parseInt(slotRaw, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) {
    await sendSafeInteractionResponse(interaction, {
      content: "不正なスロット指定です。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let templates: VcTemplateRecord[];
  try {
    templates = await context.repo.getTemplates(interaction.user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to load templates for delete: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの読み込みに失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const target = templates.find((t) => t.slot === slot);
  if (!target) {
    await replyWithTemplatePanelRefresh(interaction, context, "指定したテンプレートが見つかりません。");
    return;
  }

  try {
    await context.repo.deleteTemplate(interaction.user.id, slot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[interaction] failed to delete template: ${message}`, error);
    await sendSafeInteractionResponse(interaction, {
      content: "テンプレートの削除に失敗しました。時間をおいて再試行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await replyWithTemplatePanelRefresh(
    interaction,
    context,
    `テンプレート「${target.template_name}」を削除しました。`
  );
};

export const registerInteractionHandler = (
  client: Client,
  context: BotContext
): void => {
  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === "set_vccreate") {
        await handleSetVcCreate(interaction, context);
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "resend_panel") {
        await handleResendPanel(interaction, context);
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "send_recruitment") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
          await interaction.reply({
            content: "このコマンドには Manage Channels 権限が必要です。",
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        await executeSendRecruitmentPanel(interaction);
        return;
      }

      if (interaction.isChatInputCommand() && interaction.commandName === "set_recruitment_role") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          await interaction.reply({
            content: "このコマンドには Manage Guild 権限が必要です。",
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        await executeSetRecruitmentRole(interaction, context);
        return;
      }

      if (interaction.isButton()) {
        await runWithOptionalSettingsPanelUserLock(interaction, async () => {
          await handleButton(interaction, context);
        });
        return;
      }

      if (interaction.isStringSelectMenu()) {
        await runWithOptionalSettingsPanelUserLock(interaction, async () => {
          if (interaction.customId === TEMPLATE_APPLY_SELECT_ID) {
            await handleTemplateApplySelect(interaction, context);
            return;
          }

          if (interaction.customId === TEMPLATE_SAVE_SLOT_SELECT_ID) {
            await handleTemplateSaveSlotSelect(interaction);
            return;
          }

          if (interaction.customId === TEMPLATE_DELETE_SELECT_ID) {
            await handleTemplateDeleteSelect(interaction, context);
            return;
          }

          if (interaction.customId === OTHER_SETTINGS_SELECT_ID) {
            await handleOtherSettingsSelect(interaction, context);
            return;
          }

          if (interaction.customId.startsWith(ACCESS_LIST_REMOVE_SELECT_PREFIX)) {
            await handleAccessListRemoveSelect(interaction, context);
            return;
          }

          await replyUnknownCustomId(interaction, "select");
        });
        return;
      }

      if (isUserSelectInteraction(interaction)) {
        await runWithOptionalSettingsPanelUserLock(interaction, async () => {
          if (interaction.customId.startsWith(ACCESS_LIST_ADD_SELECT_PREFIX)) {
            await handleAccessListAddSelect(interaction, context);
            return;
          }

          await replyUnknownCustomId(interaction, "select");
        });
        return;
      }

      if (interaction.isModalSubmit()) {
        await runWithOptionalSettingsPanelUserLock(interaction, async () => {
          if (interaction.customId === NAME_MODAL_ID) {
            await handleNameModalSubmit(interaction, context);
            return;
          }

          if (interaction.customId === LIMIT_MODAL_ID) {
            await handleUserLimitModalSubmit(interaction, context);
            return;
          }

          if (interaction.customId.startsWith(TEMPLATE_SAVE_MODAL_PREFIX)) {
            await handleTemplateSaveModalSubmit(interaction, context);
            return;
          }

          if (interaction.customId === RECRUIT_MODAL_ID) {
            await handleRecruitModalSubmit(interaction, context);
            return;
          }

          await replyUnknownCustomId(interaction, "modal");
        });
        return;
      }
    } catch (error) {
      if (isUnknownInteractionError(error)) {
        console.warn("[interaction] unknown interaction", error);
        return;
      }

      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`[interaction] ${message}`, error);
      await safelyReplyWithError(interaction);
    }
  });
};
