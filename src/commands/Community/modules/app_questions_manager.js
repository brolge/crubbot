import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { getColor } from '../../../config/bot.js';
import { successEmbed } from '../../../utils/embeds.js';
import { logger } from '../../../utils/logger.js';
import { ErrorTypes, replyUserError } from '../../../utils/errorHandler.js';
import {
  saveApplicationSettings,
  getApplicationRoleSettings,
  saveApplicationRoleSettings,
} from '../../../utils/database.js';
import {
  MAX_APPLICATION_QUESTIONS,
  MAX_QUESTION_PROMPT,
  normalizeQuestions,
} from '../../../utils/applicationQuestions.js';

function buildManagerPayload(managerId, questions) {
  const list = questions.length > 0
    ? questions.map((q, i) => `**${i + 1}.** ${q}`).join('\n')
    : '_No questions yet — add at least one._';

  const embed = new EmbedBuilder()
    .setTitle('Application Questions')
    .setDescription(
      `${list}\n\n` +
      `**${questions.length}/${MAX_APPLICATION_QUESTIONS}** questions` +
      (questions.length > 5
        ? '\nApplicants answer in pages of 5 (Discord modal limit).'
        : '') +
      '\n\nUse **Bulk Add** to paste many questions at once (one per line). Changes save automatically.',
    )
    .setColor(getColor('info'))
    .setFooter({ text: 'Add · Bulk Add · Edit · Delete · Move · Close' });

  const canAdd = questions.length < MAX_APPLICATION_QUESTIONS;
  const hasQuestions = questions.length > 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${managerId}_add`)
      .setLabel('Add')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canAdd),
    new ButtonBuilder()
      .setCustomId(`${managerId}_bulk`)
      .setLabel('Bulk Add')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canAdd),
    new ButtonBuilder()
      .setCustomId(`${managerId}_edit`)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!hasQuestions),
    new ButtonBuilder()
      .setCustomId(`${managerId}_delete`)
      .setLabel('Delete')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!hasQuestions),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${managerId}_up`)
      .setLabel('Move Up')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(questions.length < 2),
    new ButtonBuilder()
      .setCustomId(`${managerId}_down`)
      .setLabel('Move Down')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(questions.length < 2),
    new ButtonBuilder()
      .setCustomId(`${managerId}_done`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row1, row2], flags: MessageFlags.Ephemeral };
}

async function pickQuestionIndex({
  btnInteraction,
  selectInteraction,
  managerId,
  workingQuestions,
  promptLabel,
}) {
  const options = workingQuestions.slice(0, 25).map((q, i) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`Q${i + 1}`)
      .setDescription(q.length > 100 ? `${q.slice(0, 97)}...` : q)
      .setValue(String(i)),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${managerId}_pick`)
    .setPlaceholder(promptLabel)
    .addOptions(options);

  await btnInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('Select a question')
        .setDescription(promptLabel)
        .setColor(getColor('info')),
    ],
    components: [new ActionRowBuilder().addComponents(select)],
  });

  const picked = await btnInteraction.message.awaitMessageComponent({
    filter: (i) =>
      i.user.id === selectInteraction.user.id &&
      i.customId === `${managerId}_pick`,
    time: 120_000,
    componentType: ComponentType.StringSelect,
  }).catch(() => null);

  if (!picked) return null;
  return { interaction: picked, index: Number(picked.values[0]) };
}

export async function handleApplicationQuestionsManager({
  selectInteraction,
  rootInteraction,
  settings,
  roles,
  guildId,
  client,
  selectedRoleId,
  refreshDashboard,
  replyMode = 'reply',
}) {
  let workingQuestions = normalizeQuestions(settings.questions ?? []);

  if (selectedRoleId) {
    const roleSettings = await getApplicationRoleSettings(client, guildId, selectedRoleId);
    workingQuestions = normalizeQuestions(
      Array.isArray(roleSettings.questions) && roleSettings.questions.length > 0
        ? roleSettings.questions
        : workingQuestions,
    );
  }

  const scopeKey = selectedRoleId || 'global';
  const managerId = `app_qmgr_${guildId}_${scopeKey}`;

  const persistQuestions = async (questions) => {
    const normalized = normalizeQuestions(questions);
    if (selectedRoleId) {
      const roleSettings = await getApplicationRoleSettings(client, guildId, selectedRoleId);
      roleSettings.questions = normalized;
      await saveApplicationRoleSettings(client, guildId, selectedRoleId, roleSettings);
    } else {
      settings.questions = normalized;
      await saveApplicationSettings(client, guildId, settings);
    }
    return normalized;
  };

  let managerMessage;
  if (replyMode === 'followUp') {
    managerMessage = await selectInteraction.followUp(buildManagerPayload(managerId, workingQuestions));
  } else if (replyMode === 'edit') {
    await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions));
    managerMessage = await selectInteraction.fetchReply();
  } else {
    await selectInteraction.reply(buildManagerPayload(managerId, workingQuestions));
    managerMessage = await selectInteraction.fetchReply();
  }

  const refreshManager = async () => {
    const payload = buildManagerPayload(managerId, workingQuestions);
    if (managerMessage?.edit) {
      await managerMessage.edit(payload).catch(async () => {
        await selectInteraction.editReply(payload).catch(() => {});
      });
    } else {
      await selectInteraction.editReply(payload).catch(() => {});
    }
  };

  const collector = selectInteraction.channel.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === selectInteraction.user.id &&
      i.customId.startsWith(managerId) &&
      !i.customId.endsWith('_pick'),
    time: 600_000,
  });

  collector.on('collect', async (btnInteraction) => {
    try {
      const action = btnInteraction.customId.slice(managerId.length + 1);

      if (action === 'done') {
        workingQuestions = await persistQuestions(workingQuestions);
        collector.stop('done');
        await btnInteraction.update({
          embeds: [
            successEmbed(
              'Questions Saved',
              `${workingQuestions.length} question${workingQuestions.length !== 1 ? 's' : ''} saved.` +
              (workingQuestions.length > 5
                ? '\nApplicants will complete them across multiple pages.'
                : ''),
            ),
          ],
          components: [],
        });
        if (typeof refreshDashboard === 'function') {
          await refreshDashboard(rootInteraction, settings, roles, guildId, client);
        }
        return;
      }

      if (action === 'bulk') {
        const remaining = MAX_APPLICATION_QUESTIONS - workingQuestions.length;
        if (remaining <= 0) {
          await replyUserError(btnInteraction, {
            type: ErrorTypes.VALIDATION,
            message: `Maximum of ${MAX_APPLICATION_QUESTIONS} questions reached.`,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`${managerId}_bulk_modal`)
          .setTitle('Bulk Add Questions')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('bulk_q')
                .setLabel(`One question per line (max ${remaining} more)`)
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(Math.min(4000, remaining * (MAX_QUESTION_PROMPT + 1)))
                .setPlaceholder('Why do you want this role?\nWhat experience do you have?\nHow many hours can you dedicate?'),
            ),
          );

        await btnInteraction.showModal(modal);
        const submitted = await btnInteraction.awaitModalSubmit({
          filter: (i) =>
            i.customId === `${managerId}_bulk_modal` &&
            i.user.id === selectInteraction.user.id,
          time: 180_000,
        }).catch(() => null);

        if (!submitted) return;

        const lines = submitted.fields.getTextInputValue('bulk_q')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        if (lines.length === 0) {
          await replyUserError(submitted, {
            type: ErrorTypes.USER_INPUT,
            message: 'Paste at least one question (one per line).',
          });
          return;
        }

        const before = workingQuestions.length;
        workingQuestions = normalizeQuestions([...workingQuestions, ...lines]);
        workingQuestions = await persistQuestions(workingQuestions);
        const added = workingQuestions.length - before;

        await submitted.reply({
          embeds: [successEmbed(
            'Questions Added',
            `Saved **${added}** new question${added !== 1 ? 's' : ''}. Total: **${workingQuestions.length}/${MAX_APPLICATION_QUESTIONS}**.`,
          )],
          flags: MessageFlags.Ephemeral,
        });
        await refreshManager();
        return;
      }

      if (action === 'add') {
        const remaining = MAX_APPLICATION_QUESTIONS - workingQuestions.length;
        if (remaining <= 0) {
          await replyUserError(btnInteraction, {
            type: ErrorTypes.VALIDATION,
            message: `Maximum of ${MAX_APPLICATION_QUESTIONS} questions reached.`,
          });
          return;
        }

        const slots = Math.min(5, remaining);
        const modal = new ModalBuilder()
          .setCustomId(`${managerId}_add_modal`)
          .setTitle(`Add Questions (${slots} slots)`);

        for (let i = 0; i < slots; i += 1) {
          modal.addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId(`addq${i}`)
                .setLabel(`New question ${i + 1}${i === 0 ? '' : ' (optional)'}`)
                .setStyle(TextInputStyle.Short)
                .setMaxLength(MAX_QUESTION_PROMPT)
                .setRequired(i === 0),
            ),
          );
        }

        await btnInteraction.showModal(modal);
        const submitted = await btnInteraction.awaitModalSubmit({
          filter: (i) =>
            i.customId === `${managerId}_add_modal` &&
            i.user.id === selectInteraction.user.id,
          time: 120_000,
        }).catch(() => null);

        if (!submitted) return;

        const added = [];
        for (let i = 0; i < slots; i += 1) {
          const value = submitted.fields.getTextInputValue(`addq${i}`).trim();
          if (value) added.push(value);
        }

        if (added.length === 0) {
          await replyUserError(submitted, {
            type: ErrorTypes.USER_INPUT,
            message: 'Enter at least one question.',
          });
          return;
        }

        workingQuestions = normalizeQuestions([...workingQuestions, ...added]);
        workingQuestions = await persistQuestions(workingQuestions);
        await submitted.reply({
          embeds: [successEmbed(
            'Questions Added',
            `Saved **${added.length}**. Total: **${workingQuestions.length}/${MAX_APPLICATION_QUESTIONS}**.\nTip: use **Bulk Add** to paste many at once.`,
          )],
          flags: MessageFlags.Ephemeral,
        });
        await refreshManager();
        return;
      }

      if (action === 'edit') {
        const picked = await pickQuestionIndex({
          btnInteraction,
          selectInteraction,
          managerId,
          workingQuestions,
          promptLabel: 'Choose a question to edit',
        });
        if (!picked) {
          await refreshManager();
          return;
        }

        const { interaction: pickInteraction, index } = picked;
        const modal = new ModalBuilder()
          .setCustomId(`${managerId}_edit_modal`)
          .setTitle(`Edit Question ${index + 1}`)
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('edit_q')
                .setLabel('Question text')
                .setStyle(TextInputStyle.Short)
                .setValue(workingQuestions[index] ?? '')
                .setMaxLength(MAX_QUESTION_PROMPT)
                .setRequired(true),
            ),
          );

        await pickInteraction.showModal(modal);
        const submitted = await pickInteraction.awaitModalSubmit({
          filter: (i) =>
            i.customId === `${managerId}_edit_modal` &&
            i.user.id === selectInteraction.user.id,
          time: 120_000,
        }).catch(() => null);

        if (!submitted) {
          await refreshManager();
          return;
        }

        workingQuestions[index] = submitted.fields.getTextInputValue('edit_q').trim();
        workingQuestions = await persistQuestions(workingQuestions);
        await submitted.reply({
          embeds: [successEmbed('Question Updated', `Q${index + 1} saved.`)],
          flags: MessageFlags.Ephemeral,
        });
        await refreshManager();
        return;
      }

      if (action === 'delete') {
        const picked = await pickQuestionIndex({
          btnInteraction,
          selectInteraction,
          managerId,
          workingQuestions,
          promptLabel: 'Choose a question to delete',
        });
        if (!picked) {
          await refreshManager();
          return;
        }

        const { interaction: pickInteraction, index } = picked;
        const removed = workingQuestions.splice(index, 1)[0];
        workingQuestions = await persistQuestions(workingQuestions);
        await pickInteraction.update(buildManagerPayload(managerId, workingQuestions));
        await pickInteraction.followUp({
          embeds: [successEmbed('Question Removed', `Removed: ${removed}`)],
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
        return;
      }

      if (action === 'up' || action === 'down') {
        const picked = await pickQuestionIndex({
          btnInteraction,
          selectInteraction,
          managerId,
          workingQuestions,
          promptLabel: action === 'up'
            ? 'Choose a question to move up'
            : 'Choose a question to move down',
        });
        if (!picked) {
          await refreshManager();
          return;
        }

        const { interaction: pickInteraction, index } = picked;
        const swapWith = action === 'up' ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= workingQuestions.length) {
          await pickInteraction.update(buildManagerPayload(managerId, workingQuestions));
          await replyUserError(pickInteraction, {
            type: ErrorTypes.VALIDATION,
            message: action === 'up'
              ? 'That question is already first.'
              : 'That question is already last.',
          });
          return;
        }

        const tmp = workingQuestions[index];
        workingQuestions[index] = workingQuestions[swapWith];
        workingQuestions[swapWith] = tmp;
        workingQuestions = await persistQuestions(workingQuestions);
        await pickInteraction.update(buildManagerPayload(managerId, workingQuestions));
      }
    } catch (error) {
      if (error.code === 10062 || error.code === 'InteractionAlreadyReplied') return;
      logger.error('Error in application questions manager:', error);
      await replyUserError(btnInteraction, {
        type: ErrorTypes.UNKNOWN,
        message: 'Something went wrong while editing questions.',
      }).catch(() => {});
    }
  });
}

export function formatQuestionsForDashboard(questions, { inheritsGlobal = false } = {}) {
  const normalized = normalizeQuestions(questions);
  if (normalized.length === 0) {
    return inheritsGlobal ? '`Inherits global questions`' : '`No questions configured`';
  }

  const preview = normalized.slice(0, 8).map((q, i) => {
    const text = q.length > 60 ? `${q.substring(0, 60)}...` : q;
    return `${i + 1}. \`${text}\``;
  });

  if (normalized.length > 8) {
    preview.push(`...and **${normalized.length - 8}** more (max ${MAX_APPLICATION_QUESTIONS})`);
  } else {
    preview.push(`_Total: **${normalized.length}/${MAX_APPLICATION_QUESTIONS}**_`);
  }

  return preview.join('\n');
}
