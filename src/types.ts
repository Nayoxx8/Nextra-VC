import type { Guild } from "discord.js";
import type { VcRepository } from "./repositories/vcRepository.js";

export type BotDefaults = {
  icon: string;
  name: string;
};

export type AccessListKind = "whitelist" | "blacklist";

export type AccessControlLists = {
  whitelist: string[];
  blacklist: string[];
};

export type BotContext = {
  repo: VcRepository;
  defaults: BotDefaults;
};

export type RenameParams = {
  guild: Guild;
  userId: string;
  context: BotContext;
};

export type VcTemplateRecord = {
  owner_user_id: string;
  slot: 1 | 2 | 3;
  template_name: string;
  icon: string;
  vc_name: string;
  user_limit: number;
  is_private: boolean;
};
