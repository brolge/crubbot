import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import {
  COUNTER_TYPE_CONFIG,
  COUNTER_TYPE_ORDER,
  getServerCounters,
  saveServerCounters,
  updateCounter,
  getCounterTypeLabel,
  getGuildCounterStats,
  formatCounterChannelName,
} from '../../../services/serverstatsService.js';

const DASH_ID = 'ss_dash';

async function createCounterChannel(guild, {
  type,
  categoryId,
  channelType = ChannelType.GuildVoice,
  actorTag,
}) {
  const stats = await getGuildCounterStats(guild);
  const count =
    type === 'members' ? stats.totalCount :
    type === 'members_only' ? stats.humanCount :
    type === 'bots' ? stats.botCount :
    type === 'boosts' ? stats.boostCount :
    0;

  const channel = await guild.channels.create({
    name: formatCounterChannelName(type, count),
    type: channelType,
    parent: categoryId,
    reason: `Server stats channel created by ${actorTag}`,
    permissionOverwrites: channelType === ChannelType.GuildVoice
      ? [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect],
          },
        ]
      : [],
  });

  return channel;
}

function buildDashboardEmbed(counters, stats, categoryId, channelKind) {
  const lines = COUNTER_TYPE_ORDER.map((type) => {
    const existing = counters.find((c) => c.type === type);
    const count =
      type === 'members' ? stats.totalCount :
      type === 'members_only' ? stats.humanCount :
      type === 'bots' ? stats.botCount :
      stats.boostCount;
    const preview = formatCounterChannelName(type, count);
    if (existing) {
      return `✅ **${getCounterTypeLabel(type)}** — <#${existing.channelId}>\n\`${preview}\``;
    }
    return `⬜ **${getCounterTypeLabel(type)}** — not configured\n\`${preview}\``;
  });

  return new EmbedBuilder()
    .setTitle('📊 Server Stats Dashboard')
    .setDescription(
      'Configure voice/text channels that show live server counts.\n' +
      'Name format matches classic panels: `『📊』 all-members-68`\n\n' +
      lines.join('\n\n'),
    )
    .addFields(
      {
        name: 'Category',
        value: categoryId ? `<#${categoryId}>` : '`Not selected`',
        inline: true,
      },
      {
        name: 'Channel type',
        value: channelKind === 'text' ? 'Text' : 'Voice (recommended)',
        inline: true,
      },
      {
        name: 'Live counts',
        value: `All **${stats.totalCount}** · Members **${stats.humanCount}** · Bots **${stats.botCount}** · Boosts **${stats.boostCount}**`,
        inline: false,
      },
    )
    .setColor(getColor('info'))
    .setFooter({ text: 'Updates on join/leave and every ~15 minutes' });
}

function buildComponents(counters, categoryId, channelKind) {
  const missing = COUNTER_TYPE_ORDER.filter((type) => !counters.some((c) => c.type === type));

  const categoryRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId(`${DASH_ID}_category`)
      .setPlaceholder('Select stats category…')
      .addChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1),
  );

  const typeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${DASH_ID}_create`)
      .setPlaceholder(categoryId ? 'Create a missing counter…' : 'Select a category first')
      .setDisabled(!categoryId || missing.length === 0)
      .addOptions(
        (missing.length ? missing : ['members']).map((type) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(getCounterTypeLabel(type))
            .setDescription(formatCounterChannelName(type, 0).replace('-0', '-N'))
            .setValue(type)
            .setEmoji(COUNTER_TYPE_CONFIG[type]?.emoji || '📊'),
        ),
      ),
  );

  const deleteRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${DASH_ID}_delete`)
      .setPlaceholder(counters.length ? 'Delete a counter…' : 'No counters to delete')
      .setDisabled(counters.length === 0)
      .addOptions(
        (counters.length ? counters : [{ id: 'none', type: 'members' }]).slice(0, 25).map((counter) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(getCounterTypeLabel(counter.type))
            .setDescription(`ID ${counter.id}`)
            .setValue(counter.id),
        ),
      ),
  );

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DASH_ID}_kind`)
      .setLabel(channelKind === 'text' ? 'Using: Text' : 'Using: Voice')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${DASH_ID}_create_all`)
      .setLabel('Create All Missing')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!categoryId || missing.length === 0),
    new ButtonBuilder()
      .setCustomId(`${DASH_ID}_refresh`)
      .setLabel('Refresh Names')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(counters.length === 0),
    new ButtonBuilder()
      .setCustomId(`${DASH_ID}_close`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Danger),
  );

  return [categoryRow, typeRow, deleteRow, buttonRow];
}

export async function runServerStatsDashboard(interaction, client) {
  const guild = interaction.guild;
  let counters = await getServerCounters(client, guild.id);
  let stats = await getGuildCounterStats(guild);
  let categoryId = null;
  let channelKind = 'voice';

  // Prefer an existing counter parent as the default category
  for (const counter of counters) {
    const channel = guild.channels.cache.get(counter.channelId);
    if (channel?.parentId) {
      categoryId = channel.parentId;
      break;
    }
  }

  const render = async (targetInteraction, mode = 'edit') => {
    counters = await getServerCounters(client, guild.id);
    stats = await getGuildCounterStats(guild);
    const payload = {
      embeds: [buildDashboardEmbed(counters, stats, categoryId, channelKind)],
      components: buildComponents(counters, categoryId, channelKind),
    };
    if (mode === 'reply') {
      await InteractionHelper.safeEditReply(targetInteraction, payload);
    } else if (targetInteraction.update) {
      await targetInteraction.update(payload).catch(async () => {
        await InteractionHelper.safeEditReply(interaction, payload);
      });
    } else {
      await InteractionHelper.safeEditReply(interaction, payload);
    }
  };

  await render(interaction, 'reply');

  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(DASH_ID),
    time: 600_000,
  });

  collector.on('collect', async (comp) => {
    try {
      if (comp.customId === `${DASH_ID}_close`) {
        collector.stop('closed');
        await comp.update({
          embeds: [successEmbed('Dashboard Closed', 'Server stats dashboard closed.')],
          components: [],
        });
        return;
      }

      if (comp.customId === `${DASH_ID}_kind`) {
        channelKind = channelKind === 'voice' ? 'text' : 'voice';
        await render(comp);
        return;
      }

      if (comp.customId === `${DASH_ID}_category` && comp.isChannelSelectMenu()) {
        categoryId = comp.values[0];
        await render(comp);
        return;
      }

      if (comp.customId === `${DASH_ID}_refresh`) {
        await comp.deferUpdate();
        counters = await getServerCounters(client, guild.id);
        for (const counter of counters) {
          await updateCounter(client, guild, counter);
        }
        await render(interaction, 'reply');
        await comp.followUp({
          embeds: [successEmbed('Refreshed', 'Counter channel names were updated.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (comp.customId === `${DASH_ID}_create` && comp.isStringSelectMenu()) {
        if (!categoryId) {
          await replyUserError(comp, {
            type: ErrorTypes.VALIDATION,
            message: 'Select a category first.',
          });
          return;
        }

        const type = comp.values[0];
        counters = await getServerCounters(client, guild.id);
        if (counters.some((c) => c.type === type)) {
          await replyUserError(comp, {
            type: ErrorTypes.VALIDATION,
            message: `A ${getCounterTypeLabel(type)} counter already exists.`,
          });
          return;
        }

        await comp.deferUpdate();
        const channelType = channelKind === 'text' ? ChannelType.GuildText : ChannelType.GuildVoice;
        const channel = await createCounterChannel(guild, {
          type,
          categoryId,
          channelType,
          actorTag: interaction.user.tag,
        });

        const newCounter = {
          id: Date.now().toString(),
          type,
          channelId: channel.id,
          guildId: guild.id,
          createdAt: new Date().toISOString(),
          enabled: true,
        };
        counters.push(newCounter);
        await saveServerCounters(client, guild.id, counters);
        await updateCounter(client, guild, newCounter);
        await render(interaction, 'reply');
        return;
      }

      if (comp.customId === `${DASH_ID}_create_all`) {
        if (!categoryId) {
          await replyUserError(comp, {
            type: ErrorTypes.VALIDATION,
            message: 'Select a category first.',
          });
          return;
        }

        await comp.deferUpdate();
        counters = await getServerCounters(client, guild.id);
        const channelType = channelKind === 'text' ? ChannelType.GuildText : ChannelType.GuildVoice;
        const missing = COUNTER_TYPE_ORDER.filter((type) => !counters.some((c) => c.type === type));

        for (const type of missing) {
          const channel = await createCounterChannel(guild, {
            type,
            categoryId,
            channelType,
            actorTag: interaction.user.tag,
          });
          const newCounter = {
            id: `${Date.now()}-${type}`,
            type,
            channelId: channel.id,
            guildId: guild.id,
            createdAt: new Date().toISOString(),
            enabled: true,
          };
          counters.push(newCounter);
          await saveServerCounters(client, guild.id, counters);
          await updateCounter(client, guild, newCounter);
        }

        await render(interaction, 'reply');
        await comp.followUp({
          embeds: [successEmbed('Counters Created', `Created **${missing.length}** stats channel(s).`)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (comp.customId === `${DASH_ID}_delete` && comp.isStringSelectMenu()) {
        const counterId = comp.values[0];
        await comp.deferUpdate();
        counters = await getServerCounters(client, guild.id);
        const target = counters.find((c) => c.id === counterId);
        if (!target) {
          await render(interaction, 'reply');
          return;
        }

        const channel = guild.channels.cache.get(target.channelId);
        if (channel) {
          await channel.delete(`Server stats counter deleted by ${interaction.user.tag}`).catch(() => null);
        }

        counters = counters.filter((c) => c.id !== counterId);
        await saveServerCounters(client, guild.id, counters);
        await render(interaction, 'reply');
      }
    } catch (error) {
      logger.error('Server stats dashboard error:', error);
      await replyUserError(comp, {
        type: ErrorTypes.UNKNOWN,
        message: 'Something went wrong in the server stats dashboard.',
      }).catch(() => {});
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time') {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Dashboard Timed Out')
            .setDescription('Run `/serverstats dashboard` again to continue.')
            .setColor(getColor('warning')),
        ],
        components: [],
      }).catch(() => {});
    }
  });
}
