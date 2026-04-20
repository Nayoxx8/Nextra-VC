import type { AccessControlLists, AccessListKind, VcTemplateRecord } from "../types.js";
import prisma from "../lib/prisma.js";

type UserPreference = {
  user_id: string;
  icon: string;
  name: string;
  user_limit: number;
  is_private: boolean;
};

type HubRecord = {
  guild_id: string;
  category_id: string;
  creator_voice_channel_id: string;
  settings_text_channel_id: string;
};

type GeneratedVcRecord = {
  channel_id: string;
  guild_id: string;
  owner_user_id: string;
  base_name: string;
};

const toUserPreference = (row: {
  userId: string;
  icon: string;
  name: string;
  userLimit: number;
  isPrivate: boolean;
}): UserPreference => ({
  user_id: row.userId,
  icon: row.icon,
  name: row.name,
  user_limit: row.userLimit,
  is_private: row.isPrivate
});

const toHubRecord = (row: {
  guildId: string;
  categoryId: string;
  creatorVoiceChannelId: string;
  settingsTextChannelId: string;
}): HubRecord => ({
  guild_id: row.guildId,
  category_id: row.categoryId,
  creator_voice_channel_id: row.creatorVoiceChannelId,
  settings_text_channel_id: row.settingsTextChannelId
});

const toGeneratedVcRecord = (row: {
  channelId: string;
  guildId: string;
  ownerUserId: string;
  baseName: string;
}): GeneratedVcRecord => ({
  channel_id: row.channelId,
  guild_id: row.guildId,
  owner_user_id: row.ownerUserId,
  base_name: row.baseName
});

const toVcTemplateRecord = (row: {
  ownerUserId: string;
  slot: number;
  templateName: string;
  icon: string;
  vcName: string;
  userLimit: number;
  isPrivate: boolean;
}): VcTemplateRecord => ({
  owner_user_id: row.ownerUserId,
  slot: row.slot as 1 | 2 | 3,
  template_name: row.templateName,
  icon: row.icon,
  vc_name: row.vcName,
  user_limit: row.userLimit,
  is_private: row.isPrivate
});

export class VcRepository {
  public async getOrCreateUserPreference(
    userId: string,
    defaults: { icon: string; name: string }
  ): Promise<UserPreference> {
    const row = await prisma.userPreference.upsert({
      where: { userId },
      create: {
        userId,
        icon: defaults.icon,
        name: defaults.name,
        userLimit: 0,
        isPrivate: false
      },
      update: {}
    });

    return toUserPreference(row);
  }

  public async updateUserPreference(
    userId: string,
    patch: Partial<Pick<UserPreference, "icon" | "name" | "user_limit" | "is_private">>,
    defaults: { icon: string; name: string }
  ): Promise<UserPreference> {
    await this.getOrCreateUserPreference(userId, defaults);

    const fields = Object.keys(patch) as (keyof typeof patch)[];
    if (fields.length === 0) {
      return this.getOrCreateUserPreference(userId, defaults);
    }

    const prismaData: {
      icon?: string;
      name?: string;
      userLimit?: number;
      isPrivate?: boolean;
    } = {};

    if (patch.icon !== undefined) prismaData.icon = patch.icon;
    if (patch.name !== undefined) prismaData.name = patch.name;
    if (patch.user_limit !== undefined) prismaData.userLimit = patch.user_limit;
    if (patch.is_private !== undefined) prismaData.isPrivate = patch.is_private;

    const row = await prisma.userPreference.update({
      where: { userId },
      data: prismaData
    });

    return toUserPreference(row);
  }

  public async findHubByGuild(guildId: string): Promise<HubRecord | null> {
    const row = await prisma.vcHub.findUnique({ where: { guildId } });
    return row ? toHubRecord(row) : null;
  }

  public async findHubByCreatorChannel(channelId: string): Promise<HubRecord | null> {
    const row = await prisma.vcHub.findFirst({
      where: { creatorVoiceChannelId: channelId }
    });
    return row ? toHubRecord(row) : null;
  }

  public async findHubByCategoryId(categoryId: string): Promise<HubRecord | null> {
    const row = await prisma.vcHub.findFirst({ where: { categoryId } });
    return row ? toHubRecord(row) : null;
  }

  public async listHubs(): Promise<HubRecord[]> {
    const rows = await prisma.vcHub.findMany();
    return rows.map(toHubRecord);
  }

  public async upsertHub(record: HubRecord): Promise<void> {
    await prisma.vcHub.upsert({
      where: { guildId: record.guild_id },
      create: {
        guildId: record.guild_id,
        categoryId: record.category_id,
        creatorVoiceChannelId: record.creator_voice_channel_id,
        settingsTextChannelId: record.settings_text_channel_id
      },
      update: {
        categoryId: record.category_id,
        creatorVoiceChannelId: record.creator_voice_channel_id,
        settingsTextChannelId: record.settings_text_channel_id
      }
    });
  }

  public async upsertGeneratedVc(record: GeneratedVcRecord): Promise<void> {
    await prisma.generatedVc.upsert({
      where: { channelId: record.channel_id },
      create: {
        channelId: record.channel_id,
        guildId: record.guild_id,
        ownerUserId: record.owner_user_id,
        baseName: record.base_name
      },
      update: {
        guildId: record.guild_id,
        ownerUserId: record.owner_user_id,
        baseName: record.base_name
      }
    });
  }

  public async findGeneratedVcByChannel(channelId: string): Promise<GeneratedVcRecord | null> {
    const row = await prisma.generatedVc.findUnique({ where: { channelId } });
    return row ? toGeneratedVcRecord(row) : null;
  }

  public async updateGeneratedVcBaseName(channelId: string, baseName: string): Promise<void> {
    await prisma.generatedVc.update({
      where: { channelId },
      data: { baseName }
    });
  }

  public async deleteGeneratedVc(channelId: string): Promise<void> {
    await prisma.generatedVc.deleteMany({ where: { channelId } });
  }

  public async listGeneratedVcs(): Promise<GeneratedVcRecord[]> {
    const rows = await prisma.generatedVc.findMany();
    return rows.map(toGeneratedVcRecord);
  }

  public async getAccessControlLists(ownerUserId: string): Promise<AccessControlLists> {
    const rows = await prisma.userPreferenceAccessList.findMany({
      where: { ownerUserId }
    });

    const whitelist: string[] = [];
    const blacklist: string[] = [];

    for (const row of rows) {
      if (row.listType === "whitelist") {
        whitelist.push(row.targetUserId);
      } else if (row.listType === "blacklist") {
        blacklist.push(row.targetUserId);
      }
    }

    return { whitelist, blacklist };
  }

  public async upsertAccessListEntry(
    ownerUserId: string,
    targetUserId: string,
    listType: AccessListKind
  ): Promise<void> {
    await prisma.userPreferenceAccessList.upsert({
      where: {
        ownerUserId_targetUserId_listType: { ownerUserId, targetUserId, listType }
      },
      create: { ownerUserId, targetUserId, listType },
      update: {}
    });
  }

  public async removeAccessListEntries(
    ownerUserId: string,
    listType: AccessListKind,
    targetUserIds: string[]
  ): Promise<void> {
    if (targetUserIds.length === 0) {
      return;
    }

    await prisma.userPreferenceAccessList.deleteMany({
      where: {
        ownerUserId,
        listType,
        targetUserId: { in: targetUserIds }
      }
    });
  }

  public async getTemplates(ownerUserId: string): Promise<VcTemplateRecord[]> {
    const rows = await prisma.userVcTemplate.findMany({
      where: { ownerUserId },
      orderBy: { slot: "asc" }
    });

    return rows.map(toVcTemplateRecord);
  }

  public async upsertTemplate(record: VcTemplateRecord): Promise<void> {
    await prisma.userVcTemplate.upsert({
      where: {
        ownerUserId_slot: { ownerUserId: record.owner_user_id, slot: record.slot }
      },
      create: {
        ownerUserId: record.owner_user_id,
        slot: record.slot,
        templateName: record.template_name,
        icon: record.icon,
        vcName: record.vc_name,
        userLimit: record.user_limit,
        isPrivate: record.is_private
      },
      update: {
        templateName: record.template_name,
        icon: record.icon,
        vcName: record.vc_name,
        userLimit: record.user_limit,
        isPrivate: record.is_private
      }
    });
  }

  public async deleteTemplate(ownerUserId: string, slot: number): Promise<void> {
    await prisma.userVcTemplate.deleteMany({
      where: { ownerUserId, slot }
    });
  }

  public async upsertTimeSlotRole(guildId: string, timeSlot: string, roleId: string): Promise<void> {
    await prisma.timeSlotRole.upsert({
      where: { guildId_timeSlot: { guildId, timeSlot } },
      create: { guildId, timeSlot, roleId },
      update: { roleId }
    });
  }

  public async getTimeSlotRole(guildId: string, timeSlot: string): Promise<string | null> {
    const row = await prisma.timeSlotRole.findUnique({
      where: { guildId_timeSlot: { guildId, timeSlot } }
    });
    return row?.roleId ?? null;
  }
}
