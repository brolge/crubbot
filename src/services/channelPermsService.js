import { PermissionFlagsBits } from 'discord.js';
import { MANAGED_CHANNEL_PERMISSIONS } from './channelPermissionTemplateService.js';

export const PERM_BITS = Object.freeze({
  ViewChannel: PermissionFlagsBits.ViewChannel,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  SendMessages: PermissionFlagsBits.SendMessages,
  CreatePublicThreads: PermissionFlagsBits.CreatePublicThreads,
  CreatePrivateThreads: PermissionFlagsBits.CreatePrivateThreads,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
  AddReactions: PermissionFlagsBits.AddReactions,
  ManageMessages: PermissionFlagsBits.ManageMessages,
});

export const QUICK_PRESETS = Object.freeze({
  stopMessaging: {
    label: 'Stop Messaging',
    description: 'Deny sending messages + thread creation',
    deny: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'],
    allowException: ['SendMessages', 'CreatePublicThreads', 'CreatePrivateThreads', 'SendMessagesInThreads'],
  },
  stopReactions: {
    label: 'Stop Reactions',
    description: 'Deny adding reactions',
    deny: ['AddReactions'],
    allowException: ['AddReactions'],
  },
  lockChannel: {
    label: 'Lock Channel',
    description: 'Deny view + send + reactions + threads',
    deny: [
      'ViewChannel',
      'SendMessages',
      'AddReactions',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
    ],
    allowException: [
      'ViewChannel',
      'SendMessages',
      'AddReactions',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
      'ReadMessageHistory',
    ],
  },
  muteOnly: {
    label: 'Mute Chat',
    description: 'Deny send/react/threads but keep viewing',
    deny: [
      'SendMessages',
      'AddReactions',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
    ],
    allowException: [
      'SendMessages',
      'AddReactions',
      'CreatePublicThreads',
      'CreatePrivateThreads',
      'SendMessagesInThreads',
    ],
  },
});

export function readOverwriteState(channel, roleId) {
  const overwrite = channel?.permissionOverwrites?.cache?.get(roleId);
  const states = {};
  for (const permission of MANAGED_CHANNEL_PERMISSIONS) {
    const bit = PERM_BITS[permission];
    if (!overwrite || !bit) {
      states[permission] = 'inherit';
      continue;
    }
    if (overwrite.deny.has(bit)) states[permission] = 'deny';
    else if (overwrite.allow.has(bit)) states[permission] = 'allow';
    else states[permission] = 'inherit';
  }
  return states;
}

/** Aggregate states across channels: allow | deny | inherit | mixed */
export function aggregateOverwriteStates(channels, roleId) {
  const aggregate = {};
  for (const permission of MANAGED_CHANNEL_PERMISSIONS) {
    const seen = new Set();
    for (const channel of channels) {
      seen.add(readOverwriteState(channel, roleId)[permission]);
    }
    aggregate[permission] = seen.size === 1 ? [...seen][0] : 'mixed';
  }
  return aggregate;
}

export function buildOverwritePatch(states) {
  const patch = {};
  for (const permission of MANAGED_CHANNEL_PERMISSIONS) {
    const state = states[permission];
    if (state === 'allow') patch[permission] = true;
    else if (state === 'deny') patch[permission] = false;
    else if (state === 'inherit') patch[permission] = null;
  }
  return patch;
}

export function buildPresetPatch(presetKey, forException = false) {
  const preset = QUICK_PRESETS[presetKey];
  if (!preset) return {};
  const patch = {};
  const keys = forException ? preset.allowException : preset.deny;
  for (const permission of keys) {
    patch[permission] = forException ? true : false;
  }
  return patch;
}

export async function applyOverwritePatch(guild, channelIds, roleId, patch, reason) {
  const failures = [];
  let applied = 0;

  for (const channelId of channelIds) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.permissionOverwrites?.edit) {
      failures.push({ channelId, roleId, error: 'Channel cannot have overwrites.' });
      continue;
    }
    if (!guild.roles.cache.has(roleId) && roleId !== guild.id) {
      failures.push({ channelId, roleId, error: 'Role not found.' });
      continue;
    }
    try {
      await channel.permissionOverwrites.edit(roleId, patch, reason ? { reason } : undefined);
      applied += 1;
    } catch (error) {
      failures.push({ channelId, roleId, error: error.message });
    }
  }

  return { applied, failures, attempted: channelIds.length };
}

export async function applyQuickThreatResponse(guild, {
  channelIds,
  targetRoleId,
  exceptionRoleIds = [],
  presetKey,
  reason,
}) {
  const denyPatch = buildPresetPatch(presetKey, false);
  const allowPatch = buildPresetPatch(presetKey, true);
  const target = await applyOverwritePatch(guild, channelIds, targetRoleId, denyPatch, reason);

  const exceptions = [];
  for (const roleId of exceptionRoleIds) {
    if (roleId === targetRoleId) continue;
    exceptions.push(await applyOverwritePatch(guild, channelIds, roleId, allowPatch, reason));
  }

  return { target, exceptions, presetKey };
}
