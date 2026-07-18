import { getColor } from '../../config/bot.js';
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError, withErrorHandling, createError, ErrorTypes, replyUserError } from '../../utils/errorHandler.js';
import ApplicationService from '../../services/applicationService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logEvent, EVENT_TYPES, resolveApplicationLogChannel } from '../../services/loggingService.js';
import { formatLogLine, resolveUserAuthor } from '../../utils/logEmbeds.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import {
  getApplicationSettings,
  getUserApplications,
  getApplication,
  getApplicationRoles,
  updateApplication,
  getApplicationRoleSettings,
} from '../../utils/database.js';
import {
  resolveApplicationQuestions,
  getQuestionPageCount,
  getQuestionsForPage,
  truncateModalTitle,
  formatQuestionLabel,
  MAX_ANSWER_LENGTH,
} from '../../utils/applicationQuestions.js';
import {
  createApplicationDraft,
  getApplicationDraft,
  saveApplicationDraft,
  deleteApplicationDraft,
  setDraftPageAnswers,
  draftAnswersComplete,
} from '../../services/applicationWizard.js';

function getApplicationStatusPresentation(statusValue) {
  const normalized = typeof statusValue === 'string' ? statusValue.trim().toLowerCase() : 'unknown';
  const statusLabel =
    normalized === 'pending' ? 'In Progress' :
    normalized === 'approved' ? 'Accepted' :
    normalized === 'denied' ? 'Denied' :
    'Unknown';
  const statusEmoji =
    normalized === 'pending' ? '🟡' :
    normalized === 'approved' ? '🟢' :
    normalized === 'denied' ? '🔴' :
    '⚪';

  return { normalized, statusLabel, statusEmoji };
}

function buildApplicationModal({ roleId, roleName, questions, page, draftId }) {
  const pageQuestions = getQuestionsForPage(questions, page);
  const pageCount = getQuestionPageCount(questions);
  const modal = new ModalBuilder()
    .setCustomId(`app_modal_${roleId}_${page}_${draftId}`)
    .setTitle(truncateModalTitle(
      pageCount > 1
        ? `${roleName} (${page + 1}/${pageCount})`
        : `Application for ${roleName}`,
    ));

  for (const question of pageQuestions) {
    const input = new TextInputBuilder()
      .setCustomId(`q${question.absoluteIndex}`)
      .setLabel(formatQuestionLabel(question.prompt, question.absoluteIndex))
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_ANSWER_LENGTH);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

function buildWizardControls(draft, page, ephemeral = true) {
  const pageCount = getQuestionPageCount(draft.questions);
  const answered = draft.answers.filter((entry) => entry?.answer).length;
  const embed = createEmbed({
    title: `Application in Progress — ${draft.roleName}`,
    description: [
      `**Progress:** ${answered}/${draft.questions.length} answered`,
      `**Page:** ${page + 1}/${pageCount}`,
      '',
      page + 1 < pageCount
        ? 'Click **Continue** to answer the next set of questions.'
        : 'All pages are complete. Submitting your application…',
    ].join('\n'),
    color: getColor('info'),
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`app_wiz_next_${draft.draftId}`)
      .setLabel(page + 1 < pageCount ? 'Continue' : 'Finish')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page + 1 >= pageCount),
    new ButtonBuilder()
      .setCustomId(`app_wiz_cancel_${draft.draftId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: page + 1 < pageCount ? [row] : [],
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  };
}

async function finalizeApplicationSubmission(interaction, draft) {
  const guild = interaction.client.guilds.cache.get(draft.guildId)
    || await interaction.client.guilds.fetch(draft.guildId).catch(() => null);
  const role = guild?.roles.cache.get(draft.roleId)
    || await guild?.roles.fetch(draft.roleId).catch(() => null);
  if (!role) {
    deleteApplicationDraft(draft.draftId);
    throw createError(
      'Application role missing',
      ErrorTypes.CONFIGURATION,
      'The role for this application no longer exists.',
      { roleId: draft.roleId },
    );
  }
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    deleteApplicationDraft(draft.draftId);
    throw createError(
      'Applicant is no longer in the server',
      ErrorTypes.PERMISSION,
      `You must still be a member of **${guild.name}** to submit this application.`,
      { guildId: guild.id, userId: interaction.user.id },
    );
  }

  const application = await ApplicationService.submitApplication(interaction.client, {
    guildId: draft.guildId,
    userId: interaction.user.id,
    roleId: draft.roleId,
    roleName: draft.roleName,
    username: interaction.user.tag,
    avatar: interaction.user.displayAvatarURL(),
    answers: draft.answers,
  });

  deleteApplicationDraft(draft.draftId);

  const embed = successEmbed(
    'Application Submitted',
    `Your application for **${draft.roleName}** has been submitted successfully!\n\n` +
    `Application ID: \`${application.id}\`\n` +
    `You can check the status in **${guild.name}** with \`/apply status id:${application.id}\``,
  );

  await InteractionHelper.safeEditReply(interaction, {
    embeds: [embed],
    components: [],
  });

  const settings = await getApplicationSettings(interaction.client, draft.guildId);
  const roleSettings = await getApplicationRoleSettings(interaction.client, draft.guildId, draft.roleId);
  const guildConfig = await getGuildConfig(interaction.client, draft.guildId);
  const logChannelId = resolveApplicationLogChannel(guildConfig, roleSettings, settings);

  if (logChannelId) {
    const logMessage = await logEvent({
      client: interaction.client,
      guildId: draft.guildId,
      eventType: EVENT_TYPES.APPLICATION_SUBMIT,
      channelId: logChannelId,
      data: {
        title: 'Application Submitted',
        lines: [
          formatLogLine('Applicant', `<@${interaction.user.id}> (${interaction.user.tag})`),
          formatLogLine('Application', draft.roleName),
          formatLogLine('Role', role.name),
          formatLogLine('Application ID', `\`${application.id}\``),
          formatLogLine('Questions', String(draft.answers.length)),
        ],
        inlineFields: [
          { name: 'Status', value: '🟡 In Progress', inline: true },
        ],
        author: await resolveUserAuthor(interaction.client, interaction.user.id),
      },
    });

    if (logMessage) {
      await updateApplication(interaction.client, draft.guildId, application.id, {
        logMessageId: logMessage.id,
        logChannelId,
      });
    }
  }
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Manage role applications')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('submit')
        .setDescription('Submit an application for a role')
        .addStringOption((option) =>
          option
            .setName('application')
            .setDescription('The application you want to submit')
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addStringOption((option) =>
          option
            .setName('delivery')
            .setDescription('Where to complete the form (defaults to DMs)')
            .setRequired(false)
            .addChoices(
              { name: 'Direct Messages (recommended)', value: 'dm' },
              { name: 'Here (ephemeral)', value: 'here' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Check the status of your application')
        .addStringOption((option) =>
          option
            .setName('id')
            .setDescription('Application ID (leave empty to see all)')
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List available applications to apply for'),
    ),

  category: 'Community',

  execute: withErrorHandling(async (interaction) => {
    if (!interaction.inGuild()) {
      return await replyUserError(interaction, {
        type: ErrorTypes.UNKNOWN,
        message: 'This command can only be used in a server.',
      });
    }

    const { options, guild } = interaction;
    const subcommand = options.getSubcommand();

    if (subcommand !== 'submit') {
      const isListCommand = subcommand === 'list';
      await InteractionHelper.safeDefer(interaction, { flags: isListCommand ? [] : [MessageFlags.Ephemeral] });
    }

    logger.info(`Apply command executed: ${subcommand}`, {
      userId: interaction.user.id,
      guildId: guild.id,
      subcommand,
    });

    const settings = await getApplicationSettings(interaction.client, guild.id);

    if (!settings.enabled) {
      throw createError(
        'Applications are disabled',
        ErrorTypes.CONFIGURATION,
        'Applications are currently disabled in this server.',
        { guildId: guild.id },
      );
    }

    if (subcommand === 'submit') {
      await handleSubmit(interaction, settings);
    } else if (subcommand === 'status') {
      await handleStatus(interaction);
    } else if (subcommand === 'list') {
      await handleList(interaction);
    }
  }, { type: 'command', commandName: 'apply' }),
};

export async function handleApplicationModal(interaction) {
  if (!interaction.isModalSubmit()) return;

  const customId = interaction.customId;
  if (!customId.startsWith('app_modal_')) return;

  const parts = customId.split('_');
  // Legacy: app_modal_<roleId>
  // Wizard: app_modal_<roleId>_<page>_<draftId>
  const roleId = parts[2];
  const page = parts.length >= 5 ? Number(parts[3]) : 0;
  const draftId = parts.length >= 5 ? parts[4] : null;

  try {
    if (draftId) {
      const draft = getApplicationDraft(draftId);
      if (
        !draft
        || draft.userId !== interaction.user.id
        || (interaction.guildId && draft.guildId !== interaction.guildId)
      ) {
        return await replyUserError(interaction, {
          type: ErrorTypes.VALIDATION,
          message: 'This application session expired. Run `/apply submit` again.',
        });
      }

      const pageQuestions = getQuestionsForPage(draft.questions, page);
      const values = {};
      for (const question of pageQuestions) {
        values[`q${question.absoluteIndex}`] = interaction.fields.getTextInputValue(`q${question.absoluteIndex}`);
      }
      setDraftPageAnswers(draft, pageQuestions, values);
      draft.page = page;
      saveApplicationDraft(draft);

      const pageCount = getQuestionPageCount(draft.questions);
      if (page + 1 < pageCount) {
        await InteractionHelper.safeReply(
          interaction,
          buildWizardControls(draft, page, interaction.inGuild()),
        );
        return;
      }

      if (!draftAnswersComplete(draft)) {
        return await replyUserError(interaction, {
          type: ErrorTypes.VALIDATION,
          message: 'Some answers are missing. Please restart the application.',
        });
      }

      await InteractionHelper.safeDefer(
        interaction,
        interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {},
      );
      await finalizeApplicationSubmission(interaction, draft);
      return;
    }

    // Legacy single-modal path
    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
    const applicationRole = applicationRoles.find((appRole) => appRole.roleId === roleId);
    if (!applicationRole) {
      return await replyUserError(interaction, {
        type: ErrorTypes.CONFIGURATION,
        message: 'Application configuration not found.',
      });
    }

    const settings = await getApplicationSettings(interaction.client, interaction.guild.id);
    const roleSettings = await getApplicationRoleSettings(interaction.client, interaction.guild.id, roleId);
    const questions = resolveApplicationQuestions(roleSettings, settings);
    const answers = questions.map((question, index) => ({
      question,
      answer: interaction.fields.getTextInputValue(`q${index}`),
    }));

    const draft = {
      draftId: 'legacy',
      guildId: interaction.guildId,
      userId: interaction.user.id,
      roleId,
      roleName: applicationRole.name,
      questions,
      answers,
    };

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    await finalizeApplicationSubmission(interaction, draft);
  } catch (error) {
    logger.error('Error creating application:', {
      error: error.message,
      userId: interaction.user.id,
      guildId: interaction.guildId || 'dm',
      roleId,
      stack: error.stack,
    });
    await handleInteractionError(interaction, error, {
      type: 'modal',
      handler: 'application_submission',
    });
  }
}

export async function handleApplicationWizardButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('app_wiz_')) return false;

  // app_wiz_next_<id> / app_wiz_cancel_<id>
  const realAction = interaction.customId.startsWith('app_wiz_next_')
    ? 'next'
    : interaction.customId.startsWith('app_wiz_cancel_')
      ? 'cancel'
      : interaction.customId.startsWith('app_wiz_start_')
        ? 'start'
      : null;
  const id = interaction.customId
    .replace('app_wiz_next_', '')
    .replace('app_wiz_cancel_', '')
    .replace('app_wiz_start_', '');

  if (!realAction || !id) {
    await replyUserError(interaction, {
      type: ErrorTypes.VALIDATION,
      message: 'Invalid application button.',
    });
    return true;
  }

  const draft = getApplicationDraft(id);
  if (
    !draft
    || draft.userId !== interaction.user.id
    || (interaction.guildId && draft.guildId !== interaction.guildId)
  ) {
    await replyUserError(interaction, {
      type: ErrorTypes.VALIDATION,
      message: 'This application session expired. Run `/apply submit` again.',
    });
    return true;
  }

  if (realAction === 'cancel') {
    deleteApplicationDraft(id);
    await interaction.update({
      embeds: [successEmbed('Application Cancelled', 'Your in-progress application was discarded.')],
      components: [],
    });
    return true;
  }

  if (realAction === 'start') {
    draft.page = 0;
    saveApplicationDraft(draft);
    await interaction.showModal(buildApplicationModal({
      roleId: draft.roleId,
      roleName: draft.roleName,
      questions: draft.questions,
      page: 0,
      draftId: draft.draftId,
    }));
    return true;
  }

  const nextPage = (draft.page || 0) + 1;
  const pageCount = getQuestionPageCount(draft.questions);
  if (nextPage >= pageCount) {
    await replyUserError(interaction, {
      type: ErrorTypes.VALIDATION,
      message: 'There are no more question pages.',
    });
    return true;
  }

  draft.page = nextPage;
  saveApplicationDraft(draft);
  await interaction.showModal(buildApplicationModal({
    roleId: draft.roleId,
    roleName: draft.roleName,
    questions: draft.questions,
    page: nextPage,
    draftId: draft.draftId,
  }));
  return true;
}

async function handleList(interaction) {
  try {
    const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);

    if (applicationRoles.length === 0) {
      return await replyUserError(interaction, {
        type: ErrorTypes.USER_INPUT,
        message: 'No applications are currently available.',
      });
    }

    const embed = createEmbed({
      title: 'Available Applications',
      description: 'Here are the roles you can apply for:',
    });

    applicationRoles.forEach((appRole, index) => {
      const role = interaction.guild.roles.cache.get(appRole.roleId);
      embed.addFields({
        name: `${index + 1}. ${appRole.name}`,
        value: `**Role:** ${role ? `<@&${appRole.roleId}>` : 'Role not found'}\n` +
          `**Apply with:** \`/apply submit application:"${appRole.name}"\``,
        inline: false,
      });
    });

    embed.setFooter({
      text: 'Use /apply submit application:<name> to apply for any of these roles.',
    });

    return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
  } catch (error) {
    logger.error('Error listing applications:', {
      error: error.message,
      guildId: interaction.guild.id,
      stack: error.stack,
    });

    throw createError(
      'Failed to load applications',
      ErrorTypes.DATABASE,
      'Failed to load applications. Please try again later.',
      { guildId: interaction.guild.id },
    );
  }
}

async function handleSubmit(interaction, settings) {
  const applicationName = interaction.options.getString('application');

  const applicationRoles = await getApplicationRoles(interaction.client, interaction.guild.id);
  const applicationRole = applicationRoles.find((appRole) =>
    appRole.name.toLowerCase() === applicationName.toLowerCase(),
  );

  if (!applicationRole) {
    return await replyUserError(interaction, {
      type: ErrorTypes.USER_INPUT,
      message: 'Use `/apply list` to see available applications.',
    });
  }

  const userApps = await getUserApplications(
    interaction.client,
    interaction.guild.id,
    interaction.user.id,
  );
  const pendingApp = userApps.find((app) => app.status === 'pending');

  if (pendingApp) {
    return await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message: 'You already have a pending application. Please wait for it to be reviewed.',
    });
  }

  const role = interaction.guild.roles.cache.get(applicationRole.roleId);
  if (!role) {
    return await replyUserError(interaction, {
      type: ErrorTypes.USER_INPUT,
      message: 'The role for this application no longer exists.',
    });
  }

  const roleSettings = await getApplicationRoleSettings(
    interaction.client,
    interaction.guild.id,
    applicationRole.roleId,
  );
  const questions = resolveApplicationQuestions(roleSettings, settings);
  const draft = createApplicationDraft({
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    roleId: applicationRole.roleId,
    roleName: applicationRole.name,
    questions,
  });

  const delivery = interaction.options.getString('delivery') || 'dm';
  if (delivery === 'dm') {
    const dm = await interaction.user.createDM().catch(() => null);
    if (!dm) {
      deleteApplicationDraft(draft.draftId);
      return await replyUserError(interaction, {
        type: ErrorTypes.PERMISSION,
        message: 'I could not open your DMs. Enable direct messages for this server, then try again.',
      });
    }

    const startRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`app_wiz_start_${draft.draftId}`)
        .setLabel('Start Application')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`app_wiz_cancel_${draft.draftId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const dmMessage = await dm.send({
      embeds: [createEmbed({
        title: `Application — ${applicationRole.name}`,
        description: [
          `**Server:** ${interaction.guild.name}`,
          `**Questions:** ${questions.length}`,
          `**Pages:** ${getQuestionPageCount(questions)}`,
          '',
          'Your answers stay private and are submitted back to the server for staff review.',
          'This session expires after 30 minutes of inactivity.',
        ].join('\n'),
        color: getColor('info'),
      })],
      components: [startRow],
    }).catch(() => null);

    if (!dmMessage) {
      deleteApplicationDraft(draft.draftId);
      return await replyUserError(interaction, {
        type: ErrorTypes.PERMISSION,
        message: 'I could not message you. Enable DMs from server members, then try again.',
      });
    }

    await interaction.reply({
      embeds: [successEmbed(
        'Application Sent to Your DMs',
        `Open your DMs with me and click **Start Application** for **${applicationRole.name}**.`,
      )],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildApplicationModal({
    roleId: applicationRole.roleId,
    roleName: applicationRole.name,
    questions,
    page: 0,
    draftId: draft.draftId,
  }));
}

async function handleStatus(interaction) {
  const appId = interaction.options.getString('id');

  if (appId) {
    const application = await getApplication(
      interaction.client,
      interaction.guild.id,
      appId,
    );

    if (!application || application.userId !== interaction.user.id) {
      return await replyUserError(interaction, {
        type: ErrorTypes.PERMISSION,
        message: 'Application not found or you do not have permission to view it.',
      });
    }

    const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
    const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
      ? submittedAt.toLocaleString()
      : 'Unknown date';
    const statusView = getApplicationStatusPresentation(application.status);
    const embed = createEmbed({
      title: `Application #${application.id} - ${application.roleName || 'Unknown Role'}`,
      description:
        `**Application ID:** \`${application.id}\`\n` +
        `**Status:** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
        `**Submitted:** ${submittedAtDisplay}\n` +
        `**Questions answered:** ${application.answers?.length || 0}`,
    });

    return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  const applications = await getUserApplications(
    interaction.client,
    interaction.guild.id,
    interaction.user.id,
  );

  if (applications.length === 0) {
    return await replyUserError(interaction, {
      type: ErrorTypes.UNKNOWN,
      message: 'You have not submitted any applications yet.',
    });
  }

  const recentApplications = applications
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 10);

  const embed = createEmbed({
    title: 'Your Applications',
    description: `Showing ${recentApplications.length} recent application(s).`,
  });

  recentApplications.forEach((application) => {
    const submittedAt = application?.createdAt ? new Date(application.createdAt) : null;
    const submittedAtDisplay = submittedAt && !Number.isNaN(submittedAt.getTime())
      ? submittedAt.toLocaleDateString()
      : 'Unknown date';
    const statusView = getApplicationStatusPresentation(application.status);

    embed.addFields({
      name: `${statusView.statusEmoji} ${application.roleName || 'Unknown Role'} (${statusView.statusLabel})`,
      value:
        `**ID:** \`${application.id}\`\n` +
        `**Status:** ${statusView.statusEmoji} ${statusView.statusLabel}\n` +
        `**Submitted:** ${submittedAtDisplay}`,
      inline: true,
    });
  });

  if (applications.length > recentApplications.length) {
    embed.setFooter({ text: `Showing latest ${recentApplications.length} of ${applications.length} applications.` });
  }

  return InteractionHelper.safeEditReply(interaction, { embeds: [embed], flags: [MessageFlags.Ephemeral] });
}
