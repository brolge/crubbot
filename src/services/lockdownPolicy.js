import { PermissionFlagsBits } from 'discord.js';

export const ANTI_NUKE_WINDOW_MS = 10 * 60 * 1000;
export const ANTI_NUKE_THRESHOLD = 4;
/** Role mass-delete: more than 3 roles (= 4th) within 1 minute. */
export const ANTI_NUKE_ROLE_WINDOW_MS = 60 * 1000;
export const ANTI_NUKE_ROLE_THRESHOLD = 4;
export const AUDIT_MATCH_MAX_AGE_MS = 20_000;

export const DEFAULT_RESTRICTIONS = Object.freeze({
  messaging: true,
  reactions: true,
  publicThreads: true,
  privateThreads: true,
  threadMessages: true,
});

const RESTRICTION_PERMISSIONS = Object.freeze({
  messaging: PermissionFlagsBits.SendMessages,
  reactions: PermissionFlagsBits.AddReactions,
  publicThreads: PermissionFlagsBits.CreatePublicThreads,
  privateThreads: PermissionFlagsBits.CreatePrivateThreads,
  threadMessages: PermissionFlagsBits.SendMessagesInThreads,
});

export function normalizeLockdownConfig(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    antiNukeEnabled: value.antiNukeEnabled === true,
    quarantineRoleId: typeof value.quarantineRoleId === 'string' ? value.quarantineRoleId : null,
    alertChannelId: typeof value.alertChannelId === 'string' ? value.alertChannelId : null,
    trustedUserIds: [...new Set(Array.isArray(value.trustedUserIds) ? value.trustedUserIds : [])].slice(0, 100),
    trustedRoleIds: [...new Set(Array.isArray(value.trustedRoleIds) ? value.trustedRoleIds : [])].slice(0, 100),
    restrictions: {
      ...DEFAULT_RESTRICTIONS,
      ...(value.restrictions && typeof value.restrictions === 'object' ? value.restrictions : {}),
    },
    active: value.active === true,
    snapshot: value.snapshot && typeof value.snapshot === 'object' ? value.snapshot : null,
    quarantinedMembers:
      value.quarantinedMembers && typeof value.quarantinedMembers === 'object'
        ? value.quarantinedMembers
        : {},
    bulkQuarantine: {
      active: value.bulkQuarantine?.active === true,
      createdAt: typeof value.bulkQuarantine?.createdAt === 'string'
        ? value.bulkQuarantine.createdAt
        : null,
      memberIds: [...new Set(
        Array.isArray(value.bulkQuarantine?.memberIds) ? value.bulkQuarantine.memberIds : [],
      )].slice(0, 10_000),
    },
    guards: {
      blockNewBots: value.guards?.blockNewBots === true,
      lockNewChannels: value.guards?.lockNewChannels !== false,
    },
  };
}

export function buildRestrictionMask(restrictions = DEFAULT_RESTRICTIONS) {
  return Object.entries(RESTRICTION_PERMISSIONS).reduce(
    (mask, [key, permission]) => restrictions[key] === true ? mask | permission : mask,
    0n,
  );
}

export function restrictOverwriteState(state, restrictions = DEFAULT_RESTRICTIONS) {
  const mask = buildRestrictionMask(restrictions);
  return {
    existed: true,
    allow: (BigInt(state?.allow ?? 0) & ~mask).toString(),
    deny: (BigInt(state?.deny ?? 0) | mask).toString(),
  };
}

export function recordDeletion(state, actorId, now = Date.now(), {
  windowMs = ANTI_NUKE_WINDOW_MS,
  threshold = ANTI_NUKE_THRESHOLD,
} = {}) {
  const previous = state.get(actorId) || [];
  const recent = previous.filter(timestamp => timestamp > now - windowMs);
  recent.push(now);
  state.set(actorId, recent);
  return { count: recent.length, triggered: recent.length === threshold };
}

export function selectUnambiguousAuditEntry(entries, channelId, now = Date.now(), maxAgeMs = AUDIT_MATCH_MAX_AGE_MS) {
  const matches = [...entries].filter(entry =>
    entry?.target?.id === channelId &&
    typeof entry.createdTimestamp === 'number' &&
    now - entry.createdTimestamp >= 0 &&
    now - entry.createdTimestamp <= maxAgeMs &&
    entry.executor?.id,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function isTrustedExecutor({ executorId, ownerId, botId, trustedUserIds = [], trustedRoleIds = [], memberRoleIds = [] }) {
  if (!executorId) return true;
  if (executorId === ownerId || executorId === botId || trustedUserIds.includes(executorId)) return true;
  return memberRoleIds.some(roleId => trustedRoleIds.includes(roleId));
}
