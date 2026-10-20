import type { Player } from './types.ts';

/**
 * Calculates current question value as countdown progresses (YDKJ style: starts high, decays to min)
 */
export function calculateDecayedPoints(basePoints: number, elapsedSeconds: number, maxDurationSeconds: number): number {
  if (elapsedSeconds <= 0) return basePoints;
  if (elapsedSeconds >= maxDurationSeconds) return Math.round(basePoints * 0.2); // minimum 20% floor
  
  const decayRatio = elapsedSeconds / maxDurationSeconds;
  const currentPoints = basePoints - (basePoints * 0.8 * decayRatio);
  // Round to nearest 50 for clean game show money
  return Math.max(100, Math.round(currentPoints / 50) * 50);
}

/**
 * Calculates penalty for wrong answer (deducts current question value)
 */
export function calculatePenalty(pointsAtBuzz: number): number {
  return -Math.abs(pointsAtBuzz);
}

/**
 * Validates whether a player is allowed to buzz in
 */
export function canPlayerBuzz(
  playerId: string,
  lockedOutPlayerIds: string[],
  activeBuzzerPlayerId: string | null,
  isQuestionActive: boolean
): boolean {
  if (!isQuestionActive) return false;
  if (activeBuzzerPlayerId !== null) return false;
  if (lockedOutPlayerIds.includes(playerId)) return false;
  return true;
}

/**
 * Executes a "Screw" on a target player
 */
export function executeScrew(
  screwerId: string,
  targetId: string,
  players: Player[]
): { success: boolean; updatedPlayers: Player[]; errorReason?: string } {
  const screwer = players.find(p => p.id === screwerId);
  const target = players.find(p => p.id === targetId);

  if (!screwer || !target) {
    return { success: false, updatedPlayers: players, errorReason: 'Player not found' };
  }
  if (screwerId === targetId) {
    return { success: false, updatedPlayers: players, errorReason: 'Cannot screw yourself!' };
  }
  if (screwer.screwsRemaining <= 0) {
    return { success: false, updatedPlayers: players, errorReason: 'No screws remaining!' };
  }

  const updatedPlayers = players.map(p => {
    if (p.id === screwerId) {
      return { ...p, screwsRemaining: p.screwsRemaining - 1 };
    }
    return p;
  });

  return { success: true, updatedPlayers };
}

/**
 * Match a spoken voice transcript to a player in the room (for Voice Buzzers)
 */
export function matchVoiceToPlayer(transcript: string, players: Player[]): Player | null {
  const cleaned = transcript.toLowerCase().trim();
  if (!cleaned) return null;

  for (const player of players) {
    // Check direct name match
    if (cleaned.includes(player.name.toLowerCase())) {
      return player;
    }
    // Check trigger words (e.g. "player 1", "one", "buzz", "q", "me")
    for (const trigger of player.voiceTriggerWords) {
      const lowerTrigger = trigger.toLowerCase();
      // Whole word or boundary match
      const regex = new RegExp(`\\b${lowerTrigger}\\b`, 'i');
      if (regex.test(cleaned)) {
        return player;
      }
    }
  }

  // Generic buzz match fallback: if only 1 player isn't locked out or "i buzz", check player index words
  if (/\b(player one|number one|first player)\b/i.test(cleaned) && players[0]) return players[0];
  if (/\b(player two|number two|second player)\b/i.test(cleaned) && players[1]) return players[1];
  if (/\b(player three|number three|third player)\b/i.test(cleaned) && players[2]) return players[2];
  if (/\b(player four|number four|fourth player)\b/i.test(cleaned) && players[3]) return players[3];

  return null;
}

/**
 * Match a spoken voice transcript to an answer option (0, 1, 2, or 3)
 */
export function matchVoiceToOption(transcript: string, options: string[]): number | null {
  const cleaned = transcript.toLowerCase().trim();
  if (!cleaned) return null;

  // Check 1, 2, 3, 4
  if (/\b(1|one|first|choice one|a|option a)\b/i.test(cleaned)) return 0;
  if (/\b(2|two|second|choice two|b|option b)\b/i.test(cleaned)) return 1;
  if (/\b(3|three|third|choice three|c|option c)\b/i.test(cleaned)) return 2;
  if (/\b(4|four|fourth|choice four|d|option d)\b/i.test(cleaned)) return 3;

  // Check content words against options
  for (let i = 0; i < options.length; i++) {
    const optText = options[i].toLowerCase();
    // If transcript contains significant part of option string
    if (optText.length > 3 && (cleaned.includes(optText) || optText.includes(cleaned))) {
      return i;
    }
  }

  return null;
}

/**
 * Computes 80s rank classification based on final cash score
 */
export function getPlayerRank(score: number): { title: string; subtitle: string; icon: string } {
  if (score >= 12000) {
    return { title: 'TUBULAR 80s OVERLORD', subtitle: 'You own the entire neon decade! Marty McFly wishes he had your brain.', icon: '👑' };
  }
  if (score >= 7000) {
    return { title: 'RADICAL ARCADE CHAMPION', subtitle: 'Maximum high score energy. Someone get this player a neon fanny pack!', icon: '🕹️' };
  }
  if (score >= 3000) {
    return { title: 'TOTALLY AWESOME MALL RAT', subtitle: 'Respectable 80s fluency. You know your Cyndi Lauper from your Rick Astley.', icon: '📼' };
  }
  if (score >= 0) {
    return { title: 'CASSETTE TAPE ROOKIE', subtitle: 'A little rewinding with a pencil is clearly needed here.', icon: '📻' };
  }
  return { title: 'GAG ME WITH A SPOON', subtitle: 'Oof! Negative bank balance. You owe the studio $80s in late VHS rental fees.', icon: '💀' };
}
