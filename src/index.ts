import { Client, Events, GatewayIntentBits } from "discord.js";
import { env } from "./config.js";
import { registerInteractionHandler } from "./interactionHandler.js";
import { VcRepository } from "./repositories/vcRepository.js";
import { registerCommandsOnReady } from "./registerCommands.js";
import { reconcileGeneratedVcsOnStartup } from "./services/reconciliationService.js";
import type { BotContext } from "./types.js";
import { registerVoiceStateHandler } from "./voiceStateHandler.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

const context: BotContext = {
  repo: new VcRepository(),
  defaults: {
    icon: env.DEFAULT_CHANNEL_ICON,
    name: env.DEFAULT_CHANNEL_NAME
  }
};

registerCommandsOnReady(client);
registerInteractionHandler(client, context);
registerVoiceStateHandler(client, context);

client.once(Events.ClientReady, async () => {
  try {
    await reconcileGeneratedVcsOnStartup(client, context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[startup-reconcile] ${message}`);
  }
});

client.login(env.DISCORD_TOKEN).catch((error) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`[startup] ${message}`);
  process.exitCode = 1;
});
