import { getLevelingConfig } from './leveling.js';
import { logger } from '../utils/logger.js';

const ANNOUNCEMENT_TTL_MS = 60 * 60 * 1000;
const USER_COOLDOWN_MS = 45 * 1000;
const CHANNEL_COOLDOWN_MS = 8 * 1000;

const recentAnnouncements = new Map();
const userCooldowns = new Map();
const channelCooldowns = new Map();

const INSULT_WORDS = [
  'moron', 'idiot', 'stupid', 'dumb', 'dumbass', 'dummy', 'fool',
  'trash', 'garbage', 'useless', 'worthless', 'pathetic', 'lame',
  'annoying', 'cringe', 'cringy', 'suck', 'sucks', 'stfu', 'gtfo',
  'shut', 'quiet', 'fuck', 'fucking', 'fucker', 'motherfucker',
  'shit', 'shitty', 'asshole', 'ass', 'bastard', 'bitch', 'whore',
  'retard', 'retarded', 'r3tard', 'kys', 'die', 'kill', 'hate',
  'loser', 'noob', 'clown', 'npc', 'botched', 'broke', 'buggy',
  'mid', 'dogshit', 'bullshit', 'horseshit', 'crap', 'piss',
  'nerd', 'bozo', 'scrub', 'rat', 'skank', 'twat', 'wanker',
  'prick', 'dick', 'dickhead', 'cock', 'cunt',
];

const PHRASE_PATTERNS = [
  /\bshut\s*up\b/i,
  /\bstfu\b/i,
  /\bgtfo\b/i,
  /\bf+u+c+k+(?:\s*(?:off|you|u|this|that|the\s*bot))?\b/i,
  /\b(?:kill|kys)\s*(?:your\s*self|yourself|urself)?\b/i,
  /\b(?:nobody|who)\s+asked\b/i,
  /\bstop\s+(?:talking|spamming|posting|announcing)\b/i,
  /\bi\s+hate\s+(?:this|the|you|u)?\s*(?:bot)?\b/i,
  /\b(?:bot|you|u)\s*(?:is|are|'s|s)?\s*(?:a\s+)?(?:piece\s+of\s+)?(?:shit|trash|garbage|useless)\b/i,
  /\b(?:piece\s+of\s+shit|pos)\b/i,
  /\bgo\s+(?:away|die|to\s+hell)\b/i,
];

function normalizeInsultText(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@#]/g, ' ')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/!/g, 'i')
    .replace(/(.)\1{2,}/g, '$1$1')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenMatchesInsult(token) {
  if (!token) return false;
  if (INSULT_WORDS.includes(token)) return true;
  const collapsed = token.replace(/(.)\1+/g, '$1');
  if (INSULT_WORDS.includes(collapsed)) return true;
  // Elongated insults: "idiotdddd", "stfuuu"
  return INSULT_WORDS.some((word) => {
    if (token === word || collapsed === word) return true;
    if (token.startsWith(word) && token.length <= word.length + 6) return true;
    if (collapsed.startsWith(word) && collapsed.length <= word.length + 2) return true;
    return false;
  });
}

function containsInsult(content) {
  const original = String(content || '');
  if (!original.trim()) return false;
  if (PHRASE_PATTERNS.some((pattern) => pattern.test(original))) return true;

  const normalized = normalizeInsultText(original);
  if (!normalized) return false;
  if (PHRASE_PATTERNS.some((pattern) => pattern.test(normalized))) return true;

  return normalized.split(' ').some((token) => tokenMatchesInsult(token));
}

export const LEVEL_CLAPBACKS = [
  'Damn, one level-up message and you are already fighting for your life.',
  'Relax, it was one notification—not a fucking autobiography.',
  'You replied to a bot announcement just to say that. Incredible use of electricity.',
  'That comeback had less XP than a brand-new account.',
  'Shouting at automation is wild, but I respect the commitment to losing.',
  'I announce levels; you announce bad decisions. We all have jobs.',
  'The bot is doing its job. Your manners are still buffering.',
  'That was a lot of attitude for such a low-effort sentence.',
  'You could have scrolled past, but apparently peace was never an option.',
  'Congratulations, you just lost an argument with a level-up notification.',
  'I would take that personally, but your message barely passed quality control.',
  'Keep talking—I need examples for the “what not to type” tutorial.',
  'The notification lasted one second; your tantrum has downloadable content.',
  'You brought main-character rage to a background-process problem.',
  'That insult was weak as hell. Try earning more vocabulary XP.',
  'Imagine beefing with code and still coming second.',
  'I cannot shut up; the server literally pays me in permissions.',
  'Your complaint has been filed directly into the imaginary bin.',
  'Bold words from someone voluntarily replying to the message.',
  'You clicked Reply and then blamed me for the conversation. Genius.',
  'The level went up. Somehow the quality of chat went down.',
  'Please hold while I pretend that bullshit was constructive feedback.',
  'I have seen error messages with better delivery.',
  'That sentence needed a cooldown more than the leveling system does.',
  'You are trying to roast a bot with room-temperature material.',
  'Damn, even my rate limiter has more patience than that.',
  'Your feedback was received, ignored, and used as comic relief.',
  'If scrolling is too difficult, I can announce that achievement too.',
  'The bot spoke once and you started a whole damn rivalry.',
  'You seem upset. Have you tried gaining a level about it?',
  'That reply had confidence, chaos, and absolutely no useful content.',
  'I am automated; what is your excuse for repeating yourself?',
  'You can mute the channel. Fighting the message is the harder, dumber route.',
  'This is a level-up channel, not your personal complaint department.',
  'A simple scroll would have saved you this embarrassing side quest.',
  'You told code to shut up and expected to look powerful. Fascinating.',
  'My message was configured. Your outburst was apparently freestyle.',
  'That was not a roast; it was a typing accident with attitude.',
  'I have zero feelings and somehow you still failed to hurt them.',
  'Take a breath. The pixels are not plotting against you.',
  'Your beef is with a JavaScript event handler. Good luck with that.',
  'I will stop announcing levels when people stop leveling—so probably never.',
  'The server asked me to post this. Argue with the settings, not the messenger.',
  'You are heckling a notification like it stole your lunch money.',
  'That reply was loud, unnecessary, and impressively unoriginal.',
  'My code has branches; your argument barely has a point.',
  'If annoyance gave XP, you would finally be carrying the leaderboard.',
  'The only thing getting shut down here is that weak-ass comeback.',
  'Try again after your vocabulary cooldown expires.',
  'Anyway, congratulations to the person who actually leveled up.',
  'Calling me a moron while arguing with a level-up ping is elite comedy.',
  'Creative spelling, same energy: still losing to a notification.',
  'That slur collection was unique. Your critical thinking was not.',
];

export { containsInsult, normalizeInsultText };

function purgeExpired(now = Date.now()) {
  for (const [messageId, record] of recentAnnouncements) {
    if (record.expiresAt <= now) recentAnnouncements.delete(messageId);
  }
  for (const [key, expiresAt] of userCooldowns) {
    if (expiresAt <= now) userCooldowns.delete(key);
  }
  for (const [key, expiresAt] of channelCooldowns) {
    if (expiresAt <= now) channelCooldowns.delete(key);
  }
}

export function registerLevelUpAnnouncement(message) {
  if (!message?.id || !message.guildId || !message.channelId) return;
  purgeExpired();
  recentAnnouncements.set(message.id, {
    guildId: message.guildId,
    channelId: message.channelId,
    expiresAt: Date.now() + ANNOUNCEMENT_TTL_MS,
  });
}

export function isRudeLevelReply(message) {
  const referencedId = message?.reference?.messageId;
  if (!referencedId || !message.guildId || !message.channelId) return false;
  purgeExpired();
  const announcement = recentAnnouncements.get(referencedId);
  if (
    !announcement
    || announcement.guildId !== message.guildId
    || announcement.channelId !== message.channelId
  ) {
    return false;
  }
  return containsInsult(message.content);
}

export async function handleLevelClapback(message, client) {
  if (!isRudeLevelReply(message)) return false;

  const config = await getLevelingConfig(client, message.guildId);
  if (config.clapbacksEnabled === false) return false;

  // Prefer the registered announcement channel so system-channel fallbacks still work.
  const referencedId = message.reference?.messageId;
  const announcement = referencedId ? recentAnnouncements.get(referencedId) : null;
  const expectedChannelId = announcement?.channelId || config.levelUpChannel;
  if (!expectedChannelId || message.channelId !== expectedChannelId) {
    return false;
  }

  const now = Date.now();
  purgeExpired(now);
  const userKey = `${message.guildId}:${message.author.id}`;
  if (
    (userCooldowns.get(userKey) || 0) > now
    || (channelCooldowns.get(message.channelId) || 0) > now
  ) {
    return false;
  }
  userCooldowns.set(userKey, now + USER_COOLDOWN_MS);
  channelCooldowns.set(message.channelId, now + CHANNEL_COOLDOWN_MS);

  const clapback = LEVEL_CLAPBACKS[Math.floor(Math.random() * LEVEL_CLAPBACKS.length)];
  await message.reply({
    content: clapback,
    allowedMentions: { repliedUser: false },
  }).catch((error) => {
    logger.debug('Failed to send level-up clapback:', error.message);
  });
  return true;
}
