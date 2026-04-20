import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import type { BotContext } from "../types.js";
import { TIME_SLOT_CHOICES, type TimeSlot } from "../utils/timeSlot.js";

export const setRecruitmentRoleCommand = new SlashCommandBuilder()
  .setName("set_recruitment_role")
  .setDescription("時間帯ごとの通話募集メンションロールを設定します")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName("slot")
      .setDescription("時間帯")
      .setRequired(true)
      .addChoices(...TIME_SLOT_CHOICES)
  )
  .addRoleOption((option) =>
    option.setName("role").setDescription("メンションするロール").setRequired(true)
  );

export const executeSetRecruitmentRole = async (
  interaction: ChatInputCommandInteraction,
  context: BotContext
): Promise<void> => {
  if (!interaction.guild) {
    await interaction.reply({
      content: "このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const slot = interaction.options.getString("slot", true) as TimeSlot;
  const role = interaction.options.getRole("role", true);

  await context.repo.upsertTimeSlotRole(interaction.guild.id, slot, role.id);

  const slotLabel = TIME_SLOT_CHOICES.find((c) => c.value === slot)?.name ?? slot;
  await interaction.reply({
    content: `${slotLabel} の通話募集ロールを ${role} に設定しました。`,
    flags: MessageFlags.Ephemeral
  });
};
