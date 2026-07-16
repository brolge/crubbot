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
    : '_No questions yet - add at least one._';

  const embed = new EmbedBuilder()
    .setTitle('Application Questions')
    .setDescription(
      `${list}\n\n` +
      `**${questions.length}/${MAX_APPLICATION_QUESTIONS}** questions` +
      (questions.length > 5
        ? '\nApplicants answer in pages of 5 (Discord modal limit).'
        : ''),
    )
    .setColor(getColor('info'))
    .setFooter({ text: 'Add · Edit · Delete · Move · Done' });

  const canAdd = questions.length < MAX_APPLICATION_QUESTIONS;
  const hasQuestions = questions.length > 0;

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${managerId}_add`)
      .setLabel('Add')
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
      .setLabel('Done')
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
}) {
  let workingQuestions = normalizeQuestions(settings.questions ?? []);

  if (selectedRoleId) {
    const roleSettings = await getApplicationRoleSettings(client, guildId, selectedRoleId);
    workingQuestions = normalizeQuestions(roleSettings.questions ?? workingQuestions);
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

  await selectInteraction.reply(buildManagerPayload(managerId, workingQuestions));

  const managerMessage = await selectInteraction.fetchReply();
  const collector = managerMessage.createMessageComponentCollector({
    filter: (i) =>
      i.user.id === selectInteraction.user.id &&
      i.customId.startsWith(managerId),
    time: 600_000,
  });

  collector.on('collect', async (btnInteraction) => {
    try {
      const action = btnInteraction.customId.slice(managerId.length + 1);

      if (action === 'done') {
        if (workingQuestions.length === 0) {
          await replyUserError(btnInteraction, {
            type: ErrorTypes.USER_INPUT,
            message: 'Add at least one question before finishing.',
          });
          return;
        }

        workingQuestions = await persistQuestions(workingQuestions);
        collector.stop('done');
        await btnInteraction.update({
          embeds: [
            successEmbed(
              'Questions Updated',
              `${workingQuestions.length} question${workingQuestions.length !== 1 ? 's' : ''} saved.` +
              (workingQuestions.length > 5
                ? '\nApplicants will complete them across multiple pages.'
                : ''),
            ),
          ],
          components: [],
        });
        await refreshDashboard(rootInteraction, settings, roles, guildId, client);
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
          .setTitle(`Add Questions (${slots} slot${slots !== 1 ? 's' : ''})`);

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
        await submitted.reply({
          embeds: [successEmbed('Questions Added', `Added ${added.length}. Click **Done** to save.`)],
          flags: MessageFlags.Ephemeral,
        });
        await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions));
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
          await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions)).catch(() => {});
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
          await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions)).catch(() => {});
          return;
        }

        workingQuestions[index] = submitted.fields.getTextInputValue('edit_q').trim();
        workingQuestions = normalizeQuestions(workingQuestions);
        await submitted.reply({
          embeds: [successEmbed('Question Updated', `Q${index + 1} updated. Click **Done** to save.`)],
          flags: MessageFlags.Ephemeral,
        });
        await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions));
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
          await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions)).catch(() => {});
          return;
        }

        const { interaction: pickInteraction, index } = picked;
        const removed = workingQuestions.splice(index, 1)[0];
        workingQuestions = normalizeQuestions(workingQuestions);
        await pickInteraction.update(buildManagerPayload(managerId, workingQuestions));
        await pickInteraction.followUp({
          embeds: [successEmbed('Question Removed', `Removed: ${removed}\nClick **Done** to save.`)],
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
          await selectInteraction.editReply(buildManagerPayload(managerId, workingQuestions)).catch(() => {});
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
