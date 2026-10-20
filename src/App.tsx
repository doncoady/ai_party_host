import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GameState, Player, Question } from './game/types.ts';
import { TRIVIA_QUESTIONS, JACK_ATTACK_DATA } from './game/triviaData.ts';
import { 
  calculateDecayedPoints, 
  calculatePenalty, 
  canPlayerBuzz, 
  executeScrew, 
  matchVoiceToPlayer, 
  matchVoiceToOption 
} from './game/rules.ts';
import { synth } from './audio/synthEngine.ts';
import { host } from './audio/speechHost.ts';
import { voiceBuzzer } from './speech/voiceBuzzer.ts';
import { MarqueeHeader } from './components/MarqueeHeader.tsx';
import { Scoreboard } from './components/Scoreboard.tsx';
import { LobbyView } from './components/LobbyView.tsx';
import { TriviaQuestionView } from './components/TriviaQuestionView.tsx';
import { AnswerRevealView } from './components/AnswerRevealView.tsx';
import { JackAttackView } from './components/JackAttackView.tsx';
import { GameOverView } from './components/GameOverView.tsx';
import { LiveVoiceConsole } from './components/LiveVoiceConsole.tsx';

const DEFAULT_PLAYERS: Player[] = [
  {
    id: 'p1',
    name: 'Neon Nancy',
    score: 0,
    color: 'emerald',
    borderHex: '#10b981',
    bgHex: '#064e3b',
    key: 'q',
    voiceTriggerWords: ['nancy', 'neon', 'green', 'one', 'player 1'],
    avatar: '🎸',
    screwsRemaining: 1,
    buzzCount: 0,
    correctCount: 0,
  },
  {
    id: 'p2',
    name: 'Rad Rick',
    score: 0,
    color: 'pink',
    borderHex: '#ec4899',
    bgHex: '#831843',
    key: 'p',
    voiceTriggerWords: ['rick', 'rad', 'pink', 'two', 'player 2'],
    avatar: '🕶️',
    screwsRemaining: 1,
    buzzCount: 0,
    correctCount: 0,
  },
];

export default function App() {
  const [gameState, setGameState] = useState<GameState>('LOBBY');
  const [players, setPlayers] = useState<Player[]>(DEFAULT_PLAYERS);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Question state
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeBuzzerPlayerId, setActiveBuzzerPlayerId] = useState<string | null>(null);
  const [lockedOutPlayerIds, setLockedOutPlayerIds] = useState<string[]>([]);
  const [buzzerSecondsRemaining, setBuzzerSecondsRemaining] = useState(5);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [pointsChanged, setPointsChanged] = useState(0);
  const [hostRoastText, setHostRoastText] = useState('');
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);

  // Screw mechanics
  const [isScrewTargeting, setIsScrewTargeting] = useState(false);
  const [screwerId, setScrewerId] = useState<string | null>(null);
  const [isScrewActiveForQuestion, setIsScrewActiveForQuestion] = useState(false);

  const QUESTION_DURATION = 16;
  const currentQuestion: Question = TRIVIA_QUESTIONS[currentQuestionIndex] || TRIVIA_QUESTIONS[0];

  // Sync state to body dataset
  useEffect(() => {
    document.body.dataset.state = gameState.toLowerCase();
  }, [gameState]);

  // Support ?autostart=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1' && gameState === 'LOBBY') {
      handleStartGame();
    }
  }, []);

  // Calculate current decayed points
  const currentPoints = calculateDecayedPoints(
    currentQuestion.basePoints,
    elapsedSeconds,
    QUESTION_DURATION
  );

  const playQuestionIntroAndAudio = (q: Question) => {
    host.speak(q.hostIntroCommentary, {
      voice: 'Puck',
      onEnd: () => {
        if (q.type === 'SONG_CLIP' && q.audioClipKey) {
          setIsPlayingAudio(true);
          synth.playSongClip(q.audioClipKey, () => setIsPlayingAudio(false));
        } else if (q.type === 'SOUND_BYTE' && q.soundByteQuote) {
          setIsPlayingAudio(true);
          host.playCharacterSoundByte(
            q.id,
            q.soundByteQuote,
            q.characterSilhouetteHint || '',
            () => setIsPlayingAudio(false)
          );
        }
      },
    });
  };

  // Start the Game
  const handleStartGame = () => {
    synth.init();
    synth.playFanfare();
    voiceBuzzer.start();
    setGameState('QUESTION_ACTIVE');
    setCurrentQuestionIndex(0);
    resetQuestionState();

    // Host intro speech with authentic Gemini voice, followed by automatic song clip
    playQuestionIntroAndAudio(TRIVIA_QUESTIONS[0]);
  };

  const resetQuestionState = () => {
    setElapsedSeconds(0);
    setActiveBuzzerPlayerId(null);
    setLockedOutPlayerIds([]);
    setBuzzerSecondsRemaining(5);
    setSelectedOptionIndex(null);
    setPointsChanged(0);
    setHostRoastText('');
    setIsPlayingAudio(false);
    setIsScrewActiveForQuestion(false);
    setIsScrewTargeting(false);
    setScrewerId(null);
  };

  // Question countdown timer
  useEffect(() => {
    if (gameState !== 'QUESTION_ACTIVE') return;

    const timer = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= QUESTION_DURATION) {
          clearInterval(timer);
          handleTimeExpired();
          return QUESTION_DURATION;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState]);

  // Buzzer answer countdown timer (5 seconds once buzzed in)
  useEffect(() => {
    if (gameState !== 'PLAYER_BUZZED') return;

    const timer = setInterval(() => {
      setBuzzerSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleBuzzerTimeout();
          return 0;
        }
        synth.playCountdownTick();
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, activeBuzzerPlayerId]);

  // Handle Player Buzz In
  const handlePlayerBuzz = useCallback((playerId: string, viaVoice: boolean = false) => {
    if (!canPlayerBuzz(playerId, lockedOutPlayerIds, activeBuzzerPlayerId, gameState === 'QUESTION_ACTIVE')) {
      return;
    }

    synth.playBuzzer();
    setActiveBuzzerPlayerId(playerId);
    setBuzzerSecondsRemaining(5);
    setGameState('PLAYER_BUZZED');

    const buzzedPlayer = players.find(p => p.id === playerId);
    if (buzzedPlayer) {
      setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, buzzCount: p.buzzCount + 1 } : p));
      host.speak(`${buzzedPlayer.name} buzzed in! Speak your answer now! Five seconds!`, {
        voice: 'Puck',
        interrupt: true,
      });
    }
  }, [lockedOutPlayerIds, activeBuzzerPlayerId, gameState, players]);

  // Handle Answer Selection (by voice or click)
  const handleSelectOption = useCallback(async (optionIndex: number, forcedPlayerId?: string) => {
    let playerId = forcedPlayerId || activeBuzzerPlayerId;

    // If nobody has buzzed yet during question active, automatically buzz first available player
    if (!playerId && (gameState === 'QUESTION_ACTIVE' || gameState === 'PLAYER_BUZZED')) {
      const candidate = players.find(p => !lockedOutPlayerIds.includes(p.id));
      if (candidate) {
        playerId = candidate.id;
        setActiveBuzzerPlayerId(candidate.id);
        setPlayers(prev => prev.map(p => p.id === candidate.id ? { ...p, buzzCount: p.buzzCount + 1 } : p));
      }
    }

    if (!playerId) return;

    setSelectedOptionIndex(optionIndex);
    const buzzedPlayer = players.find(p => p.id === playerId);
    if (!buzzedPlayer) return;

    const isCorrect = optionIndex === currentQuestion.correctIndex;
    const delta = isCorrect ? currentPoints : calculatePenalty(currentPoints);

    setPointsChanged(delta);

    // Update player scores
    setPlayers(prev =>
      prev.map(p => {
        if (p.id === playerId) {
          return {
            ...p,
            score: p.score + delta,
            correctCount: isCorrect ? p.correctCount + 1 : p.correctCount,
          };
        }
        return p;
      })
    );

    if (isCorrect) {
      synth.playCorrect();
    } else {
      synth.playWrong();
    }

    // Move to Reveal state
    setGameState('ANSWER_REVEAL');

    // Fetch dynamic AI host roast from server with authentic Gemini TTS audio
    try {
      const { roastText, audioBase64 } = await host.fetchDynamicRoast({
        playerName: buzzedPlayer.name,
        score: buzzedPlayer.score + delta,
        questionText: currentQuestion.question,
        chosenAnswer: currentQuestion.options[optionIndex],
        isCorrect,
        correctAnswer: currentQuestion.options[currentQuestion.correctIndex],
      });
      setHostRoastText(roastText);
      if (audioBase64) {
        host.playAudioWav(audioBase64);
      } else {
        host.speak(roastText, { voice: 'Puck' });
      }
    } catch {
      const fallback = isCorrect ? currentQuestion.hostCorrectRoast : currentQuestion.hostWrongRoast;
      setHostRoastText(fallback);
      host.speak(fallback, { voice: 'Puck' });
    }
  }, [gameState, activeBuzzerPlayerId, currentQuestion, currentPoints, players, lockedOutPlayerIds]);

  // Handle Buzzer Timeout (Player failed to answer in 5s)
  const handleBuzzerTimeout = () => {
    if (!activeBuzzerPlayerId) return;
    const buzzedPlayer = players.find(p => p.id === activeBuzzerPlayerId);
    synth.playWrong();

    const penalty = calculatePenalty(currentPoints);
    setPointsChanged(penalty);

    setPlayers(prev =>
      prev.map(p => (p.id === activeBuzzerPlayerId ? { ...p, score: p.score + penalty } : p))
    );

    // Add to lockouts
    const newLockouts = [...lockedOutPlayerIds, activeBuzzerPlayerId];
    setLockedOutPlayerIds(newLockouts);

    // Check if other players can still buzz
    if (newLockouts.length >= players.length) {
      setGameState('ANSWER_REVEAL');
      const roast = `Time expired on ${buzzedPlayer?.name || 'player'}! And nobody else can buzz. Tragic.`;
      setHostRoastText(roast);
      host.speak(roast, { voice: 'Puck' });
    } else {
      setActiveBuzzerPlayerId(null);
      setGameState('QUESTION_ACTIVE');
      host.speak(`Time's up for ${buzzedPlayer?.name}! The floor is open! Anyone shout your name to buzz in!`, {
        voice: 'Puck',
        interrupt: true,
      });
    }
  };

  // Handle question time expired without answers
  const handleTimeExpired = () => {
    synth.playWrong();
    setSelectedOptionIndex(null);
    setActiveBuzzerPlayerId(null);
    setPointsChanged(0);
    setGameState('ANSWER_REVEAL');
    const roast = `Tick tock! Time ran out, and nobody buzzed in. Were you all busy untangling your cassette tapes?!`;
    setHostRoastText(roast);
    host.speak(roast, { voice: 'Puck' });
  };

  // Screw Mechanics
  const handleInitiateScrew = (screwer: string) => {
    setIsScrewTargeting(true);
    setScrewerId(screwer);
    synth.playScrewStab();
    host.speak("Someone's feeling ruthless! Shout who you want to screw!", { voice: 'Puck', interrupt: true });
  };

  const handleSelectScrewTarget = (targetId: string) => {
    if (!screwerId) return;
    const res = executeScrew(screwerId, targetId, players);
    if (!res.success) return;

    setPlayers(res.updatedPlayers);
    setIsScrewTargeting(false);
    setIsScrewActiveForQuestion(true);

    const target = players.find(p => p.id === targetId);
    const screwer = players.find(p => p.id === screwerId);

    synth.playScrewStab();
    host.speak(`OH SNAP! ${screwer?.name} just SCREWED ${target?.name}! You have five seconds to answer or lose cash!`, {
      voice: 'Puck',
      interrupt: true,
    });

    setActiveBuzzerPlayerId(targetId);
    setBuzzerSecondsRemaining(5);
    setGameState('PLAYER_BUZZED');
  };

  // Play audio clip for song clip / sound byte
  const handlePlayAudioClip = () => {
    setIsPlayingAudio(true);
    if (currentQuestion.type === 'SONG_CLIP' && currentQuestion.audioClipKey) {
      synth.playSongClip(currentQuestion.audioClipKey, () => {
        setIsPlayingAudio(false);
      });
    } else if (currentQuestion.type === 'SOUND_BYTE') {
      // Play authentic character voice sound byte via Gemini TTS
      host.playCharacterSoundByte(
        currentQuestion.id,
        currentQuestion.soundByteQuote || '',
        currentQuestion.characterSilhouetteHint || '',
        () => setIsPlayingAudio(false)
      );
    }
  };

  // Next Question or Jack Attack
  const handleNextQuestion = () => {
    synth.stopCurrentClip();
    if (currentQuestionIndex + 1 < TRIVIA_QUESTIONS.length) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      resetQuestionState();
      setGameState('QUESTION_ACTIVE');
      playQuestionIntroAndAudio(TRIVIA_QUESTIONS[nextIdx]);
    } else {
      setGameState('JACK_ATTACK');
    }
  };

  // Jack Attack scoring
  const handlePlayerBuzzJack = (playerId: string, isCorrect: boolean) => {
    const delta = isCorrect ? 2000 : -2000;
    setPlayers(prev =>
      prev.map(p => {
        if (p.id === playerId) {
          return {
            ...p,
            score: p.score + delta,
            correctCount: isCorrect ? p.correctCount + 1 : p.correctCount,
            buzzCount: p.buzzCount + 1,
          };
        }
        return p;
      })
    );
  };

  const handleFinishJackAttack = () => {
    setGameState('GAME_OVER');
  };

  const handlePlayAgain = () => {
    synth.playFanfare();
    setPlayers(prev =>
      prev.map(p => ({
        ...p,
        score: 0,
        screwsRemaining: 1,
        buzzCount: 0,
        correctCount: 0,
      }))
    );
    setCurrentQuestionIndex(0);
    resetQuestionState();
    setGameState('LOBBY');
  };

  // Central Speech & Live Conversation Handler
  const handleProcessVoiceInput = useCallback(async (transcript: string) => {
    if (!transcript || isProcessingVoice) return;
    const lower = transcript.toLowerCase().trim();

    // 1. Lobby quick voice commands
    if (gameState === 'LOBBY') {
      if (/\b(start|play|go|let's play|begin)\b/i.test(lower)) {
        handleStartGame();
        return;
      }
    }

    // 2. Question Active: Check for immediate player buzz
    if (gameState === 'QUESTION_ACTIVE') {
      const matchedPlayer = matchVoiceToPlayer(lower, players);
      if (matchedPlayer) {
        handlePlayerBuzz(matchedPlayer.id, true);
        return;
      }

      // Check for voice screw command: "Screw Rick" / "Screw Nancy"
      if (lower.includes('screw')) {
        for (const target of players) {
          if (lower.includes(target.name.toLowerCase())) {
            // Find a player with a screw remaining
            const screwer = players.find(p => p.id !== target.id && p.screwsRemaining > 0);
            if (screwer) {
              setScrewerId(screwer.id);
              handleSelectScrewTarget(target.id);
              return;
            }
          }
        }
      }
    }

    // 3. Question Active or Player Buzzed: Check for immediate spoken answer
    if (gameState === 'PLAYER_BUZZED' || gameState === 'QUESTION_ACTIVE') {
      const matchedOpt = matchVoiceToOption(lower, currentQuestion.options);
      if (matchedOpt !== null) {
        handleSelectOption(matchedOpt);
        return;
      }
    }

    // 4. Answer Reveal: Check for voice next command
    if (gameState === 'ANSWER_REVEAL') {
      if (/\b(next|continue|move on|go on)\b/i.test(lower)) {
        handleNextQuestion();
        return;
      }
    }

    // 5. Send to AI Host Live Conversation Engine for deep banter and understanding!
    setIsProcessingVoice(true);
    try {
      const result = await voiceBuzzer.sendLiveConversation({
        transcript,
        gameState,
        players,
        currentQuestion,
        activeBuzzerPlayerId,
      });

      if (result) {
        // Execute recognized intent
        if (result.intent === 'BUZZ' && result.playerId) {
          handlePlayerBuzz(result.playerId, true);
        } else if (result.intent === 'ANSWER' && typeof result.optionIndex === 'number') {
          handleSelectOption(result.optionIndex);
        } else if (result.intent === 'START_GAME' && gameState === 'LOBBY') {
          handleStartGame();
        } else if (result.intent === 'NEXT_QUESTION' && gameState === 'ANSWER_REVEAL') {
          handleNextQuestion();
        } else if (result.intent === 'SCREW' && result.targetPlayerId) {
          const screwer = players.find(p => p.id !== result.targetPlayerId && p.screwsRemaining > 0);
          if (screwer) {
            setScrewerId(screwer.id);
            handleSelectScrewTarget(result.targetPlayerId);
          }
        }

        // Play host reply audio if generated
        if (result.audioBase64) {
          host.playAudioWav(result.audioBase64);
        } else if (result.hostReplyText) {
          host.speak(result.hostReplyText, { voice: 'Puck' });
        }
      }
    } finally {
      setIsProcessingVoice(false);
    }
  }, [gameState, players, currentQuestion, activeBuzzerPlayerId, isProcessingVoice, handlePlayerBuzz, handleSelectOption]);

  // Connect Voice Buzzer callback
  useEffect(() => {
    return voiceBuzzer.onBuzzerSpoken((transcript) => {
      handleProcessVoiceInput(transcript);
    });
  }, [handleProcessVoiceInput]);

  // Global Keyboard Listener as backup
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState === 'LOBBY') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleStartGame();
        }
        return;
      }

      if (gameState === 'QUESTION_ACTIVE') {
        const key = e.key.toLowerCase();
        const player = players.find(p => p.key === key);
        if (player) {
          e.preventDefault();
          handlePlayerBuzz(player.id);
        }
      }

      if (gameState === 'PLAYER_BUZZED' && activeBuzzerPlayerId) {
        if (['1', '2', '3', '4'].includes(e.key)) {
          e.preventDefault();
          handleSelectOption(parseInt(e.key, 10) - 1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, activeBuzzerPlayerId, players, handlePlayerBuzz, handleSelectOption]);

  const activeBuzzerPlayer = players.find(p => p.id === activeBuzzerPlayerId) || null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between relative selection:bg-pink-500 selection:text-white">
      {/* CRT Scanline Retro Overlay */}
      <div className="fixed inset-0 crt-scanlines z-30 pointer-events-none opacity-40" />

      {/* Top Marquee Header */}
      <MarqueeHeader
        currentRoundName={gameState === 'JACK_ATTACK' ? 'JACK ATTACK' : 'ROUND 1'}
        questionNumber={currentQuestionIndex + 1}
        totalQuestions={TRIVIA_QUESTIONS.length}
      />

      {/* Live Voice Interaction Console */}
      <LiveVoiceConsole
        onDirectSpokenText={handleProcessVoiceInput}
        activePlayerBuzzedName={activeBuzzerPlayer?.name}
      />

      {/* Main Dynamic Viewport */}
      <main className="flex-1 flex flex-col justify-center items-center py-4 relative z-20">
        {gameState === 'LOBBY' && (
          <LobbyView
            players={players}
            onUpdatePlayers={setPlayers}
            onStartGame={handleStartGame}
          />
        )}

        {(gameState === 'QUESTION_ACTIVE' || gameState === 'PLAYER_BUZZED') && (
          <TriviaQuestionView
            question={currentQuestion}
            currentPoints={currentPoints}
            totalDurationSeconds={QUESTION_DURATION}
            elapsedSeconds={elapsedSeconds}
            activeBuzzerPlayer={activeBuzzerPlayer}
            buzzerSecondsRemaining={buzzerSecondsRemaining}
            onSelectOption={handleSelectOption}
            onPlayAudioClip={handlePlayAudioClip}
            isPlayingAudio={isPlayingAudio}
            isScrewTargetActive={isScrewActiveForQuestion}
          />
        )}

        {gameState === 'ANSWER_REVEAL' && (
          <AnswerRevealView
            question={currentQuestion}
            selectedOptionIndex={selectedOptionIndex}
            buzzedPlayer={activeBuzzerPlayer}
            pointsChanged={pointsChanged}
            hostRoastText={hostRoastText}
            onNextQuestion={handleNextQuestion}
            isLastQuestion={currentQuestionIndex + 1 >= TRIVIA_QUESTIONS.length}
          />
        )}

        {gameState === 'JACK_ATTACK' && (
          <JackAttackView
            roundData={JACK_ATTACK_DATA}
            players={players}
            onPlayerBuzzJack={handlePlayerBuzzJack}
            onFinishJackAttack={handleFinishJackAttack}
          />
        )}

        {gameState === 'GAME_OVER' && (
          <GameOverView
            players={players}
            onPlayAgain={handlePlayAgain}
          />
        )}
      </main>

      {/* Couch Multiplayer Scoreboard Footer */}
      {gameState !== 'LOBBY' && gameState !== 'GAME_OVER' && (
        <Scoreboard
          players={players}
          activeBuzzerPlayerId={activeBuzzerPlayerId}
          lockedOutPlayerIds={lockedOutPlayerIds}
          isQuestionActive={gameState === 'QUESTION_ACTIVE'}
          onPlayerBuzz={handlePlayerBuzz}
          onInitiateScrew={handleInitiateScrew}
          isScrewTargeting={isScrewTargeting}
          screwerId={screwerId}
          onSelectScrewTarget={handleSelectScrewTarget}
        />
      )}
    </div>
  );
}
