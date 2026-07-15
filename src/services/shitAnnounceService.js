import { PermissionsBitField } from 'discord.js';
import { getGuildConfig, updateGuildConfig } from './guildConfig.js';
import { CrubError, ErrorTypes } from '../utils/errorHandler.js';
import { wrapServiceBoundary } from '../utils/serviceErrorBoundary.js';

export const DEFAULT_SHIT_DISPLAY_NAME = 'Brolge';

const MESSAGE_TEMPLATES = [
    '{name} is shitting',
    '{name} is ripping on rn',
    '{name} is dropping bombs',
    '{name} is on the throne',
    '{name} is clearing the pipes',
    '{name} is having a bathroom emergency',
    '{name} is unleashing hell in the bathroom',
    '{name} should not be disturbed rn',
    '{name} is cooking up something foul',
    '{name} is born to shit, forced to wipe',
    '{name} is making the bathroom uninhabitable',
    '{name} is going nuclear in there',
];

export function getShitAnnounceConfig(guildConfig) {
    const shitAnnounce = guildConfig?.shitAnnounce ?? {};
    return {
        channelId: shitAnnounce.channelId ?? null,
        displayName: shitAnnounce.displayName ?? DEFAULT_SHIT_DISPLAY_NAME,
    };
}

export function pickShitMessage(displayName) {
    const template = MESSAGE_TEMPLATES[Math.floor(Math.random() * MESSAGE_TEMPLATES.length)];
    return template.replaceAll('{name}', displayName);
}

export const getShitAnnounceSettings = wrapServiceBoundary(async function getShitAnnounceSettings(client, guildId) {
    const guildConfig = await getGuildConfig(client, guildId);
    return getShitAnnounceConfig(guildConfig);
}, {
    service: 'shitAnnounceService',
    operation: 'getShitAnnounceSettings',
    message: 'Failed to load shit announce settings',
    userMessage: 'Failed to load bathroom announce settings.',
});

export const saveShitAnnounceSettings = wrapServiceBoundary(async function saveShitAnnounceSettings(client, guildId, updates) {
    const guildConfig = await getGuildConfig(client, guildId);
    const current = getShitAnnounceConfig(guildConfig);

    await updateGuildConfig(client, guildId, {
        shitAnnounce: {
            ...current,
            ...updates,
        },
    });

    return { ...current, ...updates };
}, {
    service: 'shitAnnounceService',
    operation: 'saveShitAnnounceSettings',
    message: 'Failed to save shit announce settings',
    userMessage: 'Failed to save bathroom announce settings.',
});

export const postShitAnnouncement = wrapServiceBoundary(async function postShitAnnouncement(client, guild, settings) {
    if (!settings?.channelId) {
        throw new CrubError(
            'Shit announce channel not configured',
            ErrorTypes.CONFIGURATION,
            'No announce channel is set up yet. An admin can run `/shitsetup`.',
        );
    }

    const channel = await guild.channels.fetch(settings.channelId).catch(() => null);
    if (!channel?.isTextBased()) {
        throw new CrubError(
            'Shit announce channel missing',
            ErrorTypes.CONFIGURATION,
            'The configured announce channel no longer exists. Run `/shitsetup` again.',
        );
    }

    const me = guild.members.me;
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) {
        throw new CrubError(
            'Missing channel permissions',
            ErrorTypes.PERMISSION,
            `I need permission to send messages in ${channel}.`,
        );
    }

    const message = pickShitMessage(settings.displayName);
    await channel.send(message);

    return { channel, message };
}, {
    service: 'shitAnnounceService',
    operation: 'postShitAnnouncement',
    message: 'Failed to post shit announcement',
    userMessage: 'Failed to post the bathroom announcement.',
});
