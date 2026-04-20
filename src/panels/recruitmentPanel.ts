import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";

export const RECRUIT_BUTTON_ID = "vccreate:recruit";
export const RECRUIT_MODAL_ID = "vccreate:recruit:modal";
export const RECRUIT_INPUT_ID = "vccreate:recruit:input";

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
