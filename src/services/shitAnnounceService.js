import { PermissionsBitField } from 'discord.js';
import { getGuildConfig, updateGuildConfig } from './guildConfig.js';
import { CrubError, ErrorTypes } from '../utils/errorHandler.js';
import { wrapServiceBoundary } from '../utils/serviceErrorBoundary.js';

export const DEFAULT_SHIT_DISPLAY_NAME = 'Brolge';

const MESSAGE_TEMPLATES = [
    // originals
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
    // dirty expansions
    '{name} is mid shit and it smells like a crime scene',
    '{name} just tore a hole in the fucking fabric of reality',
    '{name} is clogging the toilet with pure evil',
    '{name} is shitting so hard the walls are sweating',
    '{name} dropped a deuce so nasty even god looked away',
    '{name} is in there painting the bowl like a goddamn Picasso of piss and shit',
    '{name} just ripped ass so loud it set off car alarms',
    '{name} is making diarrhea stew and serving it raw',
    '{name} is mid-wipe and already regretting every life choice',
    '{name} just birthed a shit so thick it needs a fucking passport',
    '{name} is flooding the bathroom with toxic swamp gas',
    '{name} is on the toilet committing war crimes with their asshole',
    '{name} just shit themselves into another dimension',
    '{name} is blasting farts that could clear a stadium',
    '{name} dropped something so foul the plumbing filed a restraining order',
];

export function getShitAnnounceConfig(guildConfig) {
    const shitAnnounce = guildConfig?.shitAnnounce ?? {};
    return {
        channelId: shitAnnounce.channelId ?? null,
        displayName: shitAnnounce.displayName ?? DEFAULT_SHIT_DISPLAY_NAME,
    };
}

export function pickShitMessage(nameToken) {
    const template = MESSAGE_TEMPLATES[Math.floor(Math.random() * MESSAGE_TEMPLATES.length)];
    return template.replaceAll('{name}', nameToken);
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

export const postShitAnnouncement = wrapServiceBoundary(async function postShitAnnouncement(client, guild, settings, actor = null) {
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

    const actorId = actor?.id || null;
    const nameToken = actorId
        ? `<@${actorId}>`
        : (settings.displayName || DEFAULT_SHIT_DISPLAY_NAME);
    const message = pickShitMessage(nameToken);

    await channel.send({
        content: message,
        allowedMentions: actorId
            ? { parse: [], users: [actorId] }
            : { parse: [] },
    });

    return { channel, message, actorId };
}, {
    service: 'shitAnnounceService',
    operation: 'postShitAnnouncement',
    message: 'Failed to post shit announcement',
    userMessage: 'Failed to post the bathroom announcement.',
});
