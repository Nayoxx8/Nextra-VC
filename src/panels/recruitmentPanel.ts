import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

export const RECRUIT_PANEL_FOOTER = "vccreate:recruit:panel";
export const RECRUIT_BUTTON_ID = "vccreate:recruit";
export const RECRUIT_MODAL_ID = "vccreate:recruit:modal";
export const RECRUIT_INPUT_ID = "vccreate:recruit:input";

export const buildRecruitmentEmbed = (): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle("📢 通話募集")
    .setDescription("ボタンを押してメッセージを入力すると、通話への参加を呼びかけられます。\n※通話作成で作成されたVCに参加中の場合のみ使用できます。")
    .setFooter({ text: RECRUIT_PANEL_FOOTER })
    .setColor(0x57f287);

export const buildRecruitmentComponents = (): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(RECRUIT_BUTTON_ID)
      .setStyle(ButtonStyle.Success)
      .setLabel("通話募集")
      .setEmoji("📢")
  )
];

export const buildRecruitModal = (): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(RECRUIT_INPUT_ID)
    .setLabel("募集メッセージ")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(200)
    .setPlaceholder("例: 一緒にゲームしませんか？");

  return new ModalBuilder()
    .setCustomId(RECRUIT_MODAL_ID)
    .setTitle("通話募集")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
