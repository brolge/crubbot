import { getColor } from '../../config/bot.js';
import {
  SlashCommandBuilder,
  MessageFlags,
} from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import {
  handleInteractionError,
  withErrorHandling,
  createError,
  ErrorTypes,
  replyUserError,
} from '../../utils/errorHandler.js';
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
  MAX_ANSWER_LENGTH,
} from '../../utils/applicationQuestions.js';
import {
  createApplicationDraft,
  getActiveApplicationDraftForUser,
  saveApplicationDraft,
  deleteApplicationDraft,
  setDraftAnswer,
  draftAnswersComplete,
} from '../../services/applicationWizard.js';

const CANCEL_WORDS = new Set(['cancel', 'stop', 'quit', 'exit']);
const SKIP_WORDS = new Set(['skip']);
const MIN_ANSWER_LENGTH = 10;

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

function formatQuestionPrompt(draft) {
  const index = draft.currentQuestion || 0;
  const total = draft.questions.length;
  const prompt = draft.questions[index];
  return [
    `**Server:** ${draft.guildName || draft.guildId}`,
    `**Application:** ${draft.roleName}`,
    `**Question ${index + 1}/${total}**`,
    '',
    prompt,
    '',
    'Reply with your answer in this DM.',
    'Type `cancel` to stop.',
  ].join('\n');
}

function buildTranscriptLines(answers) {
  return (answers || []).map((entry, index) => {
    const question = entry?.question || `Question ${index + 1}`;
    const answer = entry?.answer || '(no answer)';
    return `**Q${index + 1}.** ${question}\n${answer}`;
  });
}

async function finalizeApplicationSubmission(client, user, draft, notifier = null) {
  const guild = client.guilds.cache.get(draft.guildId)
    || await client.guilds.fetch(draft.guildId).catch(() => null);
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

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    deleteApplicationDraft(draft.draftId);
    throw createError(
      'Applicant is no longer in the server',
      ErrorTypes.PERMISSION,
      `You must still be a member of **${guild.name}** to submit this application.`,
      { guildId: guild.id, userId: user.id },
    );
  }

  const application = await ApplicationService.submitApplication(client, {
    guildId: draft.guildId,
    userId: user.id,
    roleId: draft.roleId,
    roleName: draft.roleName,
    username: user.tag,
    avatar: user.displayAvatarURL(),
    answers: draft.answers,
  });

  deleteApplicationDraft(draft.draftId);

  const confirmation = successEmbed(
    'Application Submitted',
    `Your application for **${draft.roleName}** in **${guild.name}** is in.\n\n` +
    `Application ID: \`${application.id}\`\n` +
    `Check status with \`/apply status id:${application.id}\``,
  );

  if (notifier) {
    await notifier({ embeds: [confirmation] });
  } else {
    await user.send({ embeds: [confirmation] }).catch(() => null);
  }

  const settings = await getApplicationSettings(client, draft.guildId);
  const roleSettings = await getApplicationRoleSettings(client, draft.guildId, draft.roleId);
  const guildConfig = await getGuildConfig(client, draft.guildId);
  const logChannelId = resolveApplicationLogChannel(guildConfig, roleSettings, settings);

  if (logChannelId) {
    const transcript = buildTranscriptLines(draft.answers);
    const logMessage = await logEvent({
      client,
      guildId: draft.guildId,
      eventType: EVENT_TYPES.APPLICATION_SUBMIT,
      channelId: logChannelId,
      data: {
        title: 'Application Submitted',
        lines: [
          formatLogLine('Applicant', `<@${user.id}> (${user.tag})`),
          formatLogLine('Application', draft.roleName),
          formatLogLine('Role', role.name),
          formatLogLine('Application ID', `\`${application.id}\``),
          formatLogLine('Questions', String(draft.answers.length)),
          '',
          '**DM Transcript**',
          ...transcript,
        ],
        inlineFields: [
          { name: 'Status', value: '🟡 In Progress', inline: true },
        ],
        author: await resolveUserAuthor(client, user.id),
      },
    });

    if (logMessage) {
      await updateApplication(client, draft.guildId, application.id, {
        logMessageId: logMessage.id,
        logChannelId,
      });
    }
  }

  return application;
}

async function startDmInterview(interaction, draft) {
  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    deleteApplicationDraft(draft.draftId);
    return replyUserError(interaction, {
      type: ErrorTypes.PERMISSION,
      message: 'I could not open your DMs. Enable direct messages for this server, then try again.',
    });
  }

  const intro = await dm.send({
    embeds: [createEmbed({
      title: `Application — ${draft.roleName}`,
      description: [
        `**Server:** ${interaction.guild.name}`,
        `**Questions:** ${draft.questions.length}`,
        '',
        'No forms. Just answer each question by sending a normal DM reply.',
        'Type `cancel` anytime to stop.',
        'This session expires after 30 minutes of inactivity.',
      ].join('\n'),
      color: getColor('info'),
    })],
  }).catch(() => null);

  if (!intro) {
    deleteApplicationDraft(draft.draftId);
    return replyUserError(interaction, {
      type: ErrorTypes.PERMISSION,
      message: 'I could not message you. Enable DMs from server members, then try again.',
    });
  }

  await dm.send(formatQuestionPrompt(draft)).catch(() => null);

  await interaction.reply({
    embeds: [successEmbed(
      'Application Started in Your DMs',
      `Open your DMs with me and answer the questions for **${draft.roleName}**. ` +
      'Whatever you send gets forwarded to staff when you finish.',
    )],
    flags: MessageFlags.Ephemeral,
  });
}

export default {
  slashOnly: true,
  data: new SlashCommandBuilder()
    .setName('apply')
    .setDescription('Manage role applications')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('submit')
        .setDescription('Start a private DM application interview')
        .addStringOption((option) =>
          option
            .setName('application')
            .setDescription('The application you want to submit')
            .setRequired(true)
            .setAutocomplete(true),
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
      await InteractionHelper.safeDefer(interaction, {
        flags: isListCommand ? [] : [MessageFlags.Ephemeral],
      });
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
  if (!interaction.customId.startsWith('app_modal_')) return;
  await replyUserError(interaction, {
    type: ErrorTypes.VALIDATION,
    message: 'Applications now use DMs only. Run `/apply submit` again and answer in DMs.',
  });
}

export async function handleApplicationWizardButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('app_wiz_')) return false;
  await replyUserError(interaction, {
    type: ErrorTypes.VALIDATION,
    message: 'Applications now use DMs only. Run `/apply submit` again and answer in DMs.',
  });
  return true;
}

export async function handleApplicationDmMessage(message, client) {
  if (!message || message.author?.bot || message.guild) return false;

  const draft = getActiveApplicationDraftForUser(message.author.id);
  if (!draft) return false;

  const content = String(message.content || '').trim();
  if (!content) {
    await message.channel.send('Send a text answer, or type `cancel` to stop.');
    return true;
  }

  const lowered = content.toLowerCase();
  if (CANCEL_WORDS.has(lowered)) {
    deleteApplicationDraft(draft.draftId);
    await message.channel.send('Application cancelled. Nothing was submitted.');
    return true;
  }

  if (SKIP_WORDS.has(lowered)) {
    await message.channel.send('Skipping is disabled. Send an answer, or type `cancel`.');
    return true;
  }

  if (content.length < MIN_ANSWER_LENGTH) {
    await message.channel.send(`Please send at least ${MIN_ANSWER_LENGTH} characters.`);
    return true;
  }

  if (content.length > MAX_ANSWER_LENGTH) {
    await message.channel.send(`Keep answers under ${MAX_ANSWER_LENGTH} characters.`);
    return true;
  }

  const questionIndex = draft.currentQuestion || 0;
  setDraftAnswer(draft, questionIndex, content);
  draft.currentQuestion = questionIndex + 1;
  saveApplicationDraft(draft);

  if (draft.currentQuestion < draft.questions.length) {
    await message.channel.send(formatQuestionPrompt(draft));
    return true;
  }

  if (!draftAnswersComplete(draft)) {
    deleteApplicationDraft(draft.draftId);
    await message.channel.send('Something went wrong saving your answers. Run `/apply submit` again.');
    return true;
  }

  try {
    await message.channel.send('Got it — submitting your application now…');
    await finalizeApplicationSubmission(client, message.author, draft, async (payload) => {
      await message.channel.send(payload);
    });
  } catch (error) {
    logger.error('Error finalizing DM application:', {
      error: error.message,
      userId: message.author.id,
      guildId: draft.guildId,
      stack: error.stack,
    });
    await message.channel.send(
      error?.userMessage
      || 'Failed to submit your application. Run `/apply submit` again in the server.',
    );
  }
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
      description: 'Applications are completed privately in DMs.',
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
      text: 'Use /apply submit application:<name> — questions are asked in DMs.',
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
    guildName: interaction.guild.name,
    userId: interaction.user.id,
    roleId: applicationRole.roleId,
    roleName: applicationRole.name,
    questions,
  });

  await startDmInterview(interaction, draft);
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
      ? `<t:${Math.floor(submittedAt.getTime() / 1000)}:R>`
      : 'Unknown';
    const { statusLabel, statusEmoji } = getApplicationStatusPresentation(application.status);

    return InteractionHelper.safeEditReply(interaction, {
      embeds: [createEmbed({
        title: `Application ${application.id}`,
        description: [
          `**Status:** ${statusEmoji} ${statusLabel}`,
          `**Role:** ${application.roleName}`,
          `**Submitted:** ${submittedAtDisplay}`,
        ].join('\n'),
      })],
    });
  }

  const applications = await getUserApplications(
    interaction.client,
    interaction.guild.id,
    interaction.user.id,
  );

  if (!applications.length) {
    return await replyUserError(interaction, {
      type: ErrorTypes.USER_INPUT,
      message: 'You have no applications in this server.',
    });
  }

  const embed = createEmbed({
    title: 'Your Applications',
    description: applications.map((app) => {
      const { statusLabel, statusEmoji } = getApplicationStatusPresentation(app.status);
      return `${statusEmoji} \`${app.id}\` — **${app.roleName}** (${statusLabel})`;
    }).join('\n'),
  });

  return InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}
