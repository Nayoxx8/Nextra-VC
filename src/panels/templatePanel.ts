import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import type { VcTemplateRecord } from "../types.js";

export const TEMPLATE_BUTTON_ID = "vccreate:template:open";
export const TEMPLATE_APPLY_SELECT_ID = "vccreate:template:apply";
export const TEMPLATE_SAVE_BUTTON_ID = "vccreate:template:save:btn";
export const TEMPLATE_SAVE_SLOT_SELECT_ID = "vccreate:template:save:slot";
export const TEMPLATE_SAVE_MODAL_PREFIX = "vccreate:template:save:modal:";
export const TEMPLATE_SAVE_NAME_INPUT_ID = "vccreate:template:name_input";
export const TEMPLATE_DELETE_SELECT_ID = "vccreate:template:delete";

export const MAX_TEMPLATE_SLOTS = 3;

const formatSlotLine = (slot: 1 | 2 | 3, template: VcTemplateRecord | undefined): string => {
  if (!template) {
    return `スロット ${slot}: （空き）`;
  }

  const limitText = template.user_limit === 0 ? "上限なし" : `${template.user_limit}人`;
  const privacyText = template.is_private ? "非公開" : "公開";
  return `スロット ${slot}: **「${template.template_name}」** (${template.icon}${template.vc_name} / ${limitText} / ${privacyText})`;
};

export const buildTemplatePanelEmbed = (templates: VcTemplateRecord[]): EmbedBuilder => {
  const bySlot = new Map(templates.map((t) => [t.slot, t]));

  const lines = ([1, 2, 3] as const).map((slot) =>
    formatSlotLine(slot, bySlot.get(slot))
  );

  return new EmbedBuilder()
    .setTitle("🗂️ テンプレート管理")
    .setDescription(
      lines.join("\n") +
      "\n\n" +
      "テンプレートを適用するか、現在の設定を保存・削除できます。"
    )
    .setColor(0x9b59b6);
};

export const buildTemplateApplySelect = (
  templates: VcTemplateRecord[]
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(TEMPLATE_APPLY_SELECT_ID)
    .setPlaceholder(templates.length > 0 ? "テンプレートを適用..." : "テンプレートがありません")
    .setDisabled(templates.length === 0);

  if (templates.length > 0) {
    select.addOptions(
      templates.map((t) => {
        const limitText = t.user_limit === 0 ? "上限なし" : `${t.user_limit}人`;
        const privacyText = t.is_private ? "非公開" : "公開";
        return {
          label: t.template_name,
          description: `${t.icon}${t.vc_name} / ${limitText} / ${privacyText}`,
          value: String(t.slot),
          emoji: "▶️"
        };
      })
    );
  } else {
    select.addOptions({ label: "（空き）", value: "__none__" });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

export const buildTemplateSaveButton = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(TEMPLATE_SAVE_BUTTON_ID)
      .setStyle(ButtonStyle.Success)
      .setLabel("現在の設定を保存")
      .setEmoji("💾")
  );

export const buildTemplateDeleteSelect = (
  templates: VcTemplateRecord[]
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const select = new StringSelectMenuBuilder()
    .setCustomId(TEMPLATE_DELETE_SELECT_ID)
    .setPlaceholder(templates.length > 0 ? "テンプレートを削除..." : "削除対象がありません")
    .setDisabled(templates.length === 0);

  if (templates.length > 0) {
    select.addOptions(
      templates.map((t) => ({
        label: `スロット ${t.slot}: ${t.template_name}`,
        value: String(t.slot),
        emoji: "🗑️"
      }))
    );
  } else {
    select.addOptions({ label: "（空き）", value: "__none__" });
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

export const buildTemplateSaveSlotSelect = (
  templates: VcTemplateRecord[]
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const bySlot = new Map(templates.map((t) => [t.slot, t]));

  const select = new StringSelectMenuBuilder()
    .setCustomId(TEMPLATE_SAVE_SLOT_SELECT_ID)
    .setPlaceholder("保存先スロットを選択...")
    .addOptions(
      ([1, 2, 3] as const).map((slot) => {
        const existing = bySlot.get(slot);
        return {
          label: existing
            ? `スロット ${slot}: ${existing.template_name}（上書き）`
            : `スロット ${slot}: （空き）`,
          value: String(slot),
          emoji: existing ? "🔄" : "✨"
        };
      })
    );

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
};

export const buildTemplateSaveModal = (slot: number, defaultName?: string): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(TEMPLATE_SAVE_NAME_INPUT_ID)
    .setLabel("テンプレート名 (1〜32文字)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32)
    .setPlaceholder("例: ゲーム部屋");

  if (defaultName) {
    input.setValue(defaultName);
  }

  return new ModalBuilder()
    .setCustomId(`${TEMPLATE_SAVE_MODAL_PREFIX}${slot}`)
    .setTitle(`スロット ${slot} に保存`)
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
