import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_TICKET_TYPES,
  buildTicketPanelComponents,
  findTicketType,
  getEnabledTicketTypes,
  getTicketStaffRoleIds,
  normalizeTicketType,
} from '../src/utils/ticketTypes.js';
import { GuildConfigSchema } from '../src/utils/schemas.js';

test('typed ticket panel renders only enabled dropdown options', () => {
  const components = buildTicketPanelComponents({
    ticketTypes: [
      { id: 'billing', label: 'Billing', description: 'Payment help', emoji: '💳', enabled: true },
      { id: 'hidden', label: 'Hidden', enabled: false },
    ],
  });

  const json = components[0].toJSON();
  assert.equal(json.components[0].custom_id, 'create_ticket_type');
  assert.deepEqual(json.components[0].options.map(option => option.value), ['billing']);
  assert.equal(json.components[0].options[0].description, 'Payment help');
});

test('legacy panels remain available when no enabled types exist', () => {
  assert.equal(buildTicketPanelComponents({}), null);
  assert.equal(buildTicketPanelComponents({
    ticketTypes: [{ id: 'off', label: 'Off', enabled: false }],
  }), null);
});

test('ticket type normalization supports multiple unique staff roles', () => {
  const type = normalizeTicketType({
    id: ' tech ',
    label: ' Technical ',
    enabled: 'false',
    staffRoleIds: 'role-1, role-2 role-1',
  });

  assert.equal(type.id, 'tech');
  assert.equal(type.enabled, false);
  assert.deepEqual(type.staffRoleIds, ['role-1', 'role-2']);
});

test('permission role list combines snapshots, current types, and legacy fallback', () => {
  const roles = getTicketStaffRoleIds({
    ticketStaffRoleId: 'legacy',
    ticketTypes: [{ id: 'a', label: 'A', staffRoleIds: ['current'], enabled: true }],
  }, {
    typeSnapshot: { staffRoleIds: ['snapshot'] },
  });

  assert.deepEqual(roles.sort(), ['current', 'legacy', 'snapshot']);
});

test('findTicketType and enabled filtering reject malformed entries', () => {
  const config = {
    ticketTypes: [
      { id: '', label: 'Bad', enabled: true },
      { id: 'ok', label: 'Okay', enabled: true },
      { id: 'off', label: 'Off', enabled: false },
    ],
  };
  assert.equal(findTicketType(config, 'ok').label, 'Okay');
  assert.deepEqual(getEnabledTicketTypes(config).map(type => type.id), ['ok']);
});

test('guild config schema enforces the Discord 25-option limit', () => {
  const ticketTypes = Array.from({ length: MAX_TICKET_TYPES + 1 }, (_, index) => ({
    id: `type-${index}`,
    label: `Type ${index}`,
    description: '',
    welcomeText: '',
    enabled: true,
    staffRoleIds: [],
  }));
  assert.equal(GuildConfigSchema.safeParse({ ticketTypes }).success, false);
});
