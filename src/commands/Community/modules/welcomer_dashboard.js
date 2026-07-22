import { getColor } from '../../../config/bot.js';
import {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    MessageFlags,
    ComponentType,
    EmbedBuilder,
    LabelBuilder,
    FileUploadBuilder,
    TextDisplayBuilder,
} from 'discord.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { CrubError, ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import { getWelcomeConfig, saveWelcomeConfig } from '../../../utils/database.js';
import { botHasPermission } from '../../../utils/permissionGuard.js';
import { formatWelcomeMessage, pickWelcomeQuote, BUILTIN_WELCOME_QUOTES } from '../../../utils/welcome.js';

async function deferComponent(interaction) {
    if (interaction.deferred || interaction.replied) return true;
    try {
        await interaction.deferUpdate();
        return true;
    } catch (error) {
        logger.debug('Component interaction expired or already acknowledged:', error.message);
        return false;
    }
}

async function sendEphemeralFollowUp(interaction, payload) {
    try {
        await interaction.followUp({
            ...payload,
            flags: MessageFlags.Ephemeral,
        });
    } catch (error) {
        logger.debug('Failed to send ephemeral follow-up:', error.message);
    }
}

function previewText(value, fallback, max = 55) {
    const raw = value || fallback;
    return `\`${raw.length > max ? `${raw.substring(0, max)}…` : raw}\``;
}

function buildDashboardEmbed(cfg, guild) {
    const welcomeChannel = cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`';
    const goodbyeChannel = cfg.goodbyeChannelId ? `<#${cfg.goodbyeChannelId}>` : '`Not set`';
    const roles = cfg.roleIds?.length
        ? cfg.roleIds.map((id) => `<@&${id}>`).join(', ')
        : '`None`';
    const quoteCount = cfg.quotes?.length || 0;
    const quoteStatus = cfg.quotesEnabled
        ? quoteCount > 0
            ? `On · ${quoteCount} custom`
            : `On · ${BUILTIN_WELCOME_QUOTES.length} built-in`
        : 'Off';

    return new EmbedBuilder()
        .setTitle('👋 Welcomer Dashboard')
        .setDescription(
            `Feature-rich welcome hub for **${guild.name}**.\nToggle systems below, then pick a setting to edit.`,
        )
        .setColor(getColor('info'))
        .addFields(
            { name: 'Welcome Channel', value: welcomeChannel, inline: true },
            { name: 'Welcome', value: cfg.enabled ? '🟢 On' : '🔴 Off', inline: true },
            { name: 'Welcome Ping', value: cfg.welcomePing ? 'On' : 'Off', inline: true },
            { name: 'Goodbye Channel', value: goodbyeChannel, inline: true },
            { name: 'Goodbye', value: cfg.goodbyeEnabled ? '🟢 On' : '🔴 Off', inline: true },
            { name: 'Goodbye Ping', value: cfg.goodbyePing ? 'On' : 'Off', inline: true },
            { name: 'DM Welcome', value: cfg.dmEnabled ? '🟢 On' : '🔴 Off', inline: true },
            { name: 'Quotes', value: quoteStatus, inline: true },
            { name: 'Autorole Delay', value: `\`${cfg.autoRoleDelay || 0}s\``, inline: true },
            { name: 'Welcome Message', value: previewText(cfg.welcomeMessage, 'Welcome {user} to {server}!'), inline: false },
            { name: 'Goodbye Message', value: previewText(cfg.leaveMessage, '{user.tag} has left the server.'), inline: false },
            {
                name: 'DM Message',
                value: cfg.dmMessage
                    ? previewText(cfg.dmMessage, '', 70)
                    : '`Not set`',
                inline: false,
            },
            { name: 'Autoroles', value: roles, inline: false },
        )
        .setFooter({ text: 'Variables: {user} {user.tag} {server} {memberCount} · closes after 10m idle' })
        .setTimestamp();
}

function buildSelectMenu(guildId) {
    return new StringSelectMenuBuilder()
        .setCustomId(`welcomer_select_${guildId}`)
        .setPlaceholder('Select a setting to configure...')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Welcome Channel')
                .setDescription('Where join messages are posted')
                .setValue('welcome_channel')
                .setEmoji('🟢'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Welcome Message')
                .setDescription('Embed description text on join')
                .setValue('welcome_message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Welcome Title')
                .setDescription('Embed title for welcome messages')
                .setValue('welcome_title')
                .setEmoji('📌'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Welcome Image')
                .setDescription('Banner image URL or upload')
                .setValue('welcome_image')
                .setEmoji('🖼️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('DM Welcome Message')
                .setDescription('Private message sent to new members')
                .setValue('dm_message')
                .setEmoji('📩'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Goodbye Channel')
                .setDescription('Where leave messages are posted')
                .setValue('goodbye_channel')
                .setEmoji('🔴'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Goodbye Message')
                .setDescription('Text shown when a member leaves')
                .setValue('goodbye_message')
                .setEmoji('💬'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Goodbye Image')
                .setDescription('Banner image for goodbye embeds')
                .setValue('goodbye_image')
                .setEmoji('🖼️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Autoroles')
                .setDescription('Roles assigned automatically on join')
                .setValue('autoroles')
                .setEmoji('🎭'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Autorole Delay')
                .setDescription('Seconds to wait before assigning roles')
                .setValue('autorole_delay')
                .setEmoji('⏱️'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Manage Quotes')
                .setDescription('Add or clear rotating welcome quotes')
                .setValue('manage_quotes')
                .setEmoji('✨'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Test Preview')
                .setDescription('Preview the welcome embed as yourself')
                .setValue('test_preview')
                .setEmoji('👀'),
        );
}

function buildButtonRows(cfg, guildId, disabled = false) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`welcomer_toggle_welcome_${guildId}`)
                .setLabel('Welcome')
                .setStyle(cfg.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji('🟢')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`welcomer_toggle_goodbye_${guildId}`)
                .setLabel('Goodbye')
                .setStyle(cfg.goodbyeEnabled ? ButtonStyle.Success : ButtonStyle.Danger)
                .setEmoji('🔴')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`welcomer_toggle_dm_${guildId}`)
                .setLabel('DM')
                .setStyle(cfg.dmEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('📩')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`welcomer_toggle_quotes_${guildId}`)
                .setLabel('Quotes')
                .setStyle(cfg.quotesEnabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('✨')
                .setDisabled(disabled),
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`welcomer_ping_welcome_${guildId}`)
                .setLabel('Ping Welcome')
                .setStyle(cfg.welcomePing ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🔔')
                .setDisabled(disabled),
            new ButtonBuilder()
                .setCustomId(`welcomer_ping_goodbye_${guildId}`)
                .setLabel('Ping Goodbye')
                .setStyle(cfg.goodbyePing ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setEmoji('🔔')
                .setDisabled(disabled),
        ),
    ];
}

async function refreshDashboard(rootInteraction, cfg, guildId) {
    try {
        await InteractionHelper.safeEditReply(rootInteraction, {
            embeds: [buildDashboardEmbed(cfg, rootInteraction.guild)],
            components: [
                ...buildButtonRows(cfg, guildId),
                new ActionRowBuilder().addComponents(buildSelectMenu(guildId)),
            ],
        });
    } catch (error) {
        logger.debug('Could not refresh welcomer dashboard:', error.message);
    }
}

function buildPreviewEmbed(cfg, member, guild) {
    const formatData = { user: member.user, guild, member };
    const welcomeMessage = formatWelcomeMessage(
        cfg.welcomeMessage || 'Welcome {user} to {server}!',
        formatData,
    );
    const embedTitle = formatWelcomeMessage(
        cfg.welcomeEmbed?.title || '🎉 Welcome!',
        formatData,
    );
    const embedFooter = cfg.welcomeEmbed?.footer
        ? formatWelcomeMessage(cfg.welcomeEmbed.footer, formatData)
        : `Welcome to ${guild.name}!`;

    const embed = new EmbedBuilder()
        .setColor(cfg.welcomeEmbed?.color || getColor('success'))
        .setTitle(embedTitle)
        .setDescription(welcomeMessage)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
            { name: 'Member Count', value: String(guild.memberCount), inline: true },
        )
        .setTimestamp()
        .setFooter({ text: embedFooter });

    const quote = pickWelcomeQuote(cfg);
    if (quote) {
        embed.addFields({ name: 'Quote', value: formatWelcomeMessage(quote, formatData), inline: false });
    }
    if (cfg.welcomeImage) {
        embed.setImage(cfg.welcomeImage);
    }
    return embed;
}

export async function runWelcomerDashboard(interaction, client) {
    const guildId = interaction.guild.id;
    const cfg = await getWelcomeConfig(client, guildId);

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!interaction.deferred && !interaction.replied) return;

    await InteractionHelper.safeEditReply(interaction, {
        embeds: [buildDashboardEmbed(cfg, interaction.guild)],
        components: [
            ...buildButtonRows(cfg, guildId),
            new ActionRowBuilder().addComponents(buildSelectMenu(guildId)),
        ],
    });

    const selectCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        filter: (i) =>
            i.user.id === interaction.user.id && i.customId === `welcomer_select_${guildId}`,
        time: 600_000,
    });

    selectCollector.on('collect', async (selectInteraction) => {
        const selected = selectInteraction.values[0];
        try {
            switch (selected) {
                case 'welcome_channel':
                    await handleWelcomeChannel(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'welcome_message':
                    await handleTextModal(selectInteraction, interaction, cfg, guildId, client, {
                        customId: 'welcomer_welcome_message',
                        title: 'Edit Welcome Message',
                        label: 'Message ({user}, {server}, {memberCount})',
                        getValue: () => cfg.welcomeMessage || 'Welcome {user} to {server}!',
                        apply: (value) => { cfg.welcomeMessage = value; },
                        successTitle: 'Welcome Message Updated',
                    });
                    break;
                case 'welcome_title':
                    await handleTextModal(selectInteraction, interaction, cfg, guildId, client, {
                        customId: 'welcomer_welcome_title',
                        title: 'Edit Welcome Title',
                        label: 'Embed title',
                        style: TextInputStyle.Short,
                        maxLength: 256,
                        getValue: () => cfg.welcomeEmbed?.title || '🎉 Welcome!',
                        apply: (value) => {
                            cfg.welcomeEmbed = { ...(cfg.welcomeEmbed || {}), title: value };
                        },
                        successTitle: 'Welcome Title Updated',
                    });
                    break;
                case 'welcome_image':
                    await handleWelcomeImage(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'dm_message':
                    await handleTextModal(selectInteraction, interaction, cfg, guildId, client, {
                        customId: 'welcomer_dm_message',
                        title: 'Edit DM Welcome',
                        label: 'DM text (leave blank to clear)',
                        required: false,
                        getValue: () => cfg.dmMessage || '',
                        apply: (value) => {
                            cfg.dmMessage = value;
                            if (value) cfg.dmEnabled = true;
                        },
                        successTitle: 'DM Welcome Updated',
                    });
                    break;
                case 'goodbye_channel':
                    await handleGoodbyeChannel(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'goodbye_message':
                    await handleTextModal(selectInteraction, interaction, cfg, guildId, client, {
                        customId: 'welcomer_goodbye_message',
                        title: 'Edit Goodbye Message',
                        label: 'Message ({user.tag}, {server})',
                        getValue: () => cfg.leaveMessage || '{user.tag} has left the server.',
                        apply: (value) => { cfg.leaveMessage = value; },
                        successTitle: 'Goodbye Message Updated',
                    });
                    break;
                case 'goodbye_image':
                    await handleGoodbyeImage(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'autoroles':
                    await handleAutoroles(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'autorole_delay':
                    await handleTextModal(selectInteraction, interaction, cfg, guildId, client, {
                        customId: 'welcomer_autorole_delay',
                        title: 'Autorole Delay',
                        label: 'Delay in seconds (0–600)',
                        style: TextInputStyle.Short,
                        maxLength: 3,
                        getValue: () => String(cfg.autoRoleDelay || 0),
                        apply: (value) => {
                            const parsed = Number.parseInt(value, 10);
                            if (Number.isNaN(parsed) || parsed < 0 || parsed > 600) {
                                throw new CrubError(
                                    'Invalid delay',
                                    ErrorTypes.VALIDATION,
                                    'Enter a number between **0** and **600** seconds.',
                                );
                            }
                            cfg.autoRoleDelay = parsed;
                        },
                        successTitle: 'Autorole Delay Updated',
                    });
                    break;
                case 'manage_quotes':
                    await handleQuotes(selectInteraction, interaction, cfg, guildId, client);
                    break;
                case 'test_preview':
                    await handleTestPreview(selectInteraction, interaction, cfg);
                    break;
                default:
                    break;
            }
        } catch (error) {
            if (error instanceof CrubError) {
                logger.debug(`Welcomer config validation error: ${error.message}`);
            } else {
                logger.error('Unexpected welcomer dashboard error:', error);
            }

            if (!selectInteraction.replied && !selectInteraction.deferred) {
                await selectInteraction.deferUpdate().catch(() => {});
            }

            await replyUserError(selectInteraction, {
                type: ErrorTypes.CONFIGURATION,
                message:
                    error instanceof CrubError
                        ? error.userMessage || 'An error occurred while processing your selection.'
                        : 'An unexpected error occurred while updating the configuration.',
            }).catch(() => {});
        }
    });

    const btnCollector = interaction.channel.createMessageComponentCollector({
        componentType: ComponentType.Button,
        filter: (i) =>
            i.user.id === interaction.user.id &&
            i.customId.startsWith('welcomer_') &&
            i.customId.endsWith(`_${guildId}`),
        time: 600_000,
    });

    btnCollector.on('collect', async (btnInteraction) => {
        try {
            if (!await deferComponent(btnInteraction)) return;
            const id = btnInteraction.customId;

            if (id === `welcomer_toggle_welcome_${guildId}`) {
                cfg.enabled = !cfg.enabled;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('Welcome Updated', `Welcome messages are now **${cfg.enabled ? 'enabled' : 'disabled'}**.`)],
                });
            } else if (id === `welcomer_toggle_goodbye_${guildId}`) {
                cfg.goodbyeEnabled = !cfg.goodbyeEnabled;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('Goodbye Updated', `Goodbye messages are now **${cfg.goodbyeEnabled ? 'enabled' : 'disabled'}**.`)],
                });
            } else if (id === `welcomer_toggle_dm_${guildId}`) {
                cfg.dmEnabled = !cfg.dmEnabled;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('DM Welcome Updated', `DM welcomes are now **${cfg.dmEnabled ? 'enabled' : 'disabled'}**.`)],
                });
            } else if (id === `welcomer_toggle_quotes_${guildId}`) {
                cfg.quotesEnabled = !cfg.quotesEnabled;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('Quotes Updated', `Welcome quotes are now **${cfg.quotesEnabled ? 'enabled' : 'disabled'}**.`)],
                });
            } else if (id === `welcomer_ping_welcome_${guildId}`) {
                cfg.welcomePing = !cfg.welcomePing;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('Welcome Ping Updated', `Join pings are now **${cfg.welcomePing ? 'on' : 'off'}**.`)],
                });
            } else if (id === `welcomer_ping_goodbye_${guildId}`) {
                cfg.goodbyePing = !cfg.goodbyePing;
                await saveWelcomeConfig(client, guildId, cfg);
                await sendEphemeralFollowUp(btnInteraction, {
                    embeds: [successEmbed('Goodbye Ping Updated', `Leave pings are now **${cfg.goodbyePing ? 'on' : 'off'}**.`)],
                });
            }

            await refreshDashboard(interaction, cfg, guildId);
        } catch (error) {
            logger.error('Error handling welcomer dashboard button:', error);
        }
    });

    const onTimeout = async () => {
        try {
            await InteractionHelper.safeEditReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(getColor('warning'))
                        .setTitle('Dashboard Closed')
                        .setDescription('This dashboard has been closed due to inactivity. Run `/welcomer` again to continue.'),
                ],
                components: [],
            });
        } catch (error) {
            logger.debug('Could not update welcomer dashboard on timeout:', error.message);
        }
    };

    selectCollector.on('end', (_, reason) => {
        if (reason === 'time') onTimeout();
    });
    btnCollector.on('end', (_, reason) => {
        if (reason === 'time') onTimeout();
    });
}

export default {
    prefixOnly: false,
    async execute(interaction, _config, client) {
        try {
            await runWelcomerDashboard(interaction, client);
        } catch (error) {
            logger.error('Unexpected error in welcomer_dashboard:', error);
            throw new CrubError(
                `Welcomer dashboard failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open the welcomer dashboard.',
            );
        }
    },
};

async function handleTextModal(selectInteraction, rootInteraction, cfg, guildId, client, options) {
    const modal = new ModalBuilder()
        .setCustomId(options.customId)
        .setTitle(options.title)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value_input')
                    .setLabel(options.label)
                    .setStyle(options.style || TextInputStyle.Paragraph)
                    .setValue(options.getValue())
                    .setMaxLength(options.maxLength || 2000)
                    .setRequired(options.required !== false),
            ),
        );

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (i) =>
                i.customId === options.customId && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);

    if (!submitted) return;

    try {
        const value = submitted.fields.getTextInputValue('value_input').trim();
        options.apply(value);
        await saveWelcomeConfig(client, guildId, cfg);
        await submitted.reply({
            embeds: [successEmbed(options.successTitle, 'Saved successfully.')],
            flags: MessageFlags.Ephemeral,
        });
        await refreshDashboard(rootInteraction, cfg, guildId);
    } catch (error) {
        await replyUserError(submitted, {
            type: error instanceof CrubError ? error.type : ErrorTypes.VALIDATION,
            message: error instanceof CrubError ? error.userMessage : 'Could not save that value.',
        });
    }
}

async function handleWelcomeChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    if (!await deferComponent(selectInteraction)) return;

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('welcomer_welcome_channel')
        .setPlaceholder('Select a text channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await sendEphemeralFollowUp(selectInteraction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('🟢 Welcome Channel')
                .setDescription(
                    `**Current:** ${cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`'}\n\nSelect the channel where welcome messages will be sent.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: (i) =>
            i.user.id === selectInteraction.user.id && i.customId === 'welcomer_welcome_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async (chanInteraction) => {
        if (!await deferComponent(chanInteraction)) return;
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await replyUserError(chanInteraction, {
                type: ErrorTypes.PERMISSION,
                message: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.`,
            });
            return;
        }

        cfg.channelId = channel.id;
        if (!cfg.enabled) cfg.enabled = true;
        await saveWelcomeConfig(client, guildId, cfg);
        await sendEphemeralFollowUp(chanInteraction, {
            embeds: [successEmbed('Channel Updated', `Welcome messages will now be sent in ${channel}.`)],
        });
        await refreshDashboard(rootInteraction, cfg, guildId);
    });
}

async function handleGoodbyeChannel(selectInteraction, rootInteraction, cfg, guildId, client) {
    if (!await deferComponent(selectInteraction)) return;

    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('welcomer_goodbye_channel')
        .setPlaceholder('Select a text channel...')
        .addChannelTypes(ChannelType.GuildText)
        .setMaxValues(1);

    await sendEphemeralFollowUp(selectInteraction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('🔴 Goodbye Channel')
                .setDescription(
                    `**Current:** ${cfg.goodbyeChannelId ? `<#${cfg.goodbyeChannelId}>` : '`Not set`'}\n\nSelect the channel where goodbye messages will be sent.`,
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(channelSelect)],
    });

    const chanCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.ChannelSelect,
        filter: (i) =>
            i.user.id === selectInteraction.user.id && i.customId === 'welcomer_goodbye_channel',
        time: 60_000,
        max: 1,
    });

    chanCollector.on('collect', async (chanInteraction) => {
        if (!await deferComponent(chanInteraction)) return;
        const channel = chanInteraction.channels.first();

        if (!botHasPermission(channel, ['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
            await replyUserError(chanInteraction, {
                type: ErrorTypes.PERMISSION,
                message: `I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel}.`,
            });
            return;
        }

        cfg.goodbyeChannelId = channel.id;
        if (!cfg.goodbyeEnabled) cfg.goodbyeEnabled = true;
        await saveWelcomeConfig(client, guildId, cfg);
        await sendEphemeralFollowUp(chanInteraction, {
            embeds: [successEmbed('Channel Updated', `Goodbye messages will now be sent in ${channel}.`)],
        });
        await refreshDashboard(rootInteraction, cfg, guildId);
    });
}

async function handleWelcomeImage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder().setCustomId('welcomer_welcome_image').setTitle('Set Welcome Image');
    const imageHint = new TextDisplayBuilder()
        .setContent('Provide a direct image URL **or** upload a file. Leave blank to remove.');
    const urlLabel = new LabelBuilder()
        .setLabel('Image URL (optional)')
        .setTextInputComponent(
            new TextInputBuilder()
                .setCustomId('image_input')
                .setPlaceholder('https://example.com/welcome.png')
                .setStyle(TextInputStyle.Short)
                .setValue(cfg.welcomeImage || '')
                .setRequired(false),
        );
    const uploadLabel = new LabelBuilder()
        .setLabel('Or upload an image file (optional)')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('image_upload').setRequired(false));

    modal.addTextDisplayComponents(imageHint).addLabelComponents(urlLabel, uploadLabel);

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (i) =>
                i.customId === 'welcomer_welcome_image' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);
    if (!submitted) return;

    const uploadedFiles = submitted.fields.getUploadedFiles('image_upload');
    let imageUrl = uploadedFiles?.at(0)?.url ?? submitted.fields.getTextInputValue('image_input').trim();

    if (imageUrl) {
        try {
            const parsed = new URL(imageUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                await replyUserError(submitted, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Image URL must start with `http://` or `https://`.',
                });
                return;
            }
        } catch {
            await replyUserError(submitted, {
                type: ErrorTypes.VALIDATION,
                message: 'Please provide a valid image URL.',
            });
            return;
        }
    }

    cfg.welcomeImage = imageUrl || null;
    await saveWelcomeConfig(client, guildId, cfg);
    await submitted.reply({
        embeds: [successEmbed('Welcome Image Updated', `Image ${imageUrl ? 'updated' : 'removed'} successfully.`)],
        flags: MessageFlags.Ephemeral,
    });
    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleGoodbyeImage(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder().setCustomId('welcomer_goodbye_image').setTitle('Set Goodbye Image');
    const imageHint = new TextDisplayBuilder()
        .setContent('Provide a direct image URL **or** upload a file. Leave blank to remove.');
    const current =
        typeof cfg.leaveEmbed?.image === 'string'
            ? cfg.leaveEmbed.image
            : cfg.leaveEmbed?.image?.url || '';
    const urlLabel = new LabelBuilder()
        .setLabel('Image URL (optional)')
        .setTextInputComponent(
            new TextInputBuilder()
                .setCustomId('image_input')
                .setPlaceholder('https://example.com/goodbye.png')
                .setStyle(TextInputStyle.Short)
                .setValue(current)
                .setRequired(false),
        );
    const uploadLabel = new LabelBuilder()
        .setLabel('Or upload an image file (optional)')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('image_upload').setRequired(false));

    modal.addTextDisplayComponents(imageHint).addLabelComponents(urlLabel, uploadLabel);

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (i) =>
                i.customId === 'welcomer_goodbye_image' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);
    if (!submitted) return;

    const uploadedFiles = submitted.fields.getUploadedFiles('image_upload');
    let imageUrl = uploadedFiles?.at(0)?.url ?? submitted.fields.getTextInputValue('image_input').trim();

    if (imageUrl) {
        try {
            const parsed = new URL(imageUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                await replyUserError(submitted, {
                    type: ErrorTypes.VALIDATION,
                    message: 'Image URL must start with `http://` or `https://`.',
                });
                return;
            }
        } catch {
            await replyUserError(submitted, {
                type: ErrorTypes.VALIDATION,
                message: 'Please provide a valid image URL.',
            });
            return;
        }
    }

    const nextLeaveEmbed = { ...(cfg.leaveEmbed || {}) };
    if (imageUrl) nextLeaveEmbed.image = imageUrl;
    else delete nextLeaveEmbed.image;
    cfg.leaveEmbed = nextLeaveEmbed;
    await saveWelcomeConfig(client, guildId, cfg);
    await submitted.reply({
        embeds: [successEmbed('Goodbye Image Updated', `Image ${imageUrl ? 'updated' : 'removed'} successfully.`)],
        flags: MessageFlags.Ephemeral,
    });
    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleAutoroles(selectInteraction, rootInteraction, cfg, guildId, client) {
    if (!await deferComponent(selectInteraction)) return;

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('welcomer_autoroles')
        .setPlaceholder('Select autoroles (empty = clear)')
        .setMinValues(0)
        .setMaxValues(10);

    await sendEphemeralFollowUp(selectInteraction, {
        embeds: [
            new EmbedBuilder()
                .setTitle('🎭 Autoroles')
                .setDescription(
                    'Pick up to **10** roles to assign on join.\nSelecting none clears autoroles.\nMake sure my highest role sits above these.',
                )
                .setColor(getColor('info')),
        ],
        components: [new ActionRowBuilder().addComponents(roleSelect)],
    });

    const roleCollector = rootInteraction.channel.createMessageComponentCollector({
        componentType: ComponentType.RoleSelect,
        filter: (i) =>
            i.user.id === selectInteraction.user.id && i.customId === 'welcomer_autoroles',
        time: 60_000,
        max: 1,
    });

    roleCollector.on('collect', async (roleInteraction) => {
        if (!await deferComponent(roleInteraction)) return;
        const me = rootInteraction.guild.members.me;
        const selected = [...roleInteraction.roles.values()];
        const tooHigh = selected.filter(
            (role) => me && role.position >= me.roles.highest.position,
        );

        if (tooHigh.length) {
            await replyUserError(roleInteraction, {
                type: ErrorTypes.PERMISSION,
                message: `I can't assign: ${tooHigh.map((r) => r.toString()).join(', ')} (higher than or equal to my top role).`,
            });
            return;
        }

        cfg.roleIds = selected.map((role) => role.id);
        await saveWelcomeConfig(client, guildId, cfg);
        await sendEphemeralFollowUp(roleInteraction, {
            embeds: [
                successEmbed(
                    'Autoroles Updated',
                    cfg.roleIds.length
                        ? `Now assigning: ${cfg.roleIds.map((id) => `<@&${id}>`).join(', ')}`
                        : 'Autoroles cleared.',
                ),
            ],
        });
        await refreshDashboard(rootInteraction, cfg, guildId);
    });
}

async function handleQuotes(selectInteraction, rootInteraction, cfg, guildId, client) {
    const modal = new ModalBuilder()
        .setCustomId('welcomer_quotes')
        .setTitle('Welcome Quotes')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('quotes_input')
                    .setLabel('One quote per line (blank = built-in pool)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue((cfg.quotes || []).join('\n').slice(0, 1900))
                    .setRequired(false)
                    .setMaxLength(1900),
            ),
        );

    try {
        await selectInteraction.showModal(modal);
    } catch {
        return;
    }

    const submitted = await selectInteraction
        .awaitModalSubmit({
            filter: (i) =>
                i.customId === 'welcomer_quotes' && i.user.id === selectInteraction.user.id,
            time: 120_000,
        })
        .catch(() => null);
    if (!submitted) return;

    const raw = submitted.fields.getTextInputValue('quotes_input');
    cfg.quotes = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 50);
    if (cfg.quotes.length > 0) cfg.quotesEnabled = true;
    await saveWelcomeConfig(client, guildId, cfg);

    await submitted.reply({
        embeds: [
            successEmbed(
                'Quotes Updated',
                cfg.quotes.length
                    ? `Saved **${cfg.quotes.length}** custom quote(s).`
                    : 'Custom quotes cleared — built-in pool will be used when Quotes is on.',
            ),
        ],
        flags: MessageFlags.Ephemeral,
    });
    await refreshDashboard(rootInteraction, cfg, guildId);
}

async function handleTestPreview(selectInteraction, rootInteraction, cfg) {
    if (!await deferComponent(selectInteraction)) return;
    const member = rootInteraction.member;
    const embed = buildPreviewEmbed(cfg, member, rootInteraction.guild);
    await sendEphemeralFollowUp(selectInteraction, {
        content: cfg.welcomePing ? member.toString() : undefined,
        embeds: [embed],
    });
}
