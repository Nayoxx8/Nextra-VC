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
  buildRecruitmentComponents,
  buildRecruitmentEmbed,
  RECRUIT_PANEL_FOOTER
} from "../panels/recruitmentPanel.js";

export const sendRecruitmentPanelCommand = new SlashCommandBuilder()
  .setName("send_recruitment")
  .setDescription("通話募集ボタンをこのチャンネルに送信します")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
  .setDMPermission(false);

export const executeSendRecruitmentPanel = async (
  interaction: ChatInputCommandInteraction
): Promise<void> => {
  if (!interaction.guild || !interaction.channel) {
    await interaction.reply({
      content: "このコマンドはサーバーのテキストチャンネルでのみ実行できます。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel.isTextBased() || channel.isDMBased()) {
    await interaction.reply({
      content: "テキストチャンネルで実行してください。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const recentMessages = await channel.messages.fetch({ limit: 50 });
  let disabledCount = 0;

  for (const message of recentMessages.values()) {
    if (!message.embeds.some((e) => e.footer?.text === RECRUIT_PANEL_FOOTER)) continue;

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

  await channel.send({
    embeds: [buildRecruitmentEmbed()],
    components: buildRecruitmentComponents()
  });

  const content = [
    "通話募集パネルを送信しました。",
    disabledCount > 0 ? `古いパネル ${disabledCount} 件を無効化しました。` : null
  ]
    .filter(Boolean)
    .join("\n");

  if (interaction.deferred) {
    await interaction.editReply({ content });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
};
