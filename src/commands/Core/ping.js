import {
    SlashCommandBuilder,
    MessageFlags,
    PermissionFlagsBits,
    PermissionsBitField,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { ErrorTypes, replyUserError } from '../../utils/errorHandler.js';

const MIN_PINGS = 2;
const MAX_PINGS = 15;
const DEFAULT_PINGS = 5;

async function runLatencyCheck(interaction) {
    await InteractionHelper.safeEditReply(interaction, {
        content: 'Pinging...',
    });

    const startTime = interaction._commandStartTime || interaction.createdTimestamp;
    const latency = Math.max(0, Date.now() - startTime);
    const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

    const embed = createEmbed({ title: 'Pong!', description: null }).addFields(
        { name: 'Bot Latency', value: `${latency}ms`, inline: true },
        { name: 'API Latency', value: `${apiLatency}ms`, inline: true },
    );

    await InteractionHelper.safeEditReply(interaction, {
        content: null,
        embeds: [embed],
    });
}

async function runMassPing(interaction) {
    const target = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount') ?? DEFAULT_PINGS;
    const channel = interaction.channel;

    if (!target) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: 'Pick a **user** to attention-ping.',
        });
    }

    if (target.bot) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: 'You cannot mass-ping bots.',
        });
    }

    if (amount < MIN_PINGS || amount > MAX_PINGS) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: `Amount must be between **${MIN_PINGS}** and **${MAX_PINGS}**.`,
        });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: 'You need **Manage Messages** to mass-ping someone.',
        });
    }

    if (!channel?.isTextBased?.() || channel.isDMBased?.()) {
        return replyUserError(interaction, {
            type: ErrorTypes.VALIDATION,
            message: 'Mass ping only works in a server text channel.',
        });
    }

    const me = interaction.guild?.members?.me;
    const botPerms = me ? channel.permissionsFor(me) : null;
    const needed = [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageMessages,
    ];
    if (!botPerms?.has(needed)) {
        return replyUserError(interaction, {
            type: ErrorTypes.PERMISSION,
            message: 'I need **View Channel**, **Send Messages**, and **Manage Messages** here.',
        });
    }

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [
            successEmbed(
                '📢 Mass Ping',
                `Sending **${amount}** attention pings to ${target} — only the last one will stay.`,
            ),
        ],
    });

    let kept = null;
    let sent = 0;

    try {
        for (let i = 1; i <= amount; i++) {
            const isLast = i === amount;
            const content = isLast
                ? `${target} — check here · pinged by ${interaction.user}`
                : `${target}`;

            const message = await channel.send({
                content,
                allowedMentions: { users: [target.id] },
            });
            sent += 1;

            if (kept) {
                await kept.delete().catch(() => {});
            }
            kept = message;
        }

        await InteractionHelper.safeEditReply(interaction, {
            embeds: [
                successEmbed(
                    '📢 Mass Ping Done',
                    `Fired **${sent}** pings at ${target}. All but the last were deleted so they can still jump to this channel.`,
                ),
            ],
        });
    } catch (error) {
        logger.error('Mass ping failed:', error);
        if (kept) {
            await kept.delete().catch(() => {});
        }
        return replyUserError(interaction, {
            type: ErrorTypes.DISCORD_API,
            message: `Mass ping stopped after **${sent}** message(s). ${error.message || 'Discord rate-limited or blocked the send.'}`,
        });
    }
}

export default {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Bot latency, or mass-ping a user to grab their attention')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('User to mass-ping (leave empty for latency check)')
                .setRequired(false),
        )
        .addIntegerOption((option) =>
            option
                .setName('amount')
                .setDescription(`How many pings to fire (${MIN_PINGS}–${MAX_PINGS}, default ${DEFAULT_PINGS})`)
                .setRequired(false)
                .setMinValue(MIN_PINGS)
                .setMaxValue(MAX_PINGS),
        ),
    category: 'Core',
    abuseProtection: { maxAttempts: 3, windowMs: 45_000 },

    async prefixExecute(interaction) {
        try {
            const startTime = Date.now();
            const pingingMessage = await interaction.reply({ content: 'Pinging...' });

            const latency = Date.now() - startTime;
            const apiLatency = Math.max(0, Math.round(interaction.client.ws.ping));

            const embed = createEmbed({ title: 'Pong!', description: null }).addFields(
                { name: 'Bot Latency', value: `${latency}ms`, inline: true },
                { name: 'API Latency', value: `${apiLatency}ms`, inline: true },
            );

            await pingingMessage.edit({ content: null, embeds: [embed] });
        } catch (error) {
            logger.error('Ping prefix command error:', error);
            if (!interaction.replied && !interaction._replyMessage) {
                await interaction.channel.send({
                    embeds: [createEmbed({ title: 'System Error', description: 'Could not determine latency at this time.', color: 'error' })],
                }).catch(() => {});
            }
        }
    },

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const deferSuccess = await InteractionHelper.safeDefer(interaction, {
            flags: target ? MessageFlags.Ephemeral : undefined,
        });
        if (!deferSuccess) {
            logger.warn('Ping interaction defer failed', {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'ping',
            });
            return;
        }

        try {
            if (target) {
                return await runMassPing(interaction);
            }
            return await runLatencyCheck(interaction);
        } catch (error) {
            logger.error('Ping command error:', error);
            try {
                return await InteractionHelper.safeReply(interaction, {
                    embeds: [createEmbed({ title: 'System Error', description: 'Could not run ping at this time.', color: 'error' })],
                    flags: MessageFlags.Ephemeral,
                });
            } catch (replyError) {
                logger.error('Failed to send error reply:', replyError);
            }
        }
    },
};
