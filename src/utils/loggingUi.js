// loggingUi.js

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { EVENT_TYPES } from '../services/loggingService.js';
import {
  LOG_DESTINATIONS,
  LOG_DESTINATION_LABELS,
  LOG_DESTINATION_DESCRIPTIONS,
} from './logDestinations.js';

const EVENT_TYPES_BY_CATEGORY = Object.values(EVENT_TYPES).reduce((accumulator, eventType) => {
  const [category] = eventType.split('.');
  if (!accumulator[category]) {
    accumulator[category] = [];
  }
  accumulator[category].push(eventType);
  return accumulator;
}, {});

export { EVENT_TYPES_BY_CATEGORY };

export const DASHBOARD_CATEGORIES = [
  'moderation',
  'message',
  'member',
  'role',
  'channel',
  'voice',
  'invite',
  'server',
  'reaction',
  'reactionrole',
  'leveling',
  'giveaway',
  'counter',
  'security',
  'application',
  'report',
];

const DASHBOARD_CATEGORY_EMOJIS = {
  moderation: '🔨',
  message: '✉️',
  member: '👥',
  role: '🏷️',
  channel: '📁',
  voice: '🔊',
  invite: '🔗',
  server: '🖥️',
  reaction: '😮',
  reactionrole: '🎭',
  leveling: '📈',
  giveaway: '🎁',
  counter: '📊',
  security: '☢️',
  application: '📝',
  report: '🚨',
};

export const DASHBOARD_CATEGORY_LABELS = {
  moderation: 'Moderation',
  message: 'Messages',
  member: 'Members',
  role: 'Roles',
  channel: 'Channels',
  voice: 'Voice',
  invite: 'Invites',
  server: 'Server',
  reaction: 'Reactions',
  reactionrole: 'Reaction Roles',
  leveling: 'Leveling',
  giveaway: 'Giveaways',
  counter: 'Counters',
  security: 'Security / Anti-Nuke',
  application: 'Applications',
  report: 'Reports',
};

function createBackButton() {
  return new ButtonBuilder()
    .setCustomId('log_dash_back')
    .setLabel('Back to Dashboard')
    .setStyle(ButtonStyle.Secondary);
}

function createCategoryToggleButtons(enabledEvents = {}, loggingEnabled = false) {
  const buttons = DASHBOARD_CATEGORIES.map((category) => {
    const wildcardDisabled = enabledEvents[`${category}.*`] === false;
    const categoryEvents = EVENT_TYPES_BY_CATEGORY[category] || [];
    const allEnabled = categoryEvents.length === 0
      ? true
      : categoryEvents.every((t) => enabledEvents[t] !== false);
    const isEnabled = loggingEnabled && !wildcardDisabled && allEnabled;
    const emoji = DASHBOARD_CATEGORY_EMOJIS[category] || '📌';
    const label = DASHBOARD_CATEGORY_LABELS[category] || category;

    return new ButtonBuilder()
      .setCustomId(`log_dash_toggle:${category}.*`)
      .setLabel(`${emoji} ${label}`)
      .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger);
  });

  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

export function createLoggingMainMenuSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('log_dash_menu')
      .setPlaceholder('Choose a setting to configure…')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Route Log Channels')
          .setDescription('Map message/member/moderation/etc. to channels')
          .setValue('view:routes')
          .setEmoji('📡'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Event Categories')
          .setDescription('Toggle which log types are sent')
          .setValue('view:categories')
          .setEmoji('📋'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Manage Ignore Filters')
          .setDescription('Skip logs from specific users or channels')
          .setValue('view:filters')
          .setEmoji('🔇'),
      ),
  );
}

export function createLoggingRoutesMenuSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('log_dash_routes')
      .setPlaceholder('Choose a log destination to set or clear…')
      .addOptions(
        ...LOG_DESTINATIONS.slice(0, 25).map((destination) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(LOG_DESTINATION_LABELS[destination] || destination)
            .setDescription((LOG_DESTINATION_DESCRIPTIONS[destination] || destination).slice(0, 100))
            .setValue(`set:${destination}`),
        ),
      ),
  );
}

export function createLoggingRoutesClearSelect() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('log_dash_routes_clear')
      .setPlaceholder('Clear a configured destination…')
      .addOptions(
        ...LOG_DESTINATIONS.slice(0, 25).map((destination) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`Clear ${LOG_DESTINATION_LABELS[destination] || destination}`)
            .setValue(`clear:${destination}`)
            .setEmoji('🗑️'),
        ),
      ),
  );
}

export function createLoggingMainActionRow(loggingEnabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('log_dash_toggle:audit_enabled')
      .setLabel('Audit Logging')
      .setStyle(loggingEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('log_dash_refresh')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Primary),
  );
}

export function createLoggingDashboardComponents(_enabledEvents, loggingEnabled = false) {
  return [
    createLoggingMainMenuSelect(),
    createLoggingMainActionRow(loggingEnabled),
  ];
}

export function createLoggingRoutesViewComponents() {
  return [
    createLoggingRoutesMenuSelect(),
    createLoggingRoutesClearSelect(),
    new ActionRowBuilder().addComponents(
      createBackButton(),
      new ButtonBuilder()
        .setCustomId('log_dash_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

export function createLoggingCategoryViewComponents(enabledEvents, loggingEnabled = false) {
  const categoryRows = createCategoryToggleButtons(enabledEvents, loggingEnabled);

  const actionRow = new ActionRowBuilder().addComponents(
    createBackButton(),
    new ButtonBuilder()
      .setCustomId('log_dash_toggle:all')
      .setLabel('Toggle All Categories')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('log_dash_refresh')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Primary),
  );

  return [...categoryRows, actionRow];
}

export function createLoggingFilterComponents() {
  return [
    new ActionRowBuilder().addComponents(
      createBackButton(),
      new ButtonBuilder()
        .setCustomId('log_dash_add_filter:user')
        .setLabel('Add User Filter')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('log_dash_add_filter:channel')
        .setLabel('Add Channel Filter')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('log_dash_remove_filter')
        .setLabel('Remove Filter')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('log_dash_refresh')
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}
