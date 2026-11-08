// ヒット&ブロー（2人対戦）のゲームロジック。DOM に依存しない純粋なモジュール。

export const COLORS = [
  { id: 0, name: 'あか', hex: '#e5484d', mark: '●' },
  { id: 1, name: 'あお', hex: '#3e7bfa', mark: '▲' },
  { id: 2, name: 'みどり', hex: '#30a46c', mark: '■' },
  { id: 3, name: 'きいろ', hex: '#f5c518', mark: '◆' },
  { id: 4, name: 'むらさき', hex: '#8e4ec6', mark: '★' },
  { id: 5, name: 'オレンジ', hex: '#f76b15', mark: '♥' },
  { id: 6, name: 'みずいろ', hex: '#12a5c4', mark: '✚' },
  { id: 7, name: 'ちゃいろ', hex: '#8d6748', mark: '☾' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  length: 4, // コードの長さ（ピンの数）
  colors: 6, // 使う色の数
  allowDuplicates: false, // 同じ色の重複を許すか
  maxTurns: 10, // 1人あたりの最大回答回数（0 = 無制限）
  fairFinish: true, // 先攻が当てたら後攻にも同じ回数のチャンスを与える
});

/** 秘密のコードに対する推測の判定。hit = 色も位置も一致、blow = 色だけ一致。 */
export function score(secret, guess) {
  if (secret.length !== guess.length) throw new Error('長さが一致しません');
  let hit = 0;
  const restSecret = new Map();
  const restGuess = new Map();
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) {
      hit++;
    } else {
      restSecret.set(secret[i], (restSecret.get(secret[i]) ?? 0) + 1);
      restGuess.set(guess[i], (restGuess.get(guess[i]) ?? 0) + 1);
    }
  }
  let blow = 0;
  for (const [color, n] of restGuess) blow += Math.min(n, restSecret.get(color) ?? 0);
  return { hit, blow };
}

/** コードが設定に合っているかを調べ、問題があればその理由（日本語）を返す。正しければ null。 */
export function validateCode(code, settings) {
  if (!Array.isArray(code) || code.length !== settings.length) {
    return `${settings.length}つすべてのマスに色を入れてください`;
  }
  for (const c of code) {
    if (!Number.isInteger(c) || c < 0 || c >= settings.colors) return '使えない色が含まれています';
  }
  if (!settings.allowDuplicates && new Set(code).size !== code.length) {
    return '同じ色は1回しか使えません';
  }
  return null;
}

export function normalizeSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  s.length = clampInt(s.length, 3, 5);
  s.colors = clampInt(s.colors, 4, COLORS.length);
  s.allowDuplicates = Boolean(s.allowDuplicates);
  s.maxTurns = clampInt(s.maxTurns, 0, 30);
  s.fairFinish = Boolean(s.fairFinish);
  // 重複なしなら、色の数はピンの数以上でなければコードが作れない
  if (!s.allowDuplicates && s.colors < s.length) s.colors = s.length;
  return s;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/**
 * 新しい対戦を作る。
 * names: [プレイヤー1の名前, プレイヤー2の名前]
 * starter: 先攻プレイヤーの番号（0 または 1）
 */
export function createGame(settings, names, starter = 0) {
  return {
    settings: normalizeSettings(settings),
    players: names.map((name) => ({ name, secret: null, guesses: [] })),
    starter,
    current: starter,
    phase: 'secret', // secret → playing → finished
    pendingWinner: null, // 先攻が正解し、後攻が最後のチャンス中のとき先攻の番号
    result: null, // { winner: 0 | 1 | null, reason }
  };
}

/** プレイヤー index の秘密のコードを登録する。両者そろえば対戦開始。 */
export function setSecret(game, index, code) {
  if (game.phase !== 'secret') throw new Error('いまはコードを設定できません');
  const err = validateCode(code, game.settings);
  if (err) throw new Error(err);
  game.players[index].secret = [...code];
  if (game.players.every((p) => p.secret)) game.phase = 'playing';
  return game;
}

/** 現在の手番プレイヤーが相手のコードを推測する。判定結果を返す。 */
export function makeGuess(game, code) {
  if (game.phase !== 'playing') throw new Error('いまは推測できません');
  const err = validateCode(code, game.settings);
  if (err) throw new Error(err);

  const me = game.current;
  const opp = 1 - me;
  const second = 1 - game.starter;
  const res = score(game.players[opp].secret, code);
  const entry = { code: [...code], ...res };
  game.players[me].guesses.push(entry);
  const solved = res.hit === game.settings.length;

  const finish = (winner, reason) => {
    game.phase = 'finished';
    game.result = { winner, reason };
  };

  if (me === game.starter) {
    if (solved && !game.settings.fairFinish) {
      finish(me, 'solved');
    } else {
      if (solved) game.pendingWinner = me; // 後攻に最後のチャンス
      game.current = second;
    }
  } else if (game.pendingWinner !== null) {
    // 後攻の最後のチャンス
    if (solved) finish(null, 'both-solved');
    else finish(game.pendingWinner, 'solved');
  } else if (solved) {
    finish(me, 'solved');
  } else if (game.settings.maxTurns > 0 && game.players[me].guesses.length >= game.settings.maxTurns) {
    finish(null, 'out-of-turns');
  } else {
    game.current = game.starter;
  }
  return { ...entry, solved };
}

/** 現在のラウンド番号（1 始まり）。 */
export function currentRound(game) {
  return game.players[game.current].guesses.length + 1;
}
