import axios from 'axios';
import {
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_ROLES = 20;
const MAX_CATEGORIES = 10;
const MAX_CHANNELS_PER_CATEGORY = 12;

const TEMPLATE_PRESETS = {
  pmc: 'Private military company / milsim structure with command, operations, recruitment, logistics, mission planning, intel, unit SOPs, and voice comms.',
  milsim: 'Military simulation community with battalion-style comms, staff areas, squad voice channels, training, deployments, and after-action reports.',
  community: 'General community layout with welcome, rules, support, media, voice, moderation, and staff backoffice.',
  gaming: 'Gaming server with LFG, clips, roles, match coordination, team voice, and event channels.',
};

function cleanJsonPayload(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI returned an empty blueprint response.');
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || raw).trim();
}

function coerceChannelType(type) {
  switch (String(type || '').toLowerCase()) {
    case 'voice':
      return 'voice';
    case 'announcement':
    case 'news':
      return 'announcement';
    case 'forum':
      return 'forum';
    default:
      return 'text';
  }
}

function normalizeBlueprint(input, fallbackName = 'AI Server Blueprint') {
  const value = input && typeof input === 'object' ? input : {};
  return {
    name: String(value.name || fallbackName).slice(0, 100),
    summary: String(value.summary || 'Server blueprint generated for this community.').slice(0, 800),
    roles: Array.isArray(value.roles)
      ? value.roles.slice(0, MAX_ROLES).map((role) => ({
          name: String(role?.name || 'role').slice(0, 100),
          color: role?.color ? String(role.color) : null,
          hoist: Boolean(role?.hoist),
          mentionable: Boolean(role?.mentionable),
          permissions: Array.isArray(role?.permissions)
            ? role.permissions.map((permission) => String(permission)).filter(Boolean).slice(0, 30)
            : [],
        }))
      : [],
    categories: Array.isArray(value.categories)
      ? value.categories.slice(0, MAX_CATEGORIES).map((category) => ({
          name: String(category?.name || 'Category').slice(0, 100),
          channels: Array.isArray(category?.channels)
            ? category.channels.slice(0, MAX_CHANNELS_PER_CATEGORY).map((channel) => ({
                name: String(channel?.name || 'channel').slice(0, 100),
                type: coerceChannelType(channel?.type),
                topic: channel?.topic ? String(channel.topic).slice(0, 1024) : null,
              }))
            : [],
        }))
      : [],
    notes: Array.isArray(value.notes)
      ? value.notes.map((note) => String(note)).filter(Boolean).slice(0, 10)
      : [],
    source: value.source ? String(value.source) : 'template',
  };
}

function keywordTemplate(prompt, template) {
  const lower = `${template} ${prompt}`.toLowerCase();
  if (lower.includes('pmc') || lower.includes('milsim')) {
    return normalizeBlueprint({
      name: 'PMC Milsim Blueprint',
      summary: 'Structured milsim / PMC server with command, operations, recruitment, intel, logistics, and voice stack.',
      roles: [
        { name: 'Command', color: '#e74c3c', hoist: true, permissions: ['ManageGuild', 'ManageChannels'] },
        { name: 'Operations', color: '#f39c12', hoist: true, permissions: [] },
        { name: 'Recruitment', color: '#3498db', hoist: true, permissions: [] },
        { name: 'Medical', color: '#2ecc71', hoist: false, permissions: [] },
        { name: 'Logistics', color: '#9b59b6', hoist: false, permissions: [] },
        { name: 'Member', color: '#95a5a6', hoist: false, permissions: [] },
      ],
      categories: [
        {
          name: 'ENTRY',
          channels: [
            { name: 'welcome', type: 'text', topic: 'Landing area and key links' },
            { name: 'rules-and-sop', type: 'text', topic: 'Core standards and SOP' },
            { name: 'announcements', type: 'announcement', topic: 'Official updates' },
          ],
        },
        {
          name: 'RECRUITMENT',
          channels: [
            { name: 'apply-here', type: 'text', topic: 'Applications and onboarding' },
            { name: 'recruitment-chat', type: 'text', topic: 'Questions from prospects' },
            { name: 'screening-room', type: 'voice', topic: null },
          ],
        },
        {
          name: 'OPERATIONS',
          channels: [
            { name: 'op-orders', type: 'text', topic: 'Mission briefings and OPORDs' },
            { name: 'intel-drops', type: 'text', topic: 'Intel and target packages' },
            { name: 'after-action-reports', type: 'text', topic: 'Debriefs and lessons learned' },
            { name: 'command-net', type: 'voice', topic: null },
            { name: 'squad-1', type: 'voice', topic: null },
            { name: 'squad-2', type: 'voice', topic: null },
          ],
        },
        {
          name: 'SUPPORT',
          channels: [
            { name: 'logistics', type: 'text', topic: 'Supply, kit, and movement' },
            { name: 'medical', type: 'text', topic: 'Medical SOP and casualty flow' },
            { name: 'general-comms', type: 'voice', topic: null },
          ],
        },
        {
          name: 'STAFF',
          channels: [
            { name: 'staff-hq', type: 'text', topic: 'Internal staff planning' },
            { name: 'mod-log', type: 'text', topic: 'Moderation review' },
            { name: 'staff-briefing', type: 'voice', topic: null },
          ],
        },
      ],
      notes: [
        'Pair with verification, tickets, welcomer, and logging dashboards after creation.',
        'Keep announcements read-only except for command/admin roles.',
      ],
      source: 'template',
    });
  }

  return normalizeBlueprint({
    name: 'Community Blueprint',
    summary: 'Balanced community server layout with welcome, support, media, voice, and staff categories.',
    roles: [
      { name: 'Admin', color: '#e74c3c', hoist: true, permissions: ['Administrator'] },
      { name: 'Moderator', color: '#f39c12', hoist: true, permissions: ['ManageMessages', 'KickMembers', 'BanMembers'] },
      { name: 'Member', color: '#3498db', hoist: false, permissions: [] },
    ],
    categories: [
      {
        name: 'START HERE',
        channels: [
          { name: 'welcome', type: 'text', topic: 'First stop for new members' },
          { name: 'rules', type: 'text', topic: 'Server rules and expectations' },
          { name: 'announcements', type: 'announcement', topic: 'Official updates only' },
        ],
      },
      {
        name: 'COMMUNITY',
        channels: [
          { name: 'general', type: 'text', topic: 'Main chat' },
          { name: 'media', type: 'text', topic: 'Clips, screenshots, photos' },
          { name: 'general-vc', type: 'voice', topic: null },
        ],
      },
      {
        name: 'SUPPORT',
        channels: [
          { name: 'help', type: 'text', topic: 'Help and support questions' },
          { name: 'suggestions', type: 'forum', topic: 'Member suggestions and feedback' },
        ],
      },
      {
        name: 'STAFF',
        channels: [
          { name: 'staff-chat', type: 'text', topic: 'Internal staff coordination' },
          { name: 'staff-vc', type: 'voice', topic: null },
        ],
      },
    ],
    notes: [
      'Run your welcome/logging/verification dashboards after applying.',
    ],
    source: 'template',
  });
}

async function fetchAttachmentBase64(attachment) {
  if (!attachment?.url || !attachment?.contentType?.startsWith('image/')) return null;
  const response = await axios.get(attachment.url, { responseType: 'arraybuffer', timeout: 15_000 });
  return {
    mimeType: attachment.contentType,
    data: Buffer.from(response.data).toString('base64'),
  };
}

export async function generateServerBlueprint({ prompt, template = 'community', attachment = null }) {
  const trimmedPrompt = String(prompt || '').trim();
  if (!trimmedPrompt) {
    throw new Error('A prompt is required to generate a server blueprint.');
  }

  const preset = TEMPLATE_PRESETS[template] || TEMPLATE_PRESETS.community;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    return keywordTemplate(trimmedPrompt, preset);
  }

  const image = await fetchAttachmentBase64(attachment).catch(() => null);
  const instructions = [
    'You are designing a Discord server blueprint.',
    'Return only valid JSON.',
    'Shape:',
    '{"name":"...","summary":"...","roles":[{"name":"...","color":"#hex","hoist":true,"mentionable":false,"permissions":["ManageGuild"]}],"categories":[{"name":"...","channels":[{"name":"...","type":"text|voice|announcement|forum","topic":"optional"}]}],"notes":["..."],"source":"ai"}',
    `Template intent: ${preset}`,
    `User request: ${trimmedPrompt}`,
  ].join('\n');

  const contents = [{
    parts: [
      { text: instructions },
      ...(image ? [{
        inline_data: {
          mime_type: image.mimeType,
          data: image.data,
        },
      }] : []),
    ],
  }];

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      contents,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    },
    { timeout: 30_000 },
  );

  const text = response.data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('\n');
  const parsed = JSON.parse(cleanJsonPayload(text));
  return normalizeBlueprint({ ...parsed, source: 'ai' });
}

function resolvePermissionBits(permissionNames = []) {
  return permissionNames.reduce((bits, name) => {
    const key = String(name || '').trim();
    return PermissionFlagsBits[key] ? bits | PermissionFlagsBits[key] : bits;
  }, 0n);
}

function resolveDiscordChannelType(type) {
  switch (type) {
    case 'voice':
      return ChannelType.GuildVoice;
    case 'announcement':
      return ChannelType.GuildAnnouncement;
    case 'forum':
      return ChannelType.GuildForum;
    default:
      return ChannelType.GuildText;
  }
}

export async function applyBlueprintToGuild(guild, blueprint, reason = 'Owner AI blueprint apply') {
  const normalized = normalizeBlueprint(blueprint);
  const createdRoles = [];
  const createdCategories = [];
  const createdChannels = [];

  for (const role of normalized.roles) {
    const permissions = resolvePermissionBits(role.permissions);
    const created = await guild.roles.create({
      name: role.name,
      color: role.color || undefined,
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions,
      reason,
    });
    createdRoles.push(created);
  }

  for (const category of normalized.categories) {
    const createdCategory = await guild.channels.create({
      name: category.name,
      type: ChannelType.GuildCategory,
      reason,
    });
    createdCategories.push(createdCategory);

    for (const channel of category.channels) {
      const createdChannel = await guild.channels.create({
        name: channel.name,
        type: resolveDiscordChannelType(channel.type),
        topic: channel.topic || undefined,
        parent: createdCategory.id,
        reason,
      });
      createdChannels.push(createdChannel);
    }
  }

  return {
    blueprint: normalized,
    createdRoles,
    createdCategories,
    createdChannels,
  };
}
