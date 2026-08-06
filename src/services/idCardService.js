// idCardService.js

import { getGuildConfig, updateGuildConfig } from './guildConfig.js';
import { wrapServiceBoundary } from '../utils/serviceErrorBoundary.js';
import { logger } from '../utils/logger.js';

/**
 * Default ID-card settings applied when no configuration exists yet.
 *
 * enabled         – whether the /id command is active in this guild
 * highlightRoleId – the role that earns the special badge (e.g. "Zalaria Citizen")
 * badgeText       – the label shown when a member holds the highlight role
 * embedColor      – hex colour used for the ID-card embed (null = bot default)
 * allowedRoleIds  – if non-empty, only members with one of these roles may use /id
 * allowEveryone   – when true, any member can use /id regardless of allowedRoleIds
 * statusLines     – array of { roleId, text } set by admins; matching role → text shown on card
 */
const ID_CARD_DEFAULTS = {
    enabled: false,
    highlightRoleId: null,
    badgeText: 'Member',
    embedColor: null,
    allowedRoleIds: [],
    allowEveryone: true,
    statusLines: [],
};

/**
 * Fetch the merged idCard config for a guild, filling in defaults for any
 * missing keys.
 */
export const getIdCardConfig = wrapServiceBoundary(async function getIdCardConfig(client, guildId, context = {}) {
    const guildConfig = await getGuildConfig(client, guildId, context);
    const raw = guildConfig.idCard ?? {};
    return { ...ID_CARD_DEFAULTS, ...raw };
}, {
    service: 'idCardService',
    operation: 'getIdCardConfig',
    message: 'Failed to fetch ID-card configuration',
    userMessage: 'Failed to load ID-card settings. Please try again.',
});

/**
 * Persist partial updates to the idCard config for a guild.
 */
export const updateIdCardConfig = wrapServiceBoundary(async function updateIdCardConfig(client, guildId, updates, context = {}) {
    const guildConfig = await getGuildConfig(client, guildId, context);
    const current = guildConfig.idCard ?? {};
    const merged = { ...ID_CARD_DEFAULTS, ...current, ...updates };

    await updateGuildConfig(client, guildId, { idCard: merged }, context);

    logger.info('[ID_CARD_SERVICE] Config updated', { guildId, updates });
    return merged;
}, {
    service: 'idCardService',
    operation: 'updateIdCardConfig',
    message: 'Failed to update ID-card configuration',
    userMessage: 'Failed to save ID-card settings. Please try again.',
});

/**
 * Check whether a guild member is allowed to run `/id` given the current
 * config.  Returns `{ allowed: boolean, reason?: string }`.
 */
export function checkIdCardAccess(config, member) {
    if (!config.enabled) {
        return { allowed: false, reason: 'The `/id` feature is **disabled** in this server.' };
    }

    if (config.allowEveryone) {
        return { allowed: true };
    }

    if (config.allowedRoleIds.length === 0) {
        return { allowed: true };
    }

    const hasRole = config.allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
    if (!hasRole) {
        return { allowed: false, reason: 'You do not have a role that is allowed to use `/id` in this server.' };
    }

    return { allowed: true };
}
