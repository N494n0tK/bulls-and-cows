// ヒット&ブロー（2人対戦・共通のお題）のゲームロジック。DOM に依存しない純粋なモジュール。
//
// ルール：コンピューターがランダムに決めた1つのお題を、2人が交互にコールして当てに行く。
// すべてのコールとヒントは2人ともに見えるので、自分のコールは相手へのヒントにもなる。
// 先にお題をすべてヒットさせた人の勝ち。

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
  length: 4, // お題の長さ（ピンの数）
  colors: 6, // 使う色の数
  allowDuplicates: false, // 同じ色の重複を許すか
  maxTurns: 8, // 1人あたりのコール回数（0 = 無制限）。2人とも使い切ったら引き分け
  showCandidates: true, // 残りの候補数を表示する（どれだけ答えに近づいたかの目安）
});

/** お題に対するコールの判定。hit = 色も位置も一致、blow = 色だけ一致。 */
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
  if (!Array.isArray(code) || code.length !== settings.length || code.some((c) => c == null)) {
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
  s.showCandidates = Boolean(s.showCandidates);
  // 重複なしなら、色の数はピンの数以上でなければお題が作れない
  if (!s.allowDuplicates && s.colors < s.length) s.colors = s.length;
  return s;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** 設定に合うお題をランダムに作る。rng は 0 以上 1 未満を返す関数（テスト用に差し替え可）。 */
export function randomCode(settings, rng = Math.random) {
  const pool = [...Array(settings.colors).keys()];
  const code = [];
  for (let i = 0; i < settings.length; i++) {
    const k = Math.floor(rng() * pool.length);
    code.push(settings.allowDuplicates ? pool[k] : pool.splice(k, 1)[0]);
  }
  return code;
}

/** 設定に合うコードが全部で何通りあるか。 */
export function countCodes(settings) {
  let total = 1;
  for (let i = 0; i < settings.length; i++) total *= settings.allowDuplicates ? settings.colors : settings.colors - i;
  return total;
}

/**
 * 新しい対戦を作る。
 * names: [プレイヤー1の名前, プレイヤー2の名前]
 * starter: 先攻プレイヤーの番号（0 または 1）
 * secret: お題（省略するとランダム）
 */
export function createGame(settings, names, starter = 0, secret = null) {
  const s = normalizeSettings(settings);
  const code = secret ?? randomCode(s);
  const err = validateCode(code, s);
  if (err) throw new Error(err);
  return {
    settings: s,
    names: [...names],
    secret: [...code],
    guesses: [], // { player, code, hit, blow }（2人ぶんを時系列で）
    starter,
    current: starter,
    phase: 'playing', // playing → finished
    result: null, // { winner: 0 | 1 | null, reason: 'solved' | 'out-of-turns' }
  };
}

/** 現在の手番プレイヤーがコールする。判定結果を返す。 */
export function makeGuess(game, code) {
  if (game.phase !== 'playing') throw new Error('いまはコールできません');
  const err = validateCode(code, game.settings);
  if (err) throw new Error(err);

  const me = game.current;
  const res = score(game.secret, code);
  const entry = { player: me, code: [...code], ...res };
  game.guesses.push(entry);
  const solved = res.hit === game.settings.length;

  if (solved) {
    game.phase = 'finished';
    game.result = { winner: me, reason: 'solved' };
  } else if (game.settings.maxTurns > 0 && game.guesses.length >= game.settings.maxTurns * 2) {
    game.phase = 'finished';
    game.result = { winner: null, reason: 'out-of-turns' };
  } else {
    game.current = 1 - me;
  }
  return { ...entry, solved };
}

/** プレイヤー index がこれまでにコールした回数。 */
export function callsBy(game, index) {
  return game.guesses.filter((g) => g.player === index).length;
}

/** これまでのヒントすべてと矛盾しないコード（お題の候補）の数。 */
export function countCandidates(game) {
  const s = game.settings;
  let n = 0;
  const code = Array(s.length);
  const used = new Set();
  const walk = (i) => {
    if (i === s.length) {
      if (game.guesses.every((g) => {
        const r = score(code, g.code);
        return r.hit === g.hit && r.blow === g.blow;
      })) n++;
      return;
    }
    for (let c = 0; c < s.colors; c++) {
      if (!s.allowDuplicates && used.has(c)) continue;
      code[i] = c;
      used.add(c);
      walk(i + 1);
      used.delete(c);
    }
  };
  walk(0);
  return n;
}
