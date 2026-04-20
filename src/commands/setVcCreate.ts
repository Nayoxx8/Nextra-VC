import {
  ChannelType,
  type InteractionReplyOptions,
  type Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type CategoryChannel,
  type ChatInputCommandInteraction,
  type TextChannel,
  type VoiceChannel
} from "discord.js";
import {
  buildSettingsComponents,
  buildSettingsEmbed,
  SETTINGS_PANEL_ID
} from "../panels/settingsPanel.js";
import type { BotContext } from "../types.js";

const CREATOR_VOICE_NAME = "通話作成";
const SETTINGS_TEXT_NAME = "通話作成設定";
const setVcCreateLocks = new Map<string, Promise<void>>();

type CategoryHubChannels = {
  creatorVoice: VoiceChannel | null;
  settingsText: TextChannel | null;
};

const setVcCreateLockKey = (guildId: string, categoryId: string): string =>
  `${guildId}:${categoryId}`;

export const sendSetVcCreateResponse = async (
  interaction: ChatInputCommandInteraction,
  options: InteractionReplyOptions
): Promise<void> => {
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

export const runWithSetVcCreateLock = async <T>(
  guildId: string,
  categoryId: string,
  task: () => Promise<T>
): Promise<T> => {
  const key = setVcCreateLockKey(guildId, categoryId);
  const previous = setVcCreateLocks.get(key) ?? Promise.resolve();

  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });

  const lockTail = previous.then(() => next);
  setVcCreateLocks.set(key, lockTail);

  await previous;
  try {
    return await task();
  } finally {
    release?.();
    if (setVcCreateLocks.get(key) === lockTail) {
      setVcCreateLocks.delete(key);
    }
  }
};

export const isManagedSettingsPanelMessage = (message: {
  embeds: Array<{ footer: { text: string } | null }>;
}): boolean => message.embeds.some((embed) => embed.footer?.text === SETTINGS_PANEL_ID);

export const shouldPostSettingsPanel = (
  messages: Iterable<{ embeds: Array<{ footer: { text: string } | null }> }>
): boolean => {
  for (const message of messages) {
    if (isManagedSettingsPanelMessage(message)) {
      return false;
    }
  }

  return true;
};

export const findCategoryHubChannels = async (
  guild: Guild,
  categoryId: string
): Promise<CategoryHubChannels> => {
  const channels = await guild.channels.fetch();

  let creatorVoice: VoiceChannel | null = null;
  let settingsText: TextChannel | null = null;

  for (const channel of channels.values()) {
    if (!channel || channel.parentId !== categoryId) {
      continue;
    }

    if (!creatorVoice && channel.type === ChannelType.GuildVoice && channel.name === CREATOR_VOICE_NAME) {
      creatorVoice = channel;
      continue;
    }

    if (!settingsText && channel.type === ChannelType.GuildText && channel.name === SETTINGS_TEXT_NAME) {
      settingsText = channel;
    }
  }

  return { creatorVoice, settingsText };
};

export const setVcCreateCommand = new SlashCommandBuilder()
  .setName("set_vccreate")
  .setDescription("通話作成VCと設定パネルを現在カテゴリに作成します")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false);

export const executeSetVcCreate = async (
  interaction: ChatInputCommandInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild || !interaction.channel) {
    await sendSetVcCreateResponse(interaction, {
      content: "このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const guild = interaction.guild;

  const currentChannel = await guild.channels.fetch(interaction.channelId, { force: true });
  if (!currentChannel?.parentId) {
    await sendSetVcCreateResponse(interaction, {
      content: "カテゴリ配下のテキストチャンネルで実行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  let category: CategoryChannel | null = null;
  if (currentChannel.parent?.type === ChannelType.GuildCategory) {
    category = currentChannel.parent as CategoryChannel;
  } else {
    const parentChannel = await guild.channels.fetch(currentChannel.parentId, { force: true });
    if (parentChannel?.type === ChannelType.GuildCategory) {
      category = parentChannel;
    }
  }

  if (!category) {
    await sendSetVcCreateResponse(interaction, {
      content: "カテゴリ配下のテキストチャンネルで実行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const { creatorVoice, settingsText, existingPanel } = await runWithSetVcCreateLock(
    guild.id,
    category.id,
    async () => {
      let { creatorVoice, settingsText } = await findCategoryHubChannels(guild, category.id);

      if (!creatorVoice) {
        creatorVoice = await guild.channels.create({
          name: CREATOR_VOICE_NAME,
          type: ChannelType.GuildVoice,
          parent: category.id,
          reason: "Initialize VC create hub"
        });
      }

      if (!settingsText) {
        settingsText = await guild.channels.create({
          name: SETTINGS_TEXT_NAME,
          type: ChannelType.GuildText,
          parent: category.id,
          reason: "Initialize VC create settings panel"
        });
      }

      await context.repo.upsertHub({
        guild_id: guild.id,
        category_id: category.id,
        creator_voice_channel_id: creatorVoice.id,
        settings_text_channel_id: settingsText.id
      });

      const recentMessages = await settingsText.messages.fetch({ limit: 30 });
      const existingPanel = recentMessages.find((message) => isManagedSettingsPanelMessage(message));

      if (shouldPostSettingsPanel(recentMessages.values())) {
        await settingsText.send({
          embeds: [buildSettingsEmbed()],
          components: buildSettingsComponents()
        });
      }

      return { creatorVoice, settingsText, existingPanel };
    }
  );

  await sendSetVcCreateResponse(interaction, {
    content: [
      "VC作成ハブを設定しました。",
      `- 作成VC: ${creatorVoice}`,
      `- 設定チャンネル: ${settingsText}`,
      existingPanel
        ? "- 設定パネル: 既存メッセージを再利用しました"
        : "- 設定パネル: 新規メッセージを投稿しました"
    ].join("\n"),
    flags: MessageFlags.Ephemeral
  });
};
