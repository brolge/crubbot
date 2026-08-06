import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import {
    getIdCardConfig,
    updateIdCardConfig,
    checkIdCardAccess,
} from '../../services/idCardService.js';

const MAX_STATUS_LINES = 25;

// ───────────────── Subcommand: /id card ─────────────────

async function runCard(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = interaction.guild.members.cache.get(user.id)
        || await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: 'That user is not a member of this server.',
        });
    }

    const config = await getIdCardConfig(interaction.client, interaction.guildId);

    // Access check (only applies to the person running the command)
    const access = checkIdCardAccess(config, interaction.member);
    if (!access.allowed) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: access.reason,
        });
    }

    // Build the ID card embed
    const displayName = member.displayName;
    const username = user.username;
    const avatarUrl = member.displayAvatarURL({ size: 512, dynamic: true });
    const bannerUrl = user.bannerURL?.({ size: 1024, dynamic: true }) || null;
    const createdTimestamp = Math.floor(user.createdAt.getTime() / 1000);
    const joinedTimestamp = member.joinedAt
        ? Math.floor(member.joinedAt.getTime() / 1000)
        : null;

    // Highlight role badge
    let badgeValue = '—';
    if (config.highlightRoleId) {
        const hasHighlightRole = member.roles.cache.has(config.highlightRoleId);
        if (hasHighlightRole) {
            badgeValue = `${config.badgeText || 'Member'}`;
        } else {
            badgeValue = '—';
        }
    }

    const embedColor = config.embedColor || 'primary';

    const embed = createEmbed({
        color: embedColor,
    })
        .setAuthor({ name: displayName, iconURL: avatarUrl })
        .setThumbnail(avatarUrl)
        .addFields(
            { name: 'Display Name', value: displayName, inline: true },
            { name: 'Username', value: username, inline: true },
            { name: '\u200b', value: '\u200b', inline: true }, // spacer
            {
                name: 'Account Created',
                value: `<t:${createdTimestamp}:R>`,
                inline: true,
            },
            {
                name: 'Joined Server',
                value: joinedTimestamp ? `<t:${joinedTimestamp}:R>` : 'N/A',
                inline: true,
            },
            { name: '\u200b', value: '\u200b', inline: true }, // spacer
        );

    // Badge field (only shown when a highlight role is configured)
    if (config.highlightRoleId) {
        const roleName = interaction.guild.roles.cache.get(config.highlightRoleId)?.name || 'Unknown Role';
        embed.addFields({
            name: roleName,
            value: badgeValue,
            inline: false,
        });
    }

    // Top roles (up to 5)
    const topRoles = member.roles.cache
        .filter((r) => r.id !== interaction.guild.id) // filter @everyone
        .sort((a, b) => b.position - a.position)
        .first(5)
        .map((r) => `${r}`)
        .join(', ') || 'None';

    embed.addFields({ name: 'Top Roles', value: topRoles, inline: false });

    // ── Role-based status lines ──
    // Each entry in config.statusLines is { roleId, text }.
    // If the member has the role, the text appears on their card.
    const statusLines = config.statusLines || [];
    const matchedLines = statusLines
        .filter((entry) => member.roles.cache.has(entry.roleId))
        .map((entry) => entry.text);

    if (matchedLines.length > 0) {
        embed.addFields({
            name: 'Status',
            value: matchedLines.map((line) => `> ${line}`).join('\n'),
            inline: false,
        });
    }

    if (bannerUrl) {
        embed.setImage(bannerUrl);
    }

    await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

// ───────────────── Subcommand: /id setup ─────────────────

async function runSetup(interaction) {
    // Require Manage Guild
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: 'You need **Manage Server** to configure the ID card feature.',
        });
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'toggle') {
        const enabled = interaction.options.getBoolean('enabled');
        await updateIdCardConfig(interaction.client, interaction.guildId, { enabled });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Feature ${enabled ? '**enabled**' : '**disabled**'}.`)],
        });
        return;
    }

    if (sub === 'highlight-role') {
        const role = interaction.options.getRole('role');
        const badgeText = interaction.options.getString('badge-text') || undefined;
        const updates = { highlightRoleId: role ? role.id : null };
        if (badgeText !== undefined) updates.badgeText = badgeText;
        await updateIdCardConfig(interaction.client, interaction.guildId, updates);

        const roleMention = role ? `<@&${role.id}>` : 'None';
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Highlight role set to ${roleMention}${badgeText ? ` with badge text **${badgeText}**` : ''}.`)],
        });
        return;
    }

    if (sub === 'badge-text') {
        const text = interaction.options.getString('text', true);
        await updateIdCardConfig(interaction.client, interaction.guildId, { badgeText: text });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Badge text set to **${text}**.`)],
        });
        return;
    }

    if (sub === 'color') {
        const hex = interaction.options.getString('hex', true).replace(/^#/, '');
        if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
            return replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: 'Please provide a valid 6-digit hex colour, e.g. `#7C3AED`.',
            });
        }
        await updateIdCardConfig(interaction.client, interaction.guildId, { embedColor: `#${hex}` });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Embed colour set to **#${hex}**.`)],
        });
        return;
    }

    if (sub === 'allow-role') {
        const role = interaction.options.getRole('role', true);
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const allowedRoleIds = [...new Set([...config.allowedRoleIds, role.id])];
        await updateIdCardConfig(interaction.client, interaction.guildId, {
            allowedRoleIds,
            allowEveryone: false,
        });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `<@&${role.id}> can now use \`/id\`.`)],
        });
        return;
    }

    if (sub === 'remove-role') {
        const role = interaction.options.getRole('role', true);
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const allowedRoleIds = config.allowedRoleIds.filter((id) => id !== role.id);
        const updates = { allowedRoleIds };
        if (allowedRoleIds.length === 0) updates.allowEveryone = true;
        await updateIdCardConfig(interaction.client, interaction.guildId, updates);
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `<@&${role.id}> removed from the allow-list.${allowedRoleIds.length === 0 ? ' Everyone can now use `/id` again.' : ''}`)],
        });
        return;
    }

    if (sub === 'allow-everyone') {
        const enabled = interaction.options.getBoolean('enabled', true);
        await updateIdCardConfig(interaction.client, interaction.guildId, { allowEveryone: enabled });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', enabled ? 'Everyone can now use `/id`.' : 'Only allowed roles can use `/id` now.')],
        });
        return;
    }

    // ── Status line management ──

    if (sub === 'add-status') {
        const role = interaction.options.getRole('role', true);
        const text = interaction.options.getString('text', true);
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const statusLines = [...(config.statusLines || [])];

        if (statusLines.length >= MAX_STATUS_LINES) {
            return replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: `You can have at most **${MAX_STATUS_LINES}** status lines. Remove one first.`,
            });
        }

        // Prevent exact duplicates (same role + same text)
        const duplicate = statusLines.some(
            (entry) => entry.roleId === role.id && entry.text === text,
        );
        if (duplicate) {
            return replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: 'That exact status line already exists.',
            });
        }

        statusLines.push({ roleId: role.id, text });
        await updateIdCardConfig(interaction.client, interaction.guildId, { statusLines });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Status line added: members with <@&${role.id}> will show **${text}**.`)],
        });
        return;
    }

    if (sub === 'remove-status') {
        const index = interaction.options.getInteger('index', true);
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const statusLines = [...(config.statusLines || [])];

        if (index < 1 || index > statusLines.length) {
            return replyUserError(interaction, {
                type: ErrorTypes.VALIDATION,
                message: `Invalid index. Use \`/id setup list-status\` to see current entries (1–${statusLines.length}).`,
            });
        }

        const removed = statusLines.splice(index - 1, 1)[0];
        await updateIdCardConfig(interaction.client, interaction.guildId, { statusLines });
        await InteractionHelper.safeEditReply(interaction, {
            embeds: [successEmbed('ID Card', `Removed status line #${index}: **${removed.text}** (<@&${removed.roleId}>).`)],
        });
        return;
    }

    if (sub === 'list-status') {
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const statusLines = config.statusLines || [];

        if (statusLines.length === 0) {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({ title: 'ID Card — Status Lines', description: 'No status lines configured yet.\nUse `/id setup add-status` to add one.', color: 'info' })],
            });
            return;
        }

        const list = statusLines
            .map((entry, i) => `**${i + 1}.** <@&${entry.roleId}> → ${entry.text}`)
            .join('\n');

        const embed = createEmbed({ title: 'ID Card — Status Lines', description: list, color: 'info' })
            .setFooter({ text: `${statusLines.length}/${MAX_STATUS_LINES} slots used` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        return;
    }

    if (sub === 'view') {
        const config = await getIdCardConfig(interaction.client, interaction.guildId);
        const highlightRole = config.highlightRoleId
            ? `<@&${config.highlightRoleId}>`
            : 'Not set';
        const allowedRoles = config.allowedRoleIds.length > 0
            ? config.allowedRoleIds.map((id) => `<@&${id}>`).join(', ')
            : 'None (everyone allowed)';
        const statusCount = (config.statusLines || []).length;

        const embed = createEmbed({ title: 'ID Card Configuration', color: 'info' })
            .addFields(
                { name: 'Enabled', value: config.enabled ? 'Yes' : 'No', inline: true },
                { name: 'Allow Everyone', value: config.allowEveryone ? 'Yes' : 'No', inline: true },
                { name: '\u200b', value: '\u200b', inline: true },
                { name: 'Highlight Role', value: highlightRole, inline: true },
                { name: 'Badge Text', value: config.badgeText || '—', inline: true },
                { name: 'Embed Colour', value: config.embedColor || 'Default', inline: true },
                { name: 'Allowed Roles', value: allowedRoles, inline: false },
                { name: 'Status Lines', value: `${statusCount} configured — use \`/id setup list-status\` to view`, inline: false },
            );

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        return;
    }
}

// ───────────────── Command export ─────────────────

export default {
    data: new SlashCommandBuilder()
        .setName('id')
        .setDescription('Display or configure identity cards for server members')
        .addSubcommandGroup((group) =>
            group
                .setName('setup')
                .setDescription('Configure the ID card feature (Manage Server)')
                .addSubcommand((sub) =>
                    sub
                        .setName('toggle')
                        .setDescription('Enable or disable the ID card feature')
                        .addBooleanOption((opt) =>
                            opt.setName('enabled').setDescription('Turn on or off').setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('highlight-role')
                        .setDescription('Set the special highlight role shown on ID cards')
                        .addRoleOption((opt) =>
                            opt.setName('role').setDescription('The role to highlight (leave empty to clear)').setRequired(false),
                        )
                        .addStringOption((opt) =>
                            opt.setName('badge-text').setDescription('Text shown when a member has this role').setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('badge-text')
                        .setDescription('Change the badge text without changing the role')
                        .addStringOption((opt) =>
                            opt.setName('text').setDescription('New badge text').setRequired(true).setMaxLength(100),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('color')
                        .setDescription('Set the embed colour for ID cards')
                        .addStringOption((opt) =>
                            opt.setName('hex').setDescription('Hex colour code, e.g. #7C3AED').setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('allow-role')
                        .setDescription('Allow a role to use /id (restricts to allowed roles only)')
                        .addRoleOption((opt) =>
                            opt.setName('role').setDescription('Role to allow').setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('remove-role')
                        .setDescription('Remove a role from the allow-list')
                        .addRoleOption((opt) =>
                            opt.setName('role').setDescription('Role to remove').setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('allow-everyone')
                        .setDescription('Toggle whether all members can use /id')
                        .addBooleanOption((opt) =>
                            opt.setName('enabled').setDescription('Allow everyone?').setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('add-status')
                        .setDescription('Add a role-based status line shown on ID cards')
                        .addRoleOption((opt) =>
                            opt.setName('role').setDescription('Role that triggers this status line').setRequired(true),
                        )
                        .addStringOption((opt) =>
                            opt.setName('text').setDescription('Text to display, e.g. "Enlisted in Blackout PMC"').setRequired(true).setMaxLength(200),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('remove-status')
                        .setDescription('Remove a status line by its number')
                        .addIntegerOption((opt) =>
                            opt.setName('index').setDescription('Line number (use /id setup list-status to see)').setRequired(true).setMinValue(1).setMaxValue(MAX_STATUS_LINES),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('list-status')
                        .setDescription('List all configured status lines'),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('view')
                        .setDescription('View the current ID card configuration'),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('card')
                .setDescription('Show your (or another member\'s) ID card')
                .addUserOption((opt) =>
                    opt.setName('user').setDescription('Member to view').setRequired(false),
                ),
        ),
    category: 'Community',

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const isSetup = group === 'setup';

        // /id card → public so everyone can see it
        // /id setup * → ephemeral (admin-only config)
        const deferSuccess = await InteractionHelper.safeDefer(interaction, {
            flags: isSetup ? MessageFlags.Ephemeral : undefined,
        });
        if (!deferSuccess) {
            logger.warn('ID interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'id',
            });
            return;
        }

        try {
            if (isSetup) {
                return await runSetup(interaction);
            }

            // Default: /id card
            return await runCard(interaction);
        } catch (error) {
            logger.error('ID command error:', {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'id',
            });
            await handleInteractionError(interaction, error, {
                commandName: 'id',
                source: 'id_command',
            });
        }
    },
};
