import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  MANAGED_CHANNEL_PERMISSIONS,
  applyPermissionTemplate,
  buildBulkApplyPreview,
  createPermissionTemplate,
  deletePermissionTemplate,
  listPermissionTemplates,
  updatePermissionTemplate,
} from '../../../services/channelPermissionTemplateService.js';
import { getColor } from '../../../config/bot.js';
import { logger } from '../../../utils/logger.js';

const PREFIX = 'perm_dash_';
const TIMEOUT_MS = 10 * 60 * 1000;

const LABELS = {
  ViewChannel: 'View Channel',
  ReadMessageHistory: 'Read History',
  SendMessages: 'Send Messages',
  CreatePublicThreads: 'Create Public Threads',
  CreatePrivateThreads: 'Create Private Threads',
  SendMessagesInThreads: 'Send in Threads',
  AddReactions: 'Add Reactions',
  ManageMessages: 'Manage Messages',
};

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function actionId(action) {
  return `${PREFIX}${action}`;
}

function templateOptions(templates, selectedId) {
  return templates.map((template) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(template.name)
      .setDescription('Select to manage or apply this template')
      .setValue(template.id)
      .setDefault(template.id === selectedId));
}

function stateIcon(state) {
  return state === 'allow' ? '✅' : state === 'deny' ? '⛔' : '➖';
}

function permissionSummary(template) {
  return MANAGED_CHANNEL_PERMISSIONS
    .map((permission) => `${stateIcon(template.permissions[permission])} **${LABELS[permission]}:** ${template.permissions[permission]}`)
    .join('\n');
}

function baseEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(getColor('info'))
    .setFooter({ text: 'Only the eight listed permissions are changed; all other overwrite bits are preserved.' });
}

function buildOverview(templates, state, guild) {
  const selected = templates.find((template) => template.id === state.selectedTemplateId) || null;
  const embed = baseEmbed(
    '🔐 Channel Permission Templates',
    `Create reusable role permission overwrites for **${guild.name}**.`,
  ).addFields({
    name: `Templates (${templates.length}/25)`,
    value: templates.length
      ? templates.map((template) => `${template.id === selected?.id ? '▶' : '•'} **${template.name}**`).join('\n')
      : 'No templates yet. Create one to get started.',
  });

  if (selected) {
    embed.addFields({ name: selected.name, value: permissionSummary(selected) });
  }

  const components = [];
  if (templates.length) {
    components.push(row(
      new StringSelectMenuBuilder()
        .setCustomId(actionId('template'))
        .setPlaceholder('Select a permission template')
        .addOptions(templateOptions(templates, selected?.id)),
    ));
  }
  components.push(row(
    new ButtonBuilder().setCustomId(actionId('create')).setLabel('Create').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(actionId('edit')).setLabel('Edit').setStyle(ButtonStyle.Primary).setDisabled(!selected),
    new ButtonBuilder().setCustomId(actionId('delete')).setLabel('Delete').setStyle(ButtonStyle.Danger).setDisabled(!selected),
    new ButtonBuilder().setCustomId(actionId('apply')).setLabel('Bulk Apply').setStyle(ButtonStyle.Secondary).setDisabled(!selected),
  ));
  return { embeds: [embed], components };
}

function permissionSelect(customId, placeholder, draft, selectedState) {
  return new StringSelectMenuBuilder()
    .setCustomId(actionId(customId))
    .setPlaceholder(placeholder)
    .setMinValues(0)
    .setMaxValues(MANAGED_CHANNEL_PERMISSIONS.length)
    .addOptions(MANAGED_CHANNEL_PERMISSIONS.map((permission) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(LABELS[permission])
        .setValue(permission)
        .setDefault(draft.permissions[permission] === selectedState)));
}

function buildEditor(state) {
  const embed = baseEmbed(
    `✏️ Edit ${state.draft.name}`,
    'Choose permissions to explicitly allow or deny. Anything in neither list inherits from the next overwrite.',
  ).addFields({ name: 'Current tri-state values', value: permissionSummary(state.draft) });

  return {
    embeds: [embed],
    components: [
      row(permissionSelect('allow', 'Explicitly allowed permissions', state.draft, 'allow')),
      row(permissionSelect('deny', 'Explicitly denied permissions', state.draft, 'deny')),
      row(
        new ButtonBuilder().setCustomId(actionId('save')).setLabel('Save').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(actionId('rename')).setLabel('Rename').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(actionId('back')).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildApply(state, template) {
  const editCount = state.roleIds.length * state.channelIds.length;
  const embed = baseEmbed(
    `📋 Apply ${template.name}`,
    'Select one or more roles and channels, then preview the exact bulk operation before confirming.',
  ).addFields(
    { name: 'Roles', value: state.roleIds.length ? state.roleIds.map((id) => `<@&${id}>`).join(' ') : 'None selected' },
    { name: 'Channels', value: state.channelIds.length ? state.channelIds.map((id) => `<#${id}>`).join(' ') : 'None selected' },
    { name: 'Planned edits', value: `${editCount}/100`, inline: true },
  );

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(actionId('roles'))
    .setPlaceholder('Select roles')
    .setMinValues(1)
    .setMaxValues(25);
  if (state.roleIds.length) roleSelect.setDefaultRoles(state.roleIds);

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(actionId('channels'))
    .setPlaceholder('Select channels')
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

  return {
    embeds: [embed],
    components: [
      row(roleSelect),
      row(channelSelect),
      row(
        new ButtonBuilder().setCustomId(actionId('preview')).setLabel('Preview').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(actionId('back')).setLabel('Back').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildConfirmation(state, template) {
  const preview = buildBulkApplyPreview(template, state.roleIds, state.channelIds);
  const embed = baseEmbed(
    '⚠️ Confirm Bulk Permission Apply',
    `This will make **${preview.editCount}** overwrite edits using **${template.name}**.`,
  ).addFields(
    { name: 'Roles', value: preview.roleIds.map((id) => `<@&${id}>`).join(' ') },
    { name: 'Channels', value: preview.channelIds.map((id) => `<#${id}>`).join(' ') },
    { name: 'Template values', value: permissionSummary(template) },
  ).setColor(getColor('warning'));

  return {
    embeds: [embed],
    components: [row(
      new ButtonBuilder().setCustomId(actionId('confirm')).setLabel(`Apply ${preview.editCount} Edits`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(actionId('apply_back')).setLabel('Back').setStyle(ButtonStyle.Secondary),
    )],
  };
}

function nameModal(action, title, currentName = '') {
  return new ModalBuilder()
    .setCustomId(actionId(`modal_${action}`))
    .setTitle(title)
    .addComponents(row(
      new TextInputBuilder()
        .setCustomId('name')
        .setLabel('Template name')
        .setStyle(TextInputStyle.Short)
        .setMinLength(1)
        .setMaxLength(80)
        .setRequired(true)
        .setValue(currentName),
    ));
}

async function awaitName(interaction, action, title, currentName = '') {
  const modal = nameModal(action, title, currentName);
  await interaction.showModal(modal);
  return interaction.awaitModalSubmit({
    filter: (submitted) =>
      submitted.customId === actionId(`modal_${action}`)
      && submitted.user.id === interaction.user.id,
    time: 120_000,
  }).catch(() => null);
}

async function sendComponentError(interaction, error) {
  const payload = { content: error.message || 'The permission dashboard action failed.', flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => {});
  } else {
    await interaction.reply(payload).catch(() => {});
  }
}

export async function runPermissionsDashboard(rootInteraction, client) {
  const state = {
    selectedTemplateId: null,
    view: 'overview',
    draft: null,
    roleIds: [],
    channelIds: [],
  };

  const render = async () => {
    const templates = await listPermissionTemplates(client, rootInteraction.guildId);
    const selected = templates.find((template) => template.id === state.selectedTemplateId) || null;
    if (state.view === 'editor' && state.draft) return buildEditor(state);
    if (state.view === 'apply' && selected) return buildApply(state, selected);
    if (state.view === 'confirm' && selected) return buildConfirmation(state, selected);
    state.view = 'overview';
    return buildOverview(templates, state, rootInteraction.guild);
  };

  await rootInteraction.editReply(await render());
  const message = await rootInteraction.fetchReply();
  const collector = message.createMessageComponentCollector({
    filter: (interaction) =>
      interaction.user.id === rootInteraction.user.id
      && interaction.customId.startsWith(PREFIX),
    time: TIMEOUT_MS,
  });

  collector.on('collect', async (interaction) => {
    const action = interaction.customId.slice(PREFIX.length);
    try {
      const templates = await listPermissionTemplates(client, rootInteraction.guildId);
      const selected = templates.find((template) => template.id === state.selectedTemplateId) || null;

      if (action === 'create') {
        const submitted = await awaitName(interaction, 'create', 'Create Permission Template');
        if (!submitted) return;
        const created = await createPermissionTemplate(client, rootInteraction.guildId, {
          name: submitted.fields.getTextInputValue('name'),
        });
        state.selectedTemplateId = created.id;
        await submitted.deferUpdate();
        return rootInteraction.editReply(await render());
      }
      if (action === 'rename' && state.draft) {
        const submitted = await awaitName(interaction, 'rename', 'Rename Permission Template', state.draft.name);
        if (!submitted) return;
        state.draft.name = submitted.fields.getTextInputValue('name').trim();
        await submitted.deferUpdate();
        return rootInteraction.editReply(await render());
      }
      if (action === 'template') {
        state.selectedTemplateId = interaction.values[0];
        state.view = 'overview';
      } else if (action === 'edit' && selected) {
        state.draft = structuredClone(selected);
        state.view = 'editor';
      } else if (action === 'allow' || action === 'deny') {
        const chosen = new Set(interaction.values);
        const opposite = action === 'allow' ? 'deny' : 'allow';
        for (const permission of MANAGED_CHANNEL_PERMISSIONS) {
          if (chosen.has(permission)) state.draft.permissions[permission] = action;
          else if (state.draft.permissions[permission] === action) state.draft.permissions[permission] = 'inherit';
          if (chosen.has(permission) && state.draft.permissions[permission] === opposite) {
            state.draft.permissions[permission] = action;
          }
        }
      } else if (action === 'save' && state.draft) {
        await updatePermissionTemplate(client, rootInteraction.guildId, state.draft.id, state.draft);
        state.view = 'overview';
        state.draft = null;
      } else if (action === 'delete' && selected) {
        state.view = 'delete_confirm';
        await interaction.update({
          embeds: [baseEmbed('Delete Permission Template?', `Permanently delete **${selected.name}**?`).setColor(getColor('error'))],
          components: [row(
            new ButtonBuilder().setCustomId(actionId('delete_confirm')).setLabel('Delete').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(actionId('back')).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
          )],
        });
        return;
      } else if (action === 'delete_confirm' && selected) {
        await deletePermissionTemplate(client, rootInteraction.guildId, selected.id);
        state.selectedTemplateId = null;
        state.view = 'overview';
      } else if (action === 'apply' && selected) {
        state.roleIds = [];
        state.channelIds = [];
        state.view = 'apply';
      } else if (action === 'roles') {
        state.roleIds = interaction.values;
      } else if (action === 'channels') {
        state.channelIds = interaction.values;
      } else if (action === 'preview' && selected) {
        buildBulkApplyPreview(selected, state.roleIds, state.channelIds);
        state.view = 'confirm';
      } else if (action === 'apply_back') {
        state.view = 'apply';
      } else if (action === 'confirm' && selected) {
        await interaction.deferUpdate();
        const result = await applyPermissionTemplate(
          rootInteraction.guild,
          selected,
          state.roleIds,
          state.channelIds,
          `Permission template "${selected.name}" applied by ${rootInteraction.user.tag}`,
        );
        state.view = 'overview';
        await rootInteraction.editReply(await render());
        await rootInteraction.followUp({
          content: result.failures.length
            ? `Applied **${result.applied}/${result.editCount}** edits. ${result.failures.length} failed; check role hierarchy and my channel permissions.`
            : `Applied **${result.applied}** permission overwrite edits successfully.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      } else if (action === 'back') {
        state.view = 'overview';
        state.draft = null;
      }

      await interaction.update(await render());
    } catch (error) {
      logger.error('Permission dashboard action failed', {
        error: error.message,
        guildId: rootInteraction.guildId,
        userId: rootInteraction.user.id,
      });
      await sendComponentError(interaction, error);
    }
  });

  collector.on('end', async () => {
    await rootInteraction.editReply({ components: [] }).catch(() => {});
  });
}
