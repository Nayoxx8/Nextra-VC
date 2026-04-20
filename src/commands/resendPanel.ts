import {
  ActionRowBuilder,
  ButtonBuilder,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import {
  buildSettingsComponents,
  buildSettingsEmbed
} from "../panels/settingsPanel.js";
import { isManagedSettingsPanelMessage, sendSetVcCreateResponse } from "./setVcCreate.js";
import type { BotContext } from "../types.js";

export const resendPanelCommand = new SlashCommandBuilder()
  .setName("resend_panel")
  .setDescription("設定パネルを送り直します（古いパネルは無効化されます）")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false);

export const executeResendPanel = async (
  interaction: ChatInputCommandInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    await sendSetVcCreateResponse(interaction, {
      content: "このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const hub = await context.repo.findHubByGuild(interaction.guild.id);
  if (!hub) {
    await sendSetVcCreateResponse(interaction, {
      content: "このサーバーにVC作成ハブが設定されていません。先に `/set_vccreate` を実行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const settingsText = await interaction.guild.channels
    .fetch(hub.settings_text_channel_id)
    .catch(() => null);

  if (!settingsText?.isTextBased() || settingsText.isDMBased()) {
    await sendSetVcCreateResponse(interaction, {
      content: "設定チャンネルが見つかりませんでした。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const recentMessages = await settingsText.messages.fetch({ limit: 50 });
  let disabledCount = 0;

  for (const message of recentMessages.values()) {
    if (!isManagedSettingsPanelMessage(message)) continue;

    const buttonRows = message.components
      .filter((row) => row.type === ComponentType.ActionRow)
      .map((row) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          row.components
            .filter((c) => c.type === ComponentType.Button)
            .map((c) => ButtonBuilder.from(c.toJSON()).setDisabled(true))
        )
      );

    await message.edit({ components: buttonRows }).catch(() => undefined);
    disabledCount++;
  }

  await settingsText.send({
    embeds: [buildSettingsEmbed()],
    components: buildSettingsComponents()
  });

  await sendSetVcCreateResponse(interaction, {
    content: [
      "設定パネルを送り直しました。",
      disabledCount > 0 ? `古いパネル ${disabledCount} 件を無効化しました。` : null
    ]
      .filter(Boolean)
      .join("\n"),
    flags: MessageFlags.Ephemeral
  });
};

