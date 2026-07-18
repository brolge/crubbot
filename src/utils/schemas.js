// schemas.js

import { z } from 'zod';
import { createError, ErrorTypes } from './errorHandler.js';

export const LogIgnoreSchema = z
  .object({
    users: z.array(z.string()).default([]),
    channels: z.array(z.string()).default([])
  })
  .default({ users: [], channels: [] });

export const LoggingChannelsSchema = z
  .object({
    audit: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    member: z.string().nullable().optional(),
    moderation: z.string().nullable().optional(),
    channel: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    voice: z.string().nullable().optional(),
    invite: z.string().nullable().optional(),
    server: z.string().nullable().optional(),
    reaction: z.string().nullable().optional(),
    bot: z.string().nullable().optional(),
    applications: z.string().nullable().optional(),
    reports: z.string().nullable().optional(),
  })
  .passthrough()
  .default({});

export const LoggingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channels: LoggingChannelsSchema.optional(),
    eventChannels: z.record(z.string().nullable()).default({}),
    ignore: LogIgnoreSchema.optional(),
    enabledEvents: z.record(z.boolean()).default({}),
    // legacy flat fields — accepted on parse, stripped on normalize
    channelId: z.string().nullable().optional(),
  })
  .default({ enabled: false, enabledEvents: {} });

const ChannelPermissionStateSchema = z.enum(['allow', 'deny', 'inherit']);
const ChannelPermissionTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  permissions: z.record(ChannelPermissionStateSchema),
});

const TicketLoggingSchema = z
  .object({
    lifecycleChannelId: z.string().nullable().optional(),
    transcriptChannelId: z.string().nullable().optional()
  })
  .optional();

export const TicketTypeSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(100),
  description: z.string().max(100).default(''),
  emoji: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  logChannelId: z.string().nullable().optional(),
  welcomeText: z.string().max(2000).default(''),
  enabled: z.boolean().default(true),
  staffRoleIds: z.array(z.string()).max(25).default([]),
});

const AutoVerifyConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    criteria: z.enum(['account_age', 'server_size', 'none']).default('none'),
    accountAgeDays: z.number().int().min(1).max(365).nullable().optional(),
    roleId: z.string().nullable().optional()
  })
  .optional();

const VerificationConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    channelId: z.string().nullable().optional(),
    messageId: z.string().nullable().optional(),
    roleId: z.string().optional(),
    message: z.string().optional(),
    buttonText: z.string().default('Verify'),
    autoVerify: AutoVerifyConfigSchema
  })
  .optional();

const LockdownConfigSchema = z
  .object({
    antiNukeEnabled: z.boolean().default(false),
    quarantineRoleId: z.string().nullable().default(null),
    alertChannelId: z.string().nullable().default(null),
    trustedUserIds: z.array(z.string()).max(100).default([]),
    trustedRoleIds: z.array(z.string()).max(100).default([]),
    restrictions: z.object({
      messaging: z.boolean().default(true),
      reactions: z.boolean().default(true),
      publicThreads: z.boolean().default(true),
      privateThreads: z.boolean().default(true),
      threadMessages: z.boolean().default(true),
    }).default({}),
    active: z.boolean().default(false),
    snapshot: z.object({
      createdAt: z.string(),
      restrictions: z.record(z.boolean()),
      channels: z.array(z.object({
        channelId: z.string(),
        existed: z.boolean(),
        allow: z.string().regex(/^\d+$/),
        deny: z.string().regex(/^\d+$/),
      })).max(500),
    }).nullable().default(null),
    quarantinedMembers: z.record(z.object({
      roleIds: z.array(z.string()).max(250),
      quarantinedAt: z.string(),
      reason: z.string(),
    })).default({}),
    bulkQuarantine: z.object({
      active: z.boolean().default(false),
      createdAt: z.string().nullable().default(null),
      memberIds: z.array(z.string()).max(10000).default([]),
    }).default({}),
    guards: z.object({
      blockNewBots: z.boolean().default(false),
      lockNewChannels: z.boolean().default(true),
    }).default({}),
  })
  .default({});

export const GuildConfigSchema = z
  .object({
    prefix: z.string().optional(),
    modRole: z.string().nullable().optional(),
    adminRole: z.string().nullable().optional(),
    logChannelId: z.string().nullable().optional(),
    welcomeChannel: z.string().nullable().optional(),
    welcomeMessage: z.string().optional(),
    autoRole: z.string().nullable().optional(),
    dmOnClose: z.boolean().optional(),
    reportChannelId: z.string().nullable().optional(),
    birthdayChannelId: z.string().nullable().optional(),
    premiumRoleId: z.string().nullable().optional(),
    logIgnore: LogIgnoreSchema.optional(),
    disabledCommands: z.record(z.boolean()).optional(),
    disabledCategories: z.record(z.boolean()).optional(),
    permissionTemplates: z.array(ChannelPermissionTemplateSchema).max(25).optional(),
    logging: LoggingConfigSchema.optional(),
    ticketLogging: TicketLoggingSchema.optional(),
    ticketTypes: z.array(TicketTypeSchema).max(25).optional(),
    enableLogging: z.boolean().optional(),
    verification: VerificationConfigSchema,
    lockdown: LockdownConfigSchema,
  })
  .passthrough();

export const EconomyDataSchema = z
  .object({
    wallet: z.number().nonnegative().default(0),
    bank: z.number().nonnegative().default(0),
    bankLevel: z.number().int().nonnegative().default(0),
    dailyStreak: z.number().int().nonnegative().default(0),
    lastDaily: z.number().int().nonnegative().default(0),
    lastWeekly: z.number().int().nonnegative().default(0),
    lastWork: z.number().int().nonnegative().default(0),
    lastCrime: z.number().int().nonnegative().default(0),
    lastRob: z.number().int().nonnegative().default(0),
    lastDeposit: z.number().int().nonnegative().default(0),
    lastWithdraw: z.number().int().nonnegative().default(0),
    xp: z.number().int().nonnegative().default(0),
    level: z.number().int().nonnegative().default(1),
    inventory: z.record(z.any()).default({}),
    cooldowns: z.record(z.number().int().nonnegative()).default({})
  })
  .passthrough();

const DEFAULT_LOGGING = {
  enabled: false,
  channels: { audit: null, applications: null, reports: null },
  ignore: { users: [], channels: [] },
  enabledEvents: {},
};

function migrateLoggingConfig(raw = {}, legacy = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const {
    logChannelId,
    reportChannelId,
    enableLogging,
    logIgnore,
  } = legacy;

  const auditChannel =
    base.channels?.audit ??
    base.channelId ??
    logChannelId ??
    null;

  const applicationsChannel = base.channels?.applications ?? null;

  const reportsChannel =
    base.channels?.reports ??
    reportChannelId ??
    null;

  const ignore = {
    users: base.ignore?.users ?? logIgnore?.users ?? [],
    channels: base.ignore?.channels ?? logIgnore?.channels ?? [],
  };

  let enabled = base.enabled ?? false;
  if (enableLogging === false) {
    enabled = false;
  } else if (auditChannel && base.enabled === undefined && enableLogging !== false) {
    enabled = base.enabled ?? Boolean(enableLogging);
  }

  const { channelId: _legacyChannelId, ignore: _ignore, channels: _channels, ...rest } = base;

  return {
    ...DEFAULT_LOGGING,
    ...rest,
    enabled,
    channels: {
      audit: auditChannel,
      applications: applicationsChannel,
      reports: reportsChannel,
    },
    ignore,
    enabledEvents: base.enabledEvents ?? {},
  };
}

export function stripLegacyLoggingFields(config) {
  if (!config || typeof config !== 'object') {
    return config;
  }

  const {
    logChannelId: _logChannelId,
    enableLogging: _enableLogging,
    reportChannelId: _reportChannelId,
    logIgnore: _logIgnore,
    ...rest
  } = config;

  if (rest.logging && typeof rest.logging === 'object') {
    const { channelId: _channelId, ...loggingRest } = rest.logging;
    rest.logging = loggingRest;
  }

  return rest;
}

export function normalizeGuildConfig(raw, defaults = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const merged = { ...defaults, ...base };

  merged.logging = migrateLoggingConfig(merged.logging, {
    logChannelId: merged.logChannelId,
    reportChannelId: merged.reportChannelId,
    enableLogging: merged.enableLogging,
    logIgnore: merged.logIgnore,
  });

  const parsed = GuildConfigSchema.safeParse(merged);
  const normalized = parsed.success ? parsed.data : { ...defaults, ...merged };

  normalized.logging = migrateLoggingConfig(normalized.logging, {
    logChannelId: normalized.logChannelId,
    reportChannelId: normalized.reportChannelId,
    enableLogging: normalized.enableLogging,
    logIgnore: normalized.logIgnore,
  });

  return stripLegacyLoggingFields(normalized);
}

export function normalizeEconomyData(raw, defaults = {}) {
  const base = typeof raw === 'object' && raw !== null ? raw : {};
  const merged = { ...defaults, ...base };
  const parsed = EconomyDataSchema.safeParse(merged);
  return parsed.success ? parsed.data : { ...defaults, ...base };
}

export function validateGuildConfigOrThrow(rawConfig, context = {}) {
  const normalized = normalizeGuildConfig(rawConfig);
  const parsed = GuildConfigSchema.safeParse(normalized);

  if (parsed.success) {
    return stripLegacyLoggingFields({
      ...normalized,
      logging: migrateLoggingConfig(normalized.logging, {}),
    });
  }

  throw createError(
    'Invalid guild configuration payload',
    ErrorTypes.VALIDATION,
    'Configuration payload is invalid. Please review provided values and try again.',
    {
      ...context,
      errorCode: 'VALIDATION_FAILED',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }))
    }
  );
}
