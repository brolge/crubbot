import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { MANAGED_CHANNEL_PERMISSIONS } from '../../../services/channelPermissionTemplateService.js';
import {
  QUICK_PRESETS,
  aggregateOverwriteStates,
  applyOverwritePatch,
  applyQuickThreatResponse,
} from '../../../services/channelPermsService.js';

const DASH = 'chperm';
const TIMEOUT_MS = 10 * 60 * 1000;

const LABELS = {
  ViewChannel: 'View Channel',
  ReadMessageHistory: 'Read History',
  SendMessages: 'Send Messages',
  CreatePublicThreads: 'Public Threads',
  CreatePrivateThreads: 'Private Threads',
  SendMessagesInThreads: 'Thread Messages',
  AddReactions: 'Add Reactions',
  ManageMessages: 'Manage Messages',
};

const STATE_ICON = {
  allow: '✅',
  deny: '⛔',
  inherit: '➖',
  mixed: '🔀',
};

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function resolveChannels(guild, channelIds) {
  return channelIds
    .map((id) => guild.channels.cache.get(id))
    .filter((channel) => channel?.permissionOverwrites?.edit);
}

function formatFailures(failures) {
  if (!failures?.length) return '';
  const shown = failures.slice(0, 8).map((f) => `• <#${f.channelId}>: ${f.error}`).join('\n');
  const more = failures.length > 8 ? `\n…and ${failures.length - 8} more` : '';
  return `\n\n**Failures (${failures.length}):**\n${shown}${more}`;
}

function buildHomeEmbed(guild, state) {
  const channels = resolveChannels(guild, state.channelIds);
  const roleId = state.roleId || guild.id;
  const roleLabel = roleId === guild.id ? '@everyone' : `<@&${roleId}>`;
  const exceptions = state.exceptionRoleIds.length
    ? state.exceptionRoleIds.map((id) => `<@&${id}>`).join(', ')
    : '`None — optional staff exceptions for quick actions`';

  const embed = new EmbedBuilder()
    .setTitle('🔐 Live Channel Permissions')
    .setColor(getColor('info'))
    .setDescription(
      'Pick **channels** + a **role**, then toggle perms or hit a quick threat action.\n' +
      'Quick actions deny for the target role and **allow** the same perms for exception roles.',
    )
    .addFields(
      {
        name: 'Channels',
        value: channels.length
          ? channels.map((c) => `<#${c.id}>`).join(' ')
          : '`None selected — use the channel menu (lists every channel)`',
        inline: false,
      },
      { name: 'Target role', value: roleLabel, inline: true },
      { name: 'Exception roles', value: exceptions, inline: false },
    )
    .setFooter({ text: '✅ allow · ⛔ deny · ➖ inherit · 🔀 mixed across channels' });

  if (channels.length) {
    const states = aggregateOverwriteStates(channels, roleId);
    const lines = MANAGED_CHANNEL_PERMISSIONS.map((permission) => {
      const stateValue = states[permission];
      return `${STATE_ICON[stateValue] || '❓'} **${LABELS[permission]}** — ${stateValue}`;
    });
    embed.addFields({ name: 'Current overwrite (target role)', value: lines.join('\n') });
  }

  return embed;
}

function buildHomeComponents(guild, state) {
  const hasChannels = state.channelIds.length > 0;
  const roleId = state.roleId || guild.id;

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`${DASH}_channels`)
    .setPlaceholder('Select channels to control…')
    .setMinValues(1)
    .setMaxValues(25)
    .addChannelTypes(
      ChannelType.GuildText,
      ChannelType.GuildAnnouncement,
      ChannelType.GuildVoice,
      ChannelType.GuildStageVoice,
      ChannelType.GuildForum,
      ChannelType.GuildCategory,
    );
  if (state.channelIds.length) channelSelect.setDefaultChannels(state.channelIds);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`${DASH}_role`)
    .setPlaceholder('Target role (or pick @everyone from roles)')
    .setMinValues(1)
    .setMaxValues(1);
  if (roleId && roleId !== guild.id) roleSelect.setDefaultRoles(roleId);

  const denySelect = new StringSelectMenuBuilder()
    .setCustomId(`${DASH}_deny`)
    .setPlaceholder(hasChannels ? '⛔ Deny these permissions…' : 'Select channels first')
    .setDisabled(!hasChannels)
    .setMinValues(0)
    .setMaxValues(MANAGED_CHANNEL_PERMISSIONS.length)
    .addOptions(MANAGED_CHANNEL_PERMISSIONS.map((permission) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(LABELS[permission])
        .setValue(permission)
        .setEmoji('⛔'),
    ));

  const allowSelect = new StringSelectMenuBuilder()
    .setCustomId(`${DASH}_allow`)
    .setPlaceholder(hasChannels ? '✅ Allow these permissions…' : 'Select channels first')
    .setDisabled(!hasChannels)
    .setMinValues(0)
    .setMaxValues(MANAGED_CHANNEL_PERMISSIONS.length)
    .addOptions(MANAGED_CHANNEL_PERMISSIONS.map((permission) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(LABELS[permission])
        .setValue(permission)
        .setEmoji('✅'),
    ));

  // Discord max 5 rows — put quick actions + inherit/close on button rows via a second message flow
  // Row budget: channels, role, deny, allow = 4. Need buttons on row 5.
  const buttons = row(
    new ButtonBuilder()
      .setCustomId(`${DASH}_mute`)
      .setLabel('Mute Chat')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasChannels),
    new ButtonBuilder()
      .setCustomId(`${DASH}_noreact`)
      .setLabel('Stop Reactions')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasChannels),
    new ButtonBuilder()
      .setCustomId(`${DASH}_lock`)
      .setLabel('Lock')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasChannels),
    new ButtonBuilder()
      .setCustomId(`${DASH}_more`)
      .setLabel('More…')
      .setStyle(ButtonStyle.Secondary),
  );

  return [
    row(channelSelect),
    row(roleSelect),
    row(denySelect),
    row(allowSelect),
    buttons,
  ];
}

function buildMoreComponents(hasChannels) {
  return [
    row(
      new StringSelectMenuBuilder()
        .setCustomId(`${DASH}_inherit`)
        .setPlaceholder(hasChannels ? '➖ Reset these to inherit…' : 'Select channels first')
        .setDisabled(!hasChannels)
        .setMinValues(1)
        .setMaxValues(MANAGED_CHANNEL_PERMISSIONS.length)
        .addOptions(MANAGED_CHANNEL_PERMISSIONS.map((permission) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(LABELS[permission])
            .setValue(permission),
        )),
    ),
    row(
      new RoleSelectMenuBuilder()
        .setCustomId(`${DASH}_exceptions`)
        .setPlaceholder('Exception roles (kept allowed during quick actions)')
        .setMinValues(0)
        .setMaxValues(25),
    ),
    row(
      new ButtonBuilder()
        .setCustomId(`${DASH}_everyone`)
        .setLabel('Target @everyone')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${DASH}_stopmsg`)
        .setLabel('Stop Messaging')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(!hasChannels),
      new ButtonBuilder()
        .setCustomId(`${DASH}_back`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${DASH}_close`)
        .setLabel('Close')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

export async function runChannelPermsDashboard(interaction, client) {
  const guild = interaction.guild;
  const state = {
    channelIds: [],
    roleId: guild.id,
    exceptionRoleIds: [],
    view: 'home',
  };

  const render = async (comp) => {
    const hasChannels = state.channelIds.length > 0;
    const payload = {
      embeds: [buildHomeEmbed(guild, state)],
      components: state.view === 'more'
        ? buildMoreComponents(hasChannels)
        : buildHomeComponents(guild, state),
    };
    if (comp?.update && !comp.deferred && !comp.replied) {
      await comp.update(payload).catch(async () => {
        await InteractionHelper.safeEditReply(interaction, payload);
      });
    } else {
      await InteractionHelper.safeEditReply(interaction, payload);
    }
  };

  await render();

  const collector = interaction.channel.createMessageComponentCollector({
    filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith(DASH),
    time: TIMEOUT_MS,
  });

  const applyPermSet = async (comp, permissions, mode) => {
    if (!state.channelIds.length) {
      await replyUserError(comp, {
        type: ErrorTypes.VALIDATION,
        message: 'Select at least one channel first.',
      });
      return;
    }

    const patch = {};
    for (const permission of permissions) {
      patch[permission] = mode === 'allow' ? true : mode === 'deny' ? false : null;
    }

    await comp.deferUpdate();
    const result = await applyOverwritePatch(
      guild,
      state.channelIds,
      state.roleId || guild.id,
      patch,
      `Channel perms ${mode} by ${interaction.user.tag}`,
    );
    await render();
    await comp.followUp({
      embeds: [
        result.failures.length
          ? warningEmbed(
            'Partial Update',
            `Updated **${result.applied}/${result.attempted}** channels.${formatFailures(result.failures)}`,
          )
          : successEmbed(
            'Permissions Updated',
            `Set **${mode}** on **${permissions.map((p) => LABELS[p]).join(', ')}** for ` +
            `${state.roleId === guild.id ? '@everyone' : `<@&${state.roleId}>`} across **${result.applied}** channel(s).`,
          ),
      ],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  };

  const runQuick = async (comp, presetKey) => {
    if (!state.channelIds.length) {
      await replyUserError(comp, {
        type: ErrorTypes.VALIDATION,
        message: 'Select at least one channel first.',
      });
      return;
    }

    await comp.deferUpdate();
    const result = await applyQuickThreatResponse(guild, {
      channelIds: state.channelIds,
      targetRoleId: state.roleId || guild.id,
      exceptionRoleIds: state.exceptionRoleIds,
      presetKey,
      reason: `${QUICK_PRESETS[presetKey].label} by ${interaction.user.tag}`,
    });

    await render();
    const exceptionApplied = result.exceptions.reduce((sum, item) => sum + item.applied, 0);
    const failures = [
      ...result.target.failures,
      ...result.exceptions.flatMap((item) => item.failures),
    ];
    await comp.followUp({
      embeds: [
        failures.length
          ? warningEmbed(
            `${QUICK_PRESETS[presetKey].label} — Partial`,
            `Target role: **${result.target.applied}** channel(s). Exceptions: **${exceptionApplied}**.` +
            formatFailures(failures),
          )
          : successEmbed(
            QUICK_PRESETS[presetKey].label,
            `${QUICK_PRESETS[presetKey].description}.\n` +
            `Denied for ${state.roleId === guild.id ? '@everyone' : `<@&${state.roleId}>`} on **${result.target.applied}** channel(s).` +
            (state.exceptionRoleIds.length
              ? `\nAllowed exceptions on **${exceptionApplied}** overwrite(s).`
              : ''),
          ),
      ],
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  };

  collector.on('collect', async (comp) => {
    try {
      const id = comp.customId;

      if (id === `${DASH}_close`) {
        collector.stop('closed');
        await comp.update({
          embeds: [successEmbed('Closed', 'Channel permissions dashboard closed.')],
          components: [],
        });
        return;
      }

      if (id === `${DASH}_more`) {
        state.view = 'more';
        await render(comp);
        return;
      }

      if (id === `${DASH}_back`) {
        state.view = 'home';
        await render(comp);
        return;
      }

      if (id === `${DASH}_channels` && comp.isChannelSelectMenu()) {
        state.channelIds = [...comp.values];
        await render(comp);
        return;
      }

      if (id === `${DASH}_role` && comp.isRoleSelectMenu()) {
        state.roleId = comp.values[0];
        await render(comp);
        return;
      }

      if (id === `${DASH}_everyone`) {
        state.roleId = guild.id;
        state.view = 'home';
        await render(comp);
        return;
      }

      if (id === `${DASH}_exceptions` && comp.isRoleSelectMenu()) {
        state.exceptionRoleIds = [...comp.values];
        await render(comp);
        await comp.followUp({
          embeds: [successEmbed(
            'Exceptions Updated',
            state.exceptionRoleIds.length
              ? `Quick actions will keep: ${state.exceptionRoleIds.map((id) => `<@&${id}>`).join(', ')}`
              : 'No exception roles set.',
          )],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (id === `${DASH}_deny` && comp.isStringSelectMenu()) {
        if (!comp.values.length) {
          await comp.deferUpdate();
          return;
        }
        await applyPermSet(comp, comp.values, 'deny');
        return;
      }

      if (id === `${DASH}_allow` && comp.isStringSelectMenu()) {
        if (!comp.values.length) {
          await comp.deferUpdate();
          return;
        }
        await applyPermSet(comp, comp.values, 'allow');
        return;
      }

      if (id === `${DASH}_inherit` && comp.isStringSelectMenu()) {
        await applyPermSet(comp, comp.values, 'inherit');
        return;
      }

      if (id === `${DASH}_mute`) {
        await runQuick(comp, 'muteOnly');
        return;
      }

      if (id === `${DASH}_noreact`) {
        await runQuick(comp, 'stopReactions');
        return;
      }

      if (id === `${DASH}_stopmsg`) {
        await runQuick(comp, 'stopMessaging');
        return;
      }

      if (id === `${DASH}_lock`) {
        await runQuick(comp, 'lockChannel');
        return;
      }
    } catch (error) {
      logger.error('Channel perms dashboard error:', error);
      await replyUserError(comp, {
        type: ErrorTypes.UNKNOWN,
        message: 'Something went wrong updating channel permissions.',
      }).catch(() => {});
    }
  });

  collector.on('end', async (_collected, reason) => {
    if (reason === 'time') {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setTitle('Dashboard Timed Out')
            .setDescription('Run `/channelperms dashboard` again to continue.')
            .setColor(getColor('warning')),
        ],
        components: [],
      }).catch(() => {});
    }
  });
}
