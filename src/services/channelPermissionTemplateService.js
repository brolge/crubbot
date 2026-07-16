import { randomUUID } from 'node:crypto';
import { getGuildConfig, updateGuildConfig } from './guildConfig.js';

export const MANAGED_CHANNEL_PERMISSIONS = Object.freeze([
  'ViewChannel',
  'ReadMessageHistory',
  'SendMessages',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'SendMessagesInThreads',
  'AddReactions',
  'ManageMessages',
]);

export const PERMISSION_STATES = Object.freeze(['allow', 'deny', 'inherit']);
export const MAX_BULK_PERMISSION_EDITS = 100;
const MAX_TEMPLATES = 25;

function normalizeName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

export function normalizePermissionStates(raw = {}) {
  return Object.fromEntries(
    MANAGED_CHANNEL_PERMISSIONS.map((permission) => {
      const state = PERMISSION_STATES.includes(raw?.[permission]) ? raw[permission] : 'inherit';
      return [permission, state];
    }),
  );
}

export function normalizePermissionTemplates(raw = []) {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((template) => template && typeof template === 'object' && template.id && template.name)
    .slice(0, MAX_TEMPLATES)
    .map((template) => ({
      id: String(template.id),
      name: normalizeName(template.name).slice(0, 80),
      permissions: normalizePermissionStates(template.permissions),
    }));
}

function validateTemplateName(name, templates, excludedId = null) {
  const normalized = normalizeName(name);
  if (!normalized || normalized.length > 80) {
    throw new Error('Template names must be between 1 and 80 characters.');
  }

  if (templates.some(
    (template) => template.id !== excludedId
      && template.name.toLowerCase() === normalized.toLowerCase(),
  )) {
    throw new Error(`A permission template named "${normalized}" already exists.`);
  }

  return normalized;
}

export async function listPermissionTemplates(client, guildId, context = {}) {
  const config = await getGuildConfig(client, guildId, context);
  return normalizePermissionTemplates(config.permissionTemplates);
}

export async function createPermissionTemplate(client, guildId, input, context = {}) {
  const templates = await listPermissionTemplates(client, guildId, context);
  if (templates.length >= MAX_TEMPLATES) {
    throw new Error(`A server can store at most ${MAX_TEMPLATES} permission templates.`);
  }

  const template = {
    id: randomUUID(),
    name: validateTemplateName(input?.name, templates),
    permissions: normalizePermissionStates(input?.permissions),
  };
  const permissionTemplates = [...templates, template];
  await updateGuildConfig(client, guildId, { permissionTemplates }, context);
  return template;
}

export async function updatePermissionTemplate(client, guildId, templateId, updates, context = {}) {
  const templates = await listPermissionTemplates(client, guildId, context);
  const index = templates.findIndex((template) => template.id === templateId);
  if (index === -1) {
    throw new Error('Permission template not found.');
  }

  const current = templates[index];
  const updated = {
    ...current,
    name: updates?.name === undefined
      ? current.name
      : validateTemplateName(updates.name, templates, templateId),
    permissions: updates?.permissions === undefined
      ? current.permissions
      : normalizePermissionStates(updates.permissions),
  };
  templates[index] = updated;
  await updateGuildConfig(client, guildId, { permissionTemplates: templates }, context);
  return updated;
}

export async function deletePermissionTemplate(client, guildId, templateId, context = {}) {
  const templates = await listPermissionTemplates(client, guildId, context);
  const permissionTemplates = templates.filter((template) => template.id !== templateId);
  if (permissionTemplates.length === templates.length) {
    throw new Error('Permission template not found.');
  }

  await updateGuildConfig(client, guildId, { permissionTemplates }, context);
  return true;
}

export function buildPermissionOverwrite(template) {
  const states = normalizePermissionStates(template?.permissions);
  return Object.fromEntries(
    MANAGED_CHANNEL_PERMISSIONS.map((permission) => [
      permission,
      states[permission] === 'allow' ? true : states[permission] === 'deny' ? false : null,
    ]),
  );
}

export function buildBulkApplyPreview(template, roleIds, channelIds) {
  const uniqueRoleIds = [...new Set(roleIds || [])];
  const uniqueChannelIds = [...new Set(channelIds || [])];
  const editCount = uniqueRoleIds.length * uniqueChannelIds.length;

  if (uniqueRoleIds.length === 0 || uniqueChannelIds.length === 0) {
    throw new Error('Select at least one role and one channel.');
  }
  if (editCount > MAX_BULK_PERMISSION_EDITS) {
    throw new Error(
      `This would create ${editCount} permission edits; the maximum is ${MAX_BULK_PERMISSION_EDITS}.`,
    );
  }

  return {
    templateId: template.id,
    templateName: template.name,
    roleIds: uniqueRoleIds,
    channelIds: uniqueChannelIds,
    editCount,
    overwrite: buildPermissionOverwrite(template),
  };
}

export async function applyPermissionTemplate(guild, template, roleIds, channelIds, reason = null) {
  const preview = buildBulkApplyPreview(template, roleIds, channelIds);
  const failures = [];
  let applied = 0;

  for (const channelId of preview.channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.permissionOverwrites?.edit) {
      failures.push({ channelId, roleId: null, error: 'Channel is unavailable or cannot have overwrites.' });
      continue;
    }

    for (const roleId of preview.roleIds) {
      if (!guild.roles.cache.has(roleId)) {
        failures.push({ channelId, roleId, error: 'Role is unavailable.' });
        continue;
      }

      try {
        // Passing only managed keys preserves every unrelated permission bit.
        await channel.permissionOverwrites.edit(
          roleId,
          preview.overwrite,
          reason ? { reason } : undefined,
        );
        applied += 1;
      } catch (error) {
        failures.push({ channelId, roleId, error: error.message });
      }
    }
  }

  return { ...preview, applied, failures };
}
