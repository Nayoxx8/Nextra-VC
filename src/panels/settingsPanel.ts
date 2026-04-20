import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import type { AccessListKind } from "../types.js";
import { TEMPLATE_BUTTON_ID } from "./templatePanel.js";

export const SETTINGS_PANEL_ID = "vccreate:panel";
export const NAME_BUTTON_ID = "vccreate:name";
export const NAME_MODAL_ID = "vccreate:name:modal";
export const NAME_INPUT_ID = "vccreate:name:input";
export const ICON_BUTTON_PREFIX = "vccreate:icon:";
export const LIMIT_BUTTON_PREFIX = "vccreate:limit:";
export const LIMIT_CUSTOM_BUTTON_ID = "vccreate:limit:custom";
export const LIMIT_MODAL_ID = "vccreate:limit:modal";
export const LIMIT_INPUT_ID = "vccreate:limit:input";
export const OTHER_SETTINGS_BUTTON_ID = "vccreate:other:button";
export const OTHER_SETTINGS_SELECT_ID = "vccreate:other";
export const TOGGLE_PRIVATE_OPTION_VALUE = "toggle-private";
export const MANAGE_WHITELIST_OPTION_VALUE = "manage-whitelist";
export const MANAGE_BLACKLIST_OPTION_VALUE = "manage-blacklist";
export const ACCESS_LIST_ADD_SELECT_PREFIX = "vccreate:access:add:";
export const ACCESS_LIST_REMOVE_SELECT_PREFIX = "vccreate:access:remove:";

export const ACCESS_LIST_LABELS: Record<AccessListKind, string> = {
  whitelist: "ホワイトリスト",
  blacklist: "ブラックリスト"
};

export const ICON_PRESETS = {
  beginner: "🔰",
  game: "🎮",
  work: "☕",
  chat: "💬"
} as const;

export const buildSettingsEmbed = (): EmbedBuilder =>
  new EmbedBuilder()
    .setTitle("✧通話作成設定")
    .setDescription(
      [
        "ボタンでアイコンを選択して、通話名を更新できます。",
        "作成VCに接続中であれば、変更は現在のVC名にも即時反映されます。"
      ].join("\n")
    )
    .setFooter({ text: SETTINGS_PANEL_ID })
    .setColor(0x5ba7f7);

export const buildSettingsButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(NAME_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setLabel("名前変更")
      .setEmoji("✏️"),
    new ButtonBuilder()
      .setCustomId(`${ICON_BUTTON_PREFIX}chat`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("雑談")
      .setEmoji("💬"),
    new ButtonBuilder()
      .setCustomId(`${ICON_BUTTON_PREFIX}beginner`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("新規歓迎")
      .setEmoji("🔰"),
    new ButtonBuilder()
      .setCustomId(`${ICON_BUTTON_PREFIX}game`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("ゲーム")
      .setEmoji("🎮"),
    new ButtonBuilder()
      .setCustomId(`${ICON_BUTTON_PREFIX}work`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("作業")
      .setEmoji("☕")
  );

export const buildUserLimitButtons = (): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${LIMIT_BUTTON_PREFIX}4`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("4人"),
    new ButtonBuilder()
      .setCustomId(`${LIMIT_BUTTON_PREFIX}6`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("6人"),
    new ButtonBuilder()
      .setCustomId(LIMIT_CUSTOM_BUTTON_ID)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("人数指定")
      .setEmoji("🔢"),
    new ButtonBuilder()
      .setCustomId(OTHER_SETTINGS_BUTTON_ID)
      .setStyle(ButtonStyle.Secondary)
      .setLabel("その他の設定")
      .setEmoji("⚙️"),
    new ButtonBuilder()
      .setCustomId(TEMPLATE_BUTTON_ID)
      .setStyle(ButtonStyle.Primary)
      .setLabel("テンプレート")
      .setEmoji("🗂️")
  );

export const buildOtherSettingsSelect = (
  isPrivate: boolean
): ActionRowBuilder<StringSelectMenuBuilder> => {
  const options: { label: string; value: string; description?: string }[] = [
    {
      label: isPrivate ? "VCを公開にする" : "VCを非公開にする",
      value: TOGGLE_PRIVATE_OPTION_VALUE
    },
    {
      label: "ホワイトリストを管理",
      value: MANAGE_WHITELIST_OPTION_VALUE
    },
    {
      label: "ブラックリストを管理",
      value: MANAGE_BLACKLIST_OPTION_VALUE
    }
  ];

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(OTHER_SETTINGS_SELECT_ID)
      .setPlaceholder("その他の設定")
      .addOptions(options)
  );
};

export const buildSettingsComponents = (): Array<ActionRowBuilder<ButtonBuilder>> => [
  buildSettingsButtons(),
  buildUserLimitButtons()
];

export const buildAccessListAddSelectId = (kind: AccessListKind): string =>
  `${ACCESS_LIST_ADD_SELECT_PREFIX}${kind}`;

export const buildAccessListRemoveSelectId = (kind: AccessListKind): string =>
  `${ACCESS_LIST_REMOVE_SELECT_PREFIX}${kind}`;

export type AccessListSelectOption = {
  userId: string;
  label: string;
};

export const buildAccessListManagementComponents = (
  kind: AccessListKind,
  existingUsers: AccessListSelectOption[]
): Array<ActionRowBuilder<UserSelectMenuBuilder | StringSelectMenuBuilder>> => {
  const addRow = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(buildAccessListAddSelectId(kind))
      .setPlaceholder(`${ACCESS_LIST_LABELS[kind]}に追加`)
      .setMinValues(1)
      .setMaxValues(1)
  );

  const removeSelect = new StringSelectMenuBuilder()
    .setCustomId(buildAccessListRemoveSelectId(kind))
    .setPlaceholder(existingUsers.length > 0 ? `${ACCESS_LIST_LABELS[kind]}から除外` : "除外対象がありません")
    .setDisabled(existingUsers.length === 0)
    .setMinValues(1)
    .setMaxValues(Math.max(1, Math.min(existingUsers.length, 25)));

  if (existingUsers.length > 0) {
    removeSelect.addOptions(
      existingUsers.slice(0, 25).map((entry) => ({
        label: entry.label,
        value: entry.userId
      }))
    );
  } else {
    removeSelect.addOptions({
      label: "対象なし",
      value: "__none__"
    });
  }

  const removeRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect);
  return [addRow, removeRow];
};

export const buildNameEditModal = (defaultName?: string): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(NAME_INPUT_ID)
    .setLabel("VC名")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(32);

  if (defaultName) {
    input.setValue(defaultName);
  }

  return new ModalBuilder()
    .setCustomId(NAME_MODAL_ID)
    .setTitle("通話名を変更")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};

export const buildUserLimitEditModal = (defaultUserLimit?: number): ModalBuilder => {
  const input = new TextInputBuilder()
    .setCustomId(LIMIT_INPUT_ID)
    .setLabel("人数上限 (0-99)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2)
    .setPlaceholder("0")
    .setValue(String(defaultUserLimit ?? 0));

  return new ModalBuilder()
    .setCustomId(LIMIT_MODAL_ID)
    .setTitle("人数上限を設定")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
};
