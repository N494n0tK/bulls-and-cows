import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  score,
  validateCode,
  normalizeSettings,
  createGame,
  setSecret,
  makeGuess,
  currentRound,
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
  assert.match(validateCode([0, 1, 1, 3], s), /同じ色/);
  assert.match(validateCode([0, 1, 2, 6], s), /使えない色/);
  assert.equal(validateCode([1, 1, 1, 1], { ...s, allowDuplicates: true }), null);
});

test('normalizeSettings: 重複なしなら色数はピン数以上', () => {
  const s = normalizeSettings({ length: 5, colors: 4, allowDuplicates: false });
  assert.equal(s.colors, 5);
});

function newGame(settings) {
  const g = createGame(settings, ['A', 'B'], 0);
  setSecret(g, 0, [0, 1, 2, 3]); // A の秘密（B が当てる）
  setSecret(g, 1, [3, 2, 1, 0]); // B の秘密（A が当てる）
  return g;
}

test('交互に手番が回る', () => {
  const g = newGame();
  assert.equal(g.phase, 'playing');
  assert.equal(g.current, 0);
  makeGuess(g, [0, 1, 2, 3]);
  assert.equal(g.current, 1);
  makeGuess(g, [1, 2, 3, 4]);
  assert.equal(g.current, 0);
  assert.equal(currentRound(g), 2);
});

test('後攻が先に当てたら後攻の勝ち', () => {
  const g = newGame();
  makeGuess(g, [0, 1, 2, 4]);
  const r = makeGuess(g, [0, 1, 2, 3]);
  assert.equal(r.solved, true);
  assert.equal(g.phase, 'finished');
  assert.deepEqual(g.result, { winner: 1, reason: 'solved' });
});

test('先攻が当てても後攻に最後のチャンス（外せば先攻の勝ち）', () => {
  const g = newGame();
  makeGuess(g, [3, 2, 1, 0]);
  assert.equal(g.phase, 'playing');
  assert.equal(g.pendingWinner, 0);
  makeGuess(g, [5, 4, 3, 2]);
  assert.deepEqual(g.result, { winner: 0, reason: 'solved' });
});

test('先攻・後攻が同じラウンドで当てたら引き分け', () => {
  const g = newGame();
  makeGuess(g, [3, 2, 1, 0]);
  makeGuess(g, [0, 1, 2, 3]);
  assert.deepEqual(g.result, { winner: null, reason: 'both-solved' });
});

test('fairFinish なしなら先攻が当てた時点で勝ち', () => {
  const g = newGame({ fairFinish: false });
  makeGuess(g, [3, 2, 1, 0]);
  assert.deepEqual(g.result, { winner: 0, reason: 'solved' });
});

test('回数切れで引き分け', () => {
  const g = newGame({ maxTurns: 2 });
  for (let i = 0; i < 4; i++) makeGuess(g, [4, 5, 0, 1]);
  assert.deepEqual(g.result, { winner: null, reason: 'out-of-turns' });
});

test('後攻スタートでも正しく動く', () => {
  const g = createGame({}, ['A', 'B'], 1);
  setSecret(g, 0, [0, 1, 2, 3]);
  setSecret(g, 1, [3, 2, 1, 0]);
  assert.equal(g.current, 1);
  makeGuess(g, [0, 1, 2, 3]); // B が正解 → A に最後のチャンス
  assert.equal(g.current, 0);
  makeGuess(g, [0, 1, 2, 3]); // A は外す
  assert.deepEqual(g.result, { winner: 1, reason: 'solved' });
});

test('不正な推測は拒否', () => {
  const g = newGame();
  assert.throws(() => makeGuess(g, [0, 0, 1, 2]), /同じ色/);
  assert.equal(g.players[0].guesses.length, 0);
});
