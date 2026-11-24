import type { Difficulty, Player, Question } from './types.ts';
import type { GameState, Phase, TurnResult } from './engine.ts';

/**
 * Every line the host says, in one place. Lines are theme-aware and short so
 * the game keeps moving; the optional "improv" directions let the live Gemini
 * host riff in its own words while the scripted text stays as the fallback.
 */
function money(value: number) {
  return `${value < 0 ? 'minus ' : ''}$${Math.abs(value).toLocaleString()}`;
}

function themeName(theme: string) {
  return theme || 'music';
}

const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export const lines = {
  welcome: () =>
    "Welcome to Name That Tune. I'm your host, and my judgment is real. What's tonight's theme? A genre, a decade, an artist, or say surprise me.",
  welcomeNoMic: () =>
    'Welcome to Name That Tune. The microphone is not connected yet, so use the settings panel or the typed command box. What music theme are we playing tonight?',
  askTheme: () => "What's the theme? Say a genre, a decade, an artist, or surprise me.",
  themeRetry: () => 'Give me a music theme: something like country, the 80s, hip hop, or surprise me.',
  themeLocked: (theme: string) => pick([
    `${themeName(theme)}. Bold choice. I approve, mostly.`,
    `${themeName(theme)} it is. I am already judging your taste.`,
    `Theme locked: ${themeName(theme)}. Somebody in this room is about to be embarrassed.`,
  ]),
  themeChangedMidGame: (theme: string) => `Switching to ${themeName(theme)}. Scores reset. Caching clips.`,
  askPlayerCount: () => 'How many players are joining us? Say one, two, three, or four.',
  playerCountRetry: () => 'One, two, three, or four players. This is not a trick question. Yet.',
  playerCountOutOfRange: (count: number) => count > 4
    ? `${count} players? I only have four buzzers and one nervous system. Pick one to four.`
    : 'I need at least one player, ideally one with a pulse. How many are playing?',
  playerCountSet: (count: number) => count === 1 ? 'Solo run. Brave, or lonely. We will find out.' : `${count} players. Excellent, more people to disappoint.`,
  askName: (playerNumber: number, first: boolean) => first
    ? 'Player one, say your name or nickname. Make it memorable.'
    : `Player ${playerNumber}, introduce yourself.`,
  nameRetry: () => 'That sounded like a name trying to escape. Say it again, please.',
  nameAccepted: (name: string) => `Got it, ${name}.`,
  stillNeedName: (playerNumber: number) => `Not so fast. Player ${playerNumber} still needs a name.`,
  readyToStart: () => "Everyone is in. Say start when you're ready.",
  roundsSet: (rounds: number) => `${rounds} ${rounds === 1 ? 'question' : 'questions'} per player.`,
  difficultySet: (difficulty: Difficulty) => difficulty === 'hard' ? 'Hard mode. Your funeral.' : difficulty === 'easy' ? 'Easy mode. Training wheels engaged.' : 'Medium difficulty. Sensible.',
  turnSecondsSet: (seconds: number) => `${seconds} seconds on the clock per answer.`,
  clipSecondsSet: (seconds: number) => `Song clips will run ${seconds} seconds.`,
  musicToggled: (enabled: boolean) => (enabled ? 'Music is back.' : 'Music off. Just my voice now. Lucky you.'),
  sfxToggled: (enabled: boolean) => (enabled ? 'Sound effects on.' : 'Sound effects off.'),
  cannotChangeMidGame: (what: string) => `I can't change ${what} mid-game. Say new theme to start over.`,
  preparing: (theme: string) => `Caching real ${themeName(theme)} clips. One moment.`,
  packReady: (label: string) => `Questions loaded for ${label}.`,
  packFallback: (requested: string, fallback: string) => `I couldn't build a ${requested} pack right now, so we're playing ${fallback} instead. Deal with it.`,
  packFailed: (requested: string, reason?: string) => `I couldn't build a ${requested} pack${reason ? `: ${reason}` : ''}. Try another theme, or say the 80s or the 90s for a built-in pack.`,
  gameIntro: (theme: string, players: Player[]) => {
    const names = players.map(player => player.name);
    const roster = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${roster}, this is Name That Tune: ${themeName(theme)}. Let's go.`;
  },
  introImprov: (theme: string, players: Player[]) =>
    `Welcome the players (${players.map(player => player.name).join(', ')}) to a ${themeName(theme)} Name That Tune party in one funny sentence, then say exactly: "Let's go."`,
  playAgainIntro: () => 'Rematch.',
  questionIntro: (playerName: string, question: Question, roundNumber: number, roundStart: boolean) => {
    const round = roundStart ? `Round ${roundNumber}. ` : '';
    return `${round}${playerName}, name that tune for ${money(question.basePoints)}.`;
  },
  replayIntro: () => 'Once more.',
  hint: (question: Question) => `Hint: ${question.hostClue}`,
  noMoreHints: () => 'No more hints. Commit.',
  clipSwapped: () => 'That clip skipped. New one.',
  noMoreClips: () => "We're out of fresh clips for this theme, so that's the game. Say new theme for more.",
  cachingMore: () => 'Hold on, fetching fresh clips.',
  clipPositionSet: (position: 'start' | 'hook') => (position === 'hook' ? 'Clips will play the hook.' : 'Clips will play the song openings.'),
  noClipsAvailable: (theme: string) => `I couldn't cache any authentic clips for ${themeName(theme)}. Pick another theme, or say surprise me.`,
  noMoreReplays: () => 'No more replays. The clock is running and so is my patience.',
  confirmPrompt: (playerName: string, heard: string) => {
    void heard;
    return `Final answer, ${playerName}?`;
  },
  confirmAgain: (heard: string) => `Yes or no, ${heard ? `${heard}: ` : ''}final answer?`,
  changeAnswer: (playerName: string) => `No problem, ${playerName}. Think faster this time; the clock is not sentimental.`,
  reveal: (question: Question, result: TurnResult, isLast: boolean) => {
    const answer = question.options[question.correctIndex];
    const outcome = result.outcome === 'timeout'
      ? `Time's up, ${result.playerName}. It was ${answer}.`
      : result.outcome === 'pass'
      ? `Pass. It was ${answer}.`
      : result.outcome === 'correct'
      ? `Correct! ${question.hostCorrectRoast}${result.bonus ? ` Streak bonus, ${money(result.bonus)}.` : ''}`
      : `Nope. It was ${answer}. ${question.hostWrongRoast}`;
    return isLast ? `${outcome} That was the last one.` : outcome;
  },
  scoreboard: (sorted: Player[]) => {
    if (!sorted.length) return 'No scores yet. Nobody has embarrassed themselves. Yet.';
    const parts = sorted.map((player, index) => `${index === 0 ? `${player.name} leads with` : `${player.name} has`} ${money(player.score)}`);
    return `Scoreboard: ${parts.join('; ')}.`;
  },
  gameOver: (sorted: Player[], theme: string) => {
    const winner = sorted[0];
    if (!winner) return 'Game over.';
    if (sorted.length === 1) {
      return winner.score > 0
        ? `That's the game. ${winner.name} finishes with ${money(winner.score)} on ${themeName(theme)}. Say play again for a rematch, or new theme to switch it up.`
        : `That's the game. ${winner.name} finishes at ${money(winner.score)}. The ${themeName(theme)} archives weep. Say play again, or new theme.`;
    }
    const runnerUp = sorted[1];
    return winner.score === runnerUp.score
      ? `It's a tie between ${winner.name} and ${runnerUp.name} at ${money(winner.score)}. Nobody wins, nobody loses, everybody is annoyed. Say play again, or new theme.`
      : `${winner.name} takes the crown with ${money(winner.score)}! ${runnerUp.name} came second, which is the first loser. Say play again for a rematch, or new theme.`;
  },
  gameOverImprov: (sorted: Player[], theme: string) =>
    `Close the show with a short, funny sign-off for the ${themeName(theme)} game. Standings: ${sorted.map(player => `${player.name} ${money(player.score)}`).join(', ')}. End by telling them to say "play again" or "new theme".`,
  help: (phase: Phase, theme: string) => {
    switch (phase) {
      case 'THEME':
        return 'Say a music genre, decade or artist, like hip hop, the 90s, or Queen. You can also say surprise me, or add settings like three players and ten seconds per turn.';
      case 'PLAYER_COUNT':
        return 'Say how many players, one to four. You can also say quick start to use the defaults.';
      case 'PLAYER_NAMES':
        return 'Say your name or nickname. Say quick start if you want generic names.';
      case 'ANSWERING':
        return 'Say the song or the artist. You can also say hint, play it again, pass, or scoreboard.';
      case 'CONFIRMING':
        return 'Say yes to lock in your answer, or no to change it.';
      case 'REVEAL':
        return 'Say next to move on, or scoreboard to hear the standings.';
      case 'GAME_OVER':
        return 'Say play again for a rematch, or new theme to pick something else.';
      default:
        return `You're playing Name That Tune: ${themeName(theme)}. Answers are spoken, then confirmed. Say scoreboard any time.`;
    }
  },
};

/**
 * Lines the host is likely to need soon, so they can be rendered ahead of time.
 * Covers the next two questions for their players plus the static commands.
 */
export function predictHostLines(state: GameState): string[] {
  const out: string[] = [];
  const players = state.players;
  if (!players.length) {
    out.push(lines.askPlayerCount(), lines.askName(1, true));
    return out;
  }
  players.forEach((_, index) => out.push(lines.askName(index + 1, index === 0)));
  const count = Math.max(1, players.length);
  for (let offset = 0; offset < 2; offset++) {
    const index = state.questionIndex + offset;
    const question = state.questions[index];
    if (!question) break;
    const player = players[(state.playerIndex + offset) % count];
    const roundNumber = Math.floor(index / count) + 1;
    out.push(lines.questionIntro(player.name, question, roundNumber, index % count === 0 && index > 0));
    out.push(lines.confirmPrompt(player.name, ''));
    out.push(lines.changeAnswer(player.name));
    out.push(lines.hint(question));
      const isLast = index + 1 >= state.questions.length && state.roundsPlanned >= state.config.rounds;
    const base = { playerId: player.id, playerName: player.name, questionId: question.id, optionIndex: null, transcript: '' };
    out.push(lines.reveal(question, { ...base, outcome: 'correct', delta: question.basePoints, bonus: 0 }, isLast));
    out.push(lines.reveal(question, { ...base, outcome: 'correct', delta: question.basePoints, bonus: Math.round(question.basePoints * 0.5) }, isLast));
    out.push(lines.reveal(question, { ...base, outcome: 'wrong', delta: -question.basePoints, bonus: 0 }, isLast));
    out.push(lines.reveal(question, { ...base, outcome: 'timeout', delta: 0, bonus: 0 }, isLast));
    out.push(lines.reveal(question, { ...base, outcome: 'pass', delta: 0, bonus: 0 }, isLast));
  }
  out.push(lines.noMoreHints(), lines.noMoreReplays(), lines.replayIntro(), lines.cachingMore());
  return Array.from(new Set(out));
}
