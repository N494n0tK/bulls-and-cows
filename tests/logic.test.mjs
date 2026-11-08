import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  score,
  validateCode,
  normalizeSettings,
  randomCode,
  countCodes,
  createGame,
  makeGuess,
  callsBy,
  countCandidates,
  passTurn,
  spendTime,
} from '../js/logic.js';

test('score: ヒットとブローを数える', () => {
  assert.deepEqual(score([0, 1, 2, 3], [0, 1, 2, 3]), { hit: 4, blow: 0 });
  assert.deepEqual(score([0, 1, 2, 3], [3, 2, 1, 0]), { hit: 0, blow: 4 });
  assert.deepEqual(score([0, 1, 2, 3], [0, 2, 4, 5]), { hit: 1, blow: 1 });
  assert.deepEqual(score([0, 1, 2, 3], [4, 5, 4, 5]), { hit: 0, blow: 0 });
});

test('score: 重複ありでも数えすぎない', () => {
  assert.deepEqual(score([0, 0, 1, 1], [0, 1, 0, 0]), { hit: 1, blow: 2 });
  assert.deepEqual(score([0, 1, 2, 3], [0, 0, 0, 0]), { hit: 1, blow: 0 });
  assert.deepEqual(score([2, 2, 2, 1], [1, 2, 3, 3]), { hit: 1, blow: 1 });
});

test('validateCode', () => {
  const s = normalizeSettings({ length: 4, colors: 6, allowDuplicates: false });
  assert.equal(validateCode([0, 1, 2, 3], s), null);
  assert.match(validateCode([0, 1, 2], s), /4つ/);
  assert.match(validateCode([0, 1, null, 3], s), /4つ/);
  assert.match(validateCode([0, 1, 1, 3], s), /同じもの/);
  assert.match(validateCode([0, 1, 2, 6], s), /使えない/);
  assert.equal(validateCode([1, 1, 1, 1], { ...s, allowDuplicates: true }), null);
});

test('normalizeSettings: 見た目は数字が標準', () => {
  assert.equal(normalizeSettings({}).symbols, 'number');
  assert.equal(normalizeSettings({ symbols: 'color' }).symbols, 'color');
  assert.equal(normalizeSettings({ symbols: 'xxx' }).symbols, 'number');
});

test('normalizeSettings: 重複なしなら色数はピン数以上', () => {
  assert.equal(normalizeSettings({ length: 5, colors: 4, allowDuplicates: false }).colors, 5);
});

test('randomCode: 設定どおりのお題ができる', () => {
  for (const dup of [false, true]) {
    const s = normalizeSettings({ length: 5, colors: 7, allowDuplicates: dup });
    for (let i = 0; i < 200; i++) assert.equal(validateCode(randomCode(s), s), null);
  }
  const s = normalizeSettings({ length: 4, colors: 6 });
  assert.deepEqual(randomCode(s, () => 0), [0, 1, 2, 3]);
});

test('countCodes', () => {
  assert.equal(countCodes(normalizeSettings({ length: 4, colors: 6 })), 360);
  assert.equal(countCodes(normalizeSettings({ length: 4, colors: 6, allowDuplicates: true })), 1296);
});

const SECRET = [0, 1, 2, 3];

test('お題は1つ。2人が交互にコールし、履歴は共通', () => {
  const g = createGame({}, ['A', 'B'], 0, SECRET);
  assert.equal(g.phase, 'playing');
  assert.equal(g.current, 0);
  const r = makeGuess(g, [3, 2, 1, 0]);
  assert.deepEqual([r.hit, r.blow, r.solved], [0, 4, false]);
  assert.equal(g.current, 1);
  makeGuess(g, [0, 1, 4, 5]);
  assert.equal(g.current, 0);
  assert.deepEqual(g.guesses.map((x) => [x.player, x.hit, x.blow]), [[0, 0, 4], [1, 2, 0]]);
  assert.equal(callsBy(g, 0), 1);
  assert.equal(callsBy(g, 1), 1);
});

test('先に当てた人がその場で勝ち（後攻）', () => {
  const g = createGame({}, ['A', 'B'], 0, SECRET);
  makeGuess(g, [0, 1, 3, 2]); // A は 2H2B で惜しい…
  const r = makeGuess(g, [0, 1, 2, 3]); // それを見た B が正解
  assert.equal(r.solved, true);
  assert.deepEqual(g.result, { winner: 1, reason: 'solved' });
  assert.throws(() => makeGuess(g, [0, 1, 2, 3]), /コールできません/);
});

test('先に当てた人がその場で勝ち（先攻）', () => {
  const g = createGame({}, ['A', 'B'], 1, SECRET);
  assert.equal(g.current, 1);
  makeGuess(g, [5, 4, 3, 2]);
  makeGuess(g, [0, 1, 2, 3]);
  assert.deepEqual(g.result, { winner: 0, reason: 'solved' });
});

test('2人ともコール回数を使い切ったら引き分け', () => {
  const g = createGame({ maxTurns: 2 }, ['A', 'B'], 0, SECRET);
  for (let i = 0; i < 3; i++) makeGuess(g, [4, 5, 0, 1]);
  assert.equal(g.phase, 'playing');
  makeGuess(g, [4, 5, 0, 1]);
  assert.deepEqual(g.result, { winner: null, reason: 'out-of-turns' });
});

test('不正なコールは拒否して手番も進まない', () => {
  const g = createGame({}, ['A', 'B'], 0, SECRET);
  assert.throws(() => makeGuess(g, [0, 0, 1, 2]), /同じもの/);
  assert.equal(g.guesses.length, 0);
  assert.equal(g.current, 0);
});

test('countCandidates: ヒントが増えるほど候補が減り、お題は必ず残る', () => {
  const g = createGame({}, ['A', 'B'], 0, SECRET);
  assert.equal(countCandidates(g), 360);
  let prev = 360;
  for (const code of [[3, 2, 1, 0], [0, 1, 4, 5], [0, 2, 1, 3]]) {
    makeGuess(g, code);
    const n = countCandidates(g);
    assert.ok(n >= 1 && n <= prev);
    prev = n;
  }
  // 1手目 0H4B → 候補は {0,1,2,3} の完全順列 9 通り
  const g2 = createGame({}, ['A', 'B'], 0, SECRET);
  makeGuess(g2, [3, 2, 1, 0]);
  assert.equal(countCandidates(g2), 9);
});

test('countCandidates: 重複ありでも数えられる', () => {
  const g = createGame({ allowDuplicates: true }, ['A', 'B'], 0, [0, 0, 1, 1]);
  assert.equal(countCandidates(g), 1296);
  makeGuess(g, [0, 0, 1, 1]);
  assert.equal(g.phase, 'finished');
});

test('持ち時間：手番の人だけ減り、使い切ったら負け', () => {
  const g = createGame({ timeBank: 60 }, ['A', 'B'], 0, SECRET);
  assert.deepEqual(g.clocks, [60000, 60000]);
  assert.equal(spendTime(g, 20000), false);
  assert.deepEqual(g.clocks, [40000, 60000]);
  makeGuess(g, [4, 5, 0, 1]);
  spendTime(g, 59000);
  assert.deepEqual(g.clocks, [40000, 1000]);
  makeGuess(g, [4, 5, 0, 1]);
  assert.equal(spendTime(g, 45000), true);
  assert.equal(g.clocks[0], 0);
  assert.deepEqual(g.result, { winner: 1, reason: 'time-up' });
});

test('持ち時間なしなら時間は減らない', () => {
  const g = createGame({ timeBank: 0 }, ['A', 'B'], 0, SECRET);
  assert.equal(spendTime(g, 1e9), false);
  assert.equal(g.phase, 'playing');
});

test('パス：手番が移り、コール1回分を使う。候補数には影響しない', () => {
  const g = createGame({ maxTurns: 1 }, ['A', 'B'], 0, SECRET);
  passTurn(g);
  assert.equal(g.current, 1);
  assert.equal(callsBy(g, 0), 1);
  assert.equal(countCandidates(g), 360);
  passTurn(g);
  assert.deepEqual(g.result, { winner: null, reason: 'out-of-turns' });
});
