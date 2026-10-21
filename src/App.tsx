import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Player, Question } from './game/types.ts';
import { TRIVIA_QUESTIONS } from './game/triviaData.ts';
import { matchVoiceToOption, matchVoiceToPlayerCount } from './game/rules.ts';
import { host } from './audio/speechHost.ts';
import { media } from './audio/mediaEngine.ts';
import { liveVoice } from './speech/liveVoice.ts';
import { MarqueeHeader } from './components/MarqueeHeader.tsx';
import { TriviaQuestionView } from './components/TriviaQuestionView.tsx';
import { AnswerRevealView } from './components/AnswerRevealView.tsx';
import { GameOverView } from './components/GameOverView.tsx';
import { LiveVoiceConsole } from './components/LiveVoiceConsole.tsx';
import { PlayerSetupView } from './components/PlayerSetupView.tsx';

type FlowState = 'PLAYER_COUNT' | 'PLAYER_NAMES' | 'QUESTION_ACTIVE' | 'ANSWER_CONFIRM' | 'ANSWER_REVEAL' | 'GAME_OVER';
type PlayerColor = Pick<Player, 'color' | 'borderHex' | 'bgHex' | 'avatar'>;

const TURN_SECONDS = 20;
const CONFIRM_SECONDS = 6;
const PLAYER_COLORS: PlayerColor[] = [
  { color: 'emerald', borderHex: '#10b981', bgHex: '#064e3b', avatar: '🎸' },
  { color: 'pink', borderHex: '#ec4899', bgHex: '#831843', avatar: '🕶️' },
  { color: 'cyan', borderHex: '#06b6d4', bgHex: '#0e7490', avatar: '🕹️' },
  { color: 'yellow', borderHex: '#eab308', bgHex: '#a16207', avatar: '📼' },
];

function createPlayers(count: number): Player[] {
  return PLAYER_COLORS.slice(0, count).map((style, index) => ({
    id: `p${index + 1}`,
    name: '',
    score: 0,
    ...style,
    correctCount: 0,
  }));
}

function spokenName(transcript: string) {
  return transcript
    .replace(/^\s*(my name is|i am|i'm|this is)\s+/i, '')
    .replace(/[.!?,]+$/g, '')
    .trim()
    .slice(0, 24);
}

export default function App() {
  const [gameState, setGameState] = useState<FlowState>('PLAYER_COUNT');
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [pendingAnswerIndex, setPendingAnswerIndex] = useState<number | null>(null);
  const [pointsChanged, setPointsChanged] = useState(0);
  const [hostRoastText, setHostRoastText] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isPresentingQuestion, setIsPresentingQuestion] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [confirmationSecondsRemaining, setConfirmationSecondsRemaining] = useState<number | null>(null);
  const [turnDeadline, setTurnDeadline] = useState<number | null>(null);
  const [confirmationDeadline, setConfirmationDeadline] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const hasRemindedPlayer = useRef(false);
  const answerLocked = useRef(false);
  const advanceTimer = useRef<number | null>(null);

  const currentQuestion: Question = TRIVIA_QUESTIONS[currentQuestionIndex] ?? TRIVIA_QUESTIONS[0];
  const activePlayer = players[currentPlayerIndex] ?? null;

  useEffect(() => {
    document.body.dataset.state = gameState.toLowerCase();
  }, [gameState]);

  useEffect(() => {
    let mounted = true;
    host.prepareForPlayback();
    void media.toggleBackgroundMusic(true);
    void liveVoice.start().then(ready => {
      if (!mounted) return;
      if (ready) {
        host.speak('Welcome to the 80s trivia party: where the hair is big and the patience is not. How many players are joining us? Say one, two, three, or four.');
      } else {
        host.speak('Welcome to the 80s trivia party. The microphone is not connected yet. Enable live voice, then tell me how many players are joining us.');
      }
    });
    return () => {
      mounted = false;
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
      liveVoice.stop();
    };
  }, []);

  const startTurnClock = useCallback(() => {
    hasRemindedPlayer.current = false;
    answerLocked.current = false;
    setSecondsRemaining(TURN_SECONDS);
    setTurnDeadline(Date.now() + TURN_SECONDS * 1000);
  }, []);

  function askQuestion(question: Question, player: Player) {
    setGameState('QUESTION_ACTIVE');
    setIsPresentingQuestion(true);
    setSecondsRemaining(null);
    setTurnDeadline(null);

    const startClueMedia = () => {
      const beginAnswering = () => {
        setIsPlayingAudio(false);
        setIsPresentingQuestion(false);
        startTurnClock();
      };

      if (question.type === 'SONG_CLIP' && question.audioClipKey) {
        setIsPlayingAudio(true);
        void media.playSongClip(question.audioClipKey, beginAnswering, 2);
      } else if (question.type === 'SOUND_BYTE' && question.soundByteQuote) {
        setIsPlayingAudio(true);
        host.speak(`Sound byte: ${question.soundByteQuote}`, {
          speechStyle: 'Deliver this as a brisk audio clue in a funny, sarcastic game-show-host voice. Do not explain or identify it.',
          onEnd: beginAnswering,
        });
      } else {
        beginAnswering();
      }
    };

    host.speak(`${player.name}, you're up. ${question.hostClue}`, {
      voice: 'Kore',
      speechStyle: 'A funny, sarcastic, quick-witted 1980s game-show host. Dry punchlines, brisk pace, friendly not cruel.',
      onEnd: startClueMedia,
    });
  }

  const handleNextTurn = useCallback(() => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    host.stop();
    media.stopCurrentClip();
    setIsPlayingAudio(false);
    setTurnDeadline(null);
    setConfirmationDeadline(null);
    setSecondsRemaining(null);
    setConfirmationSecondsRemaining(null);
    if (currentQuestionIndex + 1 >= TRIVIA_QUESTIONS.length) {
      setGameState('GAME_OVER');
      media.stopBackgroundMusic();
      return;
    }

    const nextPlayerIndex = (currentPlayerIndex + 1) % players.length;
    const nextQuestionIndex = currentQuestionIndex + 1;
    setCurrentPlayerIndex(nextPlayerIndex);
    setCurrentQuestionIndex(nextQuestionIndex);
    setSelectedOptionIndex(null);
    setPendingAnswerIndex(null);
    setPointsChanged(0);
    setHostRoastText('');
    setTimedOut(false);
    setGameState('QUESTION_ACTIVE');
    askQuestion(TRIVIA_QUESTIONS[nextQuestionIndex], players[nextPlayerIndex]);
  }, [currentPlayerIndex, currentQuestionIndex, players]);

  const finishAnswer = useCallback((optionIndex: number | null, ranOutOfTime = false) => {
    if (answerLocked.current || gameState === 'ANSWER_REVEAL' || gameState === 'GAME_OVER') return;
    answerLocked.current = true;
    setGameState('ANSWER_REVEAL');
    setTurnDeadline(null);
    setConfirmationDeadline(null);
    setSecondsRemaining(null);
    setConfirmationSecondsRemaining(null);
    setPendingAnswerIndex(null);
    setTimedOut(ranOutOfTime);
    setSelectedOptionIndex(optionIndex);

    const isCorrect = optionIndex === currentQuestion.correctIndex;
    const delta = ranOutOfTime ? 0 : isCorrect ? currentQuestion.basePoints : -currentQuestion.basePoints;
    setPointsChanged(delta);
    setPlayers(previous => previous.map((player, index) => index === currentPlayerIndex
      ? {
          ...player,
          score: player.score + delta,
          correctCount: isCorrect ? player.correctCount + 1 : player.correctCount,
        }
      : player));
    void media.playEffect(ranOutOfTime ? 'incorrect' : isCorrect ? 'correct' : 'incorrect');

    const answer = currentQuestion.options[currentQuestion.correctIndex];
    const resultLine = ranOutOfTime
      ? `Time's up, ${activePlayer?.name}. The clock wins again. The answer was ${answer}. You can appeal to the clock, but it has no customer service.`
      : isCorrect
      ? `${activePlayer?.name}, correct. ${currentQuestion.hostCorrectRoast}`
      : `Not quite, ${activePlayer?.name}. The answer was ${answer}. ${currentQuestion.hostWrongRoast}`;
    const nextPlayer = players.length ? players[(currentPlayerIndex + 1) % players.length]?.name : undefined;
    const nextLine = currentQuestionIndex + 1 >= TRIVIA_QUESTIONS.length
      ? 'That was the last question. Let us see who survived the decade.'
      : `Next up: ${nextPlayer || 'the next player'}. Keep it moving.`;
    const commentary = `${resultLine} ${nextLine}`;
    setHostRoastText(resultLine);

    let didAdvance = false;
    const advance = () => {
      if (didAdvance) return;
      didAdvance = true;
      handleNextTurn();
    };
    advanceTimer.current = window.setTimeout(advance, 30000);
    host.speak(commentary, {
      onEnd: () => {
        if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
        advanceTimer.current = window.setTimeout(advance, 500);
      },
    });
  }, [activePlayer, currentPlayerIndex, currentQuestion, currentQuestionIndex, gameState, handleNextTurn, players]);

  const beginGame = useCallback((roster: Player[]) => {
    setPlayers(roster);
    setCurrentPlayerIndex(0);
    setCurrentQuestionIndex(0);
    setTimedOut(false);
    setGameState('QUESTION_ACTIVE');
    askQuestion(TRIVIA_QUESTIONS[0], roster[0]);
  }, [askQuestion]);

  const handleChoosePlayerCount = useCallback((count: number) => {
    if (count < 1 || count > 4) return;
    const roster = createPlayers(count);
    setPlayers(roster);
    setCurrentPlayerIndex(0);
    setGameState('PLAYER_NAMES');
    host.speak(`Excellent, ${count} ${count === 1 ? 'player' : 'players'}. Player one, say your name or nickname. We have a decade to get through.`);
  }, []);

  const handleSubmitPlayerName = useCallback((rawName: string) => {
    const name = spokenName(rawName);
    if (!name) {
      host.speak('That sounded like a name trying to escape. Say it again, please.');
      return;
    }

    const nextRoster = players.map((player, index) => index === currentPlayerIndex
      ? { ...player, name }
      : player);
    if (currentPlayerIndex + 1 < nextRoster.length) {
      const nextPlayerIndex = currentPlayerIndex + 1;
      setPlayers(nextRoster);
      setCurrentPlayerIndex(nextPlayerIndex);
      host.speak(`Got it, ${name}. Next player, introduce yourself. Try to make it memorable.`);
      return;
    }

    beginGame(nextRoster);
  }, [beginGame, currentPlayerIndex, players]);

  const handleProcessVoiceInput = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text) return;

    if (gameState === 'PLAYER_COUNT') {
      const count = matchVoiceToPlayerCount(text);
      if (count) handleChoosePlayerCount(count);
      else host.speak('One, two, three, or four players. This is not a trick question. Yet.');
      return;
    }

    if (gameState === 'PLAYER_NAMES') {
      handleSubmitPlayerName(text);
      return;
    }

    if (gameState === 'QUESTION_ACTIVE') {
      if (isPresentingQuestion || isPlayingAudio || !activePlayer) return;
      const answerIndex = matchVoiceToOption(text, currentQuestion.options);
      if (answerIndex === null) {
        host.speak(`I didn't catch that, ${activePlayer.name}. Give me your answer before the clock files a complaint.`);
        return;
      }
      setPendingAnswerIndex(answerIndex);
      setGameState('ANSWER_CONFIRM');
      setConfirmationDeadline(Date.now() + CONFIRM_SECONDS * 1000);
      setConfirmationSecondsRemaining(CONFIRM_SECONDS);
      host.speak(`I heard ${currentQuestion.options[answerIndex]}. Is that your final answer, ${activePlayer.name}? Say yes to lock it in, or no to change it.`);
      return;
    }

    if (gameState === 'ANSWER_CONFIRM') {
      if (/\b(yes|yeah|yep|correct|final|lock it in|that's my answer)\b/i.test(text)) {
        finishAnswer(pendingAnswerIndex);
      } else if (/\b(no|nope|change|different answer|wait)\b/i.test(text)) {
        setGameState('QUESTION_ACTIVE');
        setPendingAnswerIndex(null);
        setConfirmationDeadline(null);
        setConfirmationSecondsRemaining(null);
        setTurnDeadline(Date.now() + Math.max(5, secondsRemaining ?? 5) * 1000);
        host.speak(`No problem, ${activePlayer?.name}. Think faster this time; the clock is not sentimental.`);
      }
      return;
    }

    if (gameState === 'ANSWER_REVEAL' && /\b(next|continue|go on|move on)\b/i.test(text)) {
      handleNextTurn();
      return;
    }

    if (gameState === 'GAME_OVER' && /\b(play again|another game|restart)\b/i.test(text)) {
      handlePlayAgain();
    }
  }, [
    activePlayer,
    currentQuestion.options,
    finishAnswer,
    gameState,
    handleChoosePlayerCount,
    handleNextTurn,
    handlePlayAgain,
    handleSubmitPlayerName,
    isPlayingAudio,
    isPresentingQuestion,
    pendingAnswerIndex,
    secondsRemaining,
  ]);

  useEffect(() => liveVoice.onTranscript(handleProcessVoiceInput), [handleProcessVoiceInput]);

  useEffect(() => {
    if (gameState !== 'QUESTION_ACTIVE' || turnDeadline === null) return;
    const updateClock = () => {
      const remaining = Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining > 0 && remaining <= 8 && !hasRemindedPlayer.current) {
        hasRemindedPlayer.current = true;
        host.speak(`Clock's ticking, ${activePlayer?.name}. Eight seconds left. Your brain has been warned.`);
      }
      if (remaining === 0) finishAnswer(null, true);
    };
    updateClock();
    const timer = window.setInterval(updateClock, 250);
    return () => window.clearInterval(timer);
  }, [activePlayer?.name, finishAnswer, gameState, turnDeadline]);

  useEffect(() => {
    if (gameState !== 'ANSWER_CONFIRM' || confirmationDeadline === null) return;
    const updateConfirmationClock = () => {
      const remaining = Math.max(0, Math.ceil((confirmationDeadline - Date.now()) / 1000));
      setConfirmationSecondsRemaining(remaining);
      if (remaining === 0) finishAnswer(pendingAnswerIndex);
    };
    updateConfirmationClock();
    const timer = window.setInterval(updateConfirmationClock, 250);
    return () => window.clearInterval(timer);
  }, [confirmationDeadline, finishAnswer, gameState, pendingAnswerIndex]);

  function handlePlayAgain() {
    host.stop();
    media.stopCurrentClip();
    void media.toggleBackgroundMusic(true);
    setPlayers([]);
    setCurrentQuestionIndex(0);
    setCurrentPlayerIndex(0);
    setSelectedOptionIndex(null);
    setPendingAnswerIndex(null);
    setConfirmationSecondsRemaining(null);
    setPointsChanged(0);
    setHostRoastText('');
    setTimedOut(false);
    setGameState('PLAYER_COUNT');
    host.speak('Round two. How many players are joining us? Say one, two, three, or four.');
  }

  const voiceInstruction = gameState === 'PLAYER_COUNT'
    ? 'Say one, two, three, or four players.'
    : gameState === 'PLAYER_NAMES'
    ? `Player ${currentPlayerIndex + 1}, say your name.`
    : gameState === 'QUESTION_ACTIVE'
    ? `${activePlayer?.name || 'The current player'}: say your answer.`
    : gameState === 'ANSWER_CONFIRM'
    ? `Say yes to lock in ${activePlayer?.name || 'your'} answer, or no to change it.`
    : gameState === 'ANSWER_REVEAL'
    ? 'The host is moving on. Say next to skip ahead.'
    : gameState === 'GAME_OVER'
    ? 'Say play again to start a new game.'
    : 'Live voice is connecting.';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative selection:bg-pink-500 selection:text-white">
      <div className="fixed inset-0 crt-scanlines z-30 pointer-events-none opacity-40" />

      <MarqueeHeader
        currentRoundName={gameState === 'PLAYER_COUNT' || gameState === 'PLAYER_NAMES' ? 'WELCOME' : '80s TRIVIA'}
        questionNumber={Math.min(currentQuestionIndex + 1, TRIVIA_QUESTIONS.length)}
        totalQuestions={TRIVIA_QUESTIONS.length}
      />

      <LiveVoiceConsole
        activePlayerBuzzedName={gameState === 'QUESTION_ACTIVE' || gameState === 'ANSWER_CONFIRM' ? activePlayer?.name : null}
        instructionText={voiceInstruction}
      />

      <main className="flex-1 flex flex-col justify-center items-center py-4 relative z-20">
        {(gameState === 'PLAYER_COUNT' || gameState === 'PLAYER_NAMES') && (
          <PlayerSetupView
            step={gameState === 'PLAYER_COUNT' ? 'count' : 'names'}
            players={players}
            currentPlayerIndex={currentPlayerIndex}
          />
        )}

        {(gameState === 'QUESTION_ACTIVE' || gameState === 'ANSWER_CONFIRM') && activePlayer && (
          <TriviaQuestionView
            question={currentQuestion}
            currentPoints={currentQuestion.basePoints}
            activeBuzzerPlayer={activePlayer}
            secondsRemaining={gameState === 'ANSWER_CONFIRM' ? confirmationSecondsRemaining : secondsRemaining}
            isPlayingAudio={isPlayingAudio}
            isPresentingQuestion={isPresentingQuestion}
            isConfirmingAnswer={gameState === 'ANSWER_CONFIRM'}
          />
        )}

        {gameState === 'ANSWER_REVEAL' && (
          <AnswerRevealView
            question={currentQuestion}
            selectedOptionIndex={selectedOptionIndex}
            buzzedPlayer={activePlayer}
            pointsChanged={pointsChanged}
            hostRoastText={hostRoastText}
            isLastQuestion={currentQuestionIndex + 1 >= TRIVIA_QUESTIONS.length}
            timedOut={timedOut}
          />
        )}

        {gameState === 'GAME_OVER' && (
          <GameOverView players={players} />
        )}
      </main>
    </div>
  );
}
