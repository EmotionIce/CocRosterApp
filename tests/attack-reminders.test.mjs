import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import test from 'node:test';

const CLAN = '#2LUCULP', OPP = '#9PYLQG', PLAYER = '#P0LYGQ';
const NOW = '2026-10-05T10:00:00.000Z';
function load() {
  const context = vm.createContext({ Date, Buffer, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'DISCORD_BOT_API_SECRET' ? 'test-bot-secret' : null }) },
    Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF-8' },
      computeDigest: (_, text) => Array.from(crypto.createHash('sha256').update(text).digest()),
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url') } });
  vm.runInContext(['config', 'cocApi', 'rosterDomain', 'warDomain', 'firebaseStore', 'seasonEvents', 'authAndLocks', 'warFollowup', 'adminApi']
    .map(name => fs.readFileSync(new URL('../script/' + name + '.js', import.meta.url), 'utf8')).join('\n'), context);
  return context;
}
function war(state = 'inWar', count = 1) {
  return { state, teamSize: 1, attacksPerMember: 2, _warObservedAt: NOW,
    preparationStartTime: '20261003T120000.000Z', startTime: '20261004T120000.000Z', endTime: '20261005T120000.000Z',
    clan: { tag: CLAN, name: 'Turtle', attacks: count, members: [{ tag: PLAYER, name: 'Player', townhallLevel: 17,
      ...(count ? { attacks: Array.from({ length: count }, (_, i) => ({ order: i + 1, attackerTag: PLAYER, defenderTag: '#P9LYGQ', stars: 3 })) } : {}) }] },
    opponent: { tag: OPP, name: 'Rival', attacks: 0, members: [{ tag: '#P9LYGQ', name: 'Rival', townhallLevel: 17 }] } };
}

test('current-war snapshots count one CWL attack and the API regular-war allowance', () => {
  const backend = load();
  const regular = backend.buildAttackReminderWarSnapshot_(war('inWar', 2), CLAN, 'regular');
  assert.equal(regular.byTag[PLAYER].attacksRemaining, 0);
  assert.equal(regular.observedAt, NOW);
  const cwl = backend.buildAttackReminderWarSnapshot_(war(), CLAN, 'cwl', '#YYQUP');
  assert.equal(cwl.byTag[PLAYER].attacksRemaining, 0);
  assert.equal(cwl.attacksAllowed, 1);
  assert.equal(backend.buildAttackReminderWarSnapshot_(war('inWar', 0), CLAN, 'cwl', '#YYQUP').byTag[PLAYER].attacksRemaining, 1);
});

test('malformed, partial and inconsistent API observations never become reminder evidence', () => {
  const backend = load();
  for (const corrupt of [
    value => { value.clan.members = []; },
    value => { value.opponent.members = []; },
    value => { value.clan.members[0].attacks = null; },
    value => { value.clan.attacks = 0; },
    value => { delete value.teamSize; },
    value => { delete value._warObservedAt; },
    value => { value.clan.members[0].attacks[0].stars = '3'; },
    value => { value.clan.members[0].attacks[0].attackerTag = '#P9LYGQ'; },
  ]) {
    const value = war(); corrupt(value);
    assert.equal(backend.buildAttackReminderWarSnapshot_(value, CLAN, 'regular'), null);
  }
});

test('CWL runtime keeps today completed independently of tomorrow preparation, even in reverse discovery order', () => {
  const backend = load();
  const runtime = backend.createEmptyCwlRuntime_('2026-10-cwl', NOW);
  const tomorrow = war('preparation', 0);
  tomorrow.startTime = '20261005T120000.000Z'; tomorrow.endTime = '20261006T120000.000Z';
  for (const [index, tag, value] of [[0, '#YYQUP', tomorrow], [1, '#YYQUQ', war()]]) {
    const contribution = backend.buildCwlRuntimeContributionFromWar_(value, tag, CLAN, 'group', index);
    backend.updateCwlRuntimeWarRecordFromContribution_(runtime, contribution, 'group', NOW);
  }
  const view = backend.buildCwlRuntimeViews_(runtime, [CLAN])[CLAN];
  assert.equal(view.currentWar.warTag, '#YYQUQ');
  assert.equal(view.reminderWar.warId, '#YYQUQ');
  assert.equal(view.reminderWar.byTag[PLAYER].attacksRemaining, 0);
  assert.equal(view.aggregateByTag[PLAYER].currentWarAttackPending, 1, 'season aggregation cannot influence reminders');
  const sanitized = backend.sanitizeRosterCwlStats_({ currentWar: view.currentWar, reminderWar: view.reminderWar, byTag: {} }, {});
  assert.equal(sanitized.reminderWar.byTag[PLAYER].attacksRemaining, 0, 'full war lineup survives roster-local retention filtering');
});

test('authenticated verification reads one exact live war without cached fallback or state writes', () => {
  const backend = load();
  let calls = 0;
  backend.cocFetch_ = path => { calls++; assert.equal(path, '/clans/%232LUCULP/currentwar'); return war('inWar', 2); };
  const warId = backend.getStableRegularWarKey_(war(), CLAN);
  const response = backend.runAdminApiMethod_('verifyAttackReminderWar', [{ mode: 'regular', clanTag: CLAN, warId }, 'test-bot-secret']);
  assert.equal(response.snapshot.byTag[PLAYER].attacksRemaining, 0);
  assert.equal(calls, 1);
  assert.equal(backend.verifyAttackReminderWar({ mode: 'regular', clanTag: CLAN, warId: CLAN + '|' + OPP + '|other' }, 'test-bot-secret').reason, 'war-identifier-mismatch');
  assert.throws(() => backend.verifyAttackReminderWar({ mode: 'regular', clanTag: CLAN, warId }, 'wrong'), /Authentication/);
  assert.throws(() => backend.verifyAttackReminderWar({ mode: 'cwl', clanTag: CLAN, warId: '../bad' }, 'test-bot-secret'), /Invalid/);
  backend.cocFetch_ = () => { throw new Error('API unavailable'); };
  assert.throws(() => backend.verifyAttackReminderWar({ mode: 'regular', clanTag: CLAN, warId }, 'test-bot-secret'), /API unavailable/);
});

test('a fresh CWL fetch advances reminder observation time even when attack totals are unchanged', () => {
  const backend = load();
  const runtime = backend.createEmptyCwlRuntime_('2026-10-cwl', NOW);
  for (const observedAt of [NOW, '2026-10-05T11:00:00.000Z']) {
    const value = war('inWar', 0); value._warObservedAt = observedAt;
    const contribution = backend.buildCwlRuntimeContributionFromWar_(value, '#YYQUP', CLAN, 'group', 0);
    backend.updateCwlRuntimeWarRecordFromContribution_(runtime, contribution, 'group', observedAt);
    assert.equal(backend.buildCwlRuntimeViews_(runtime, [CLAN])[CLAN].reminderWar.observedAt, observedAt);
  }
});
