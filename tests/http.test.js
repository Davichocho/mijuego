// Ejecutar contra el servidor: node --test tests/http.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const base = process.env.CAMPO_TEST_URL || 'http://127.0.0.1:5080/';
async function api(path, body, session) {
  const response = await fetch(new URL('api/' + path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(session ? { Authorization: 'Bearer ' + session.token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json(), headers: response.headers };
}
test('API completa: sala de ocho jugadores, permisos, datos ocultos, ganador, revancha y archivos privados', async () => {
  assert.equal((await api('health')).data.service, 'Campo');
  const created = await api('rooms', { name: 'Host HTTP', mode: 'ffa', maxPlayers: 8, durationSeconds: 0 });
  assert.equal(created.status, 200);
  const host = created.data, code = host.code, players = [host];
  try {
    assert.equal(created.headers.get('cache-control'), 'no-store');
    for (let i = 1; i < 8; i++) {
      const joined = await api(`rooms/${code}/join`, { name: `Amigo ${i}` });
      assert.equal(joined.status, 200); players.push(joined.data);
    }
    assert.equal((await api(`rooms/${code}/join`, { name: 'Sin lugar' })).status, 409);
    assert.equal((await api(`rooms/${code}`)).status, 401);
    assert.equal((await api(`rooms/${code}/start`, { round: 0 }, players[1])).status, 403);
    const started = await api(`rooms/${code}/start`, { round: 0 }, host);
    assert.equal(started.status, 200); assert.equal(started.data.players.length, 8);
    assert.equal(started.data.cells.length, 0); assert.ok(started.data.cells.every(c => !c.mine));
    assert.equal(started.data.endsAt, null);
    assert.ok(started.data.players.every(p => !('token' in p)));
    let view = started.data;
    for (let i = 0; i < 8; i++) {
      const current = players[i];
      const start = view.players.find(p => p.id === current.room.youId).startIndex;
      const moved = await api(`rooms/${code}/reveal`, { index: start, round: view.round }, current);
      assert.equal(moved.status, 200); view = moved.data;
      assert.ok(view.players.every(p => p.score === 0));
      assert.ok(view.cells.every(c => !c.mine));
    }
    assert.ok(view.players.every(p => p.hasOpened));
    assert.equal((await api(`rooms/${code}/reveal`, { index: -1, round: 1 }, host)).status, 400);
    for (const player of players.slice(1)) assert.equal((await api(`rooms/${code}/leave`, {}, player)).status, 200);
    const ended = (await api(`rooms/${code}`, undefined, host)).data;
    assert.equal(ended.status, 'finished'); assert.deepEqual(ended.winnerIds, [host.room.youId]);
    const rematch = await api(`rooms/${code}/rematch`, { round: 1 }, host);
    assert.equal(rematch.status, 200); assert.equal(rematch.data.players.length, 1);
    assert.equal(rematch.data.status, 'lobby');
    assert.equal((await api(`rooms/${code}/start`, { round: 1 }, host)).status, 409);
    for (const path of ['server/Rooms.cs', 'Campo.dll', 'web.config', 'tests/Program.cs']) {
      assert.equal((await fetch(new URL(path, base))).status, 404, path + ' must not be publicly served');
    }
    const html = await (await fetch(base)).text();
    assert.ok(html.includes('online.js')); assert.ok(html.includes('Salas en línea'));
  } finally { await api(`rooms/${code}/leave`, {}, host); }
});
