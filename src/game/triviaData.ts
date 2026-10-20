import { Question, JackAttackRound } from './types.ts';

export const TRIVIA_QUESTIONS: Question[] = [
  // --- Question 1: Authentic Song Clip (A-ha) ---
  {
    id: 'q_song_1',
    category: 'SYNTH-ETIC DREAMS',
    title: 'Name That Song Clip!',
    question: 'Listen to this clip from the actual song! Which Norwegian trio scored their biggest global smash with this pencil-sketch rotoscoped anthem in 1985?',
    type: 'SONG_CLIP',
    audioClipKey: 'take_on_me',
    options: ['A-ha ("Take On Me")', 'Duran Duran ("Rio")', 'Depeche Mode ("Just Can\'t Get Enough")', 'Wham! ("Wake Me Up Before You Go-Go")'],
    correctIndex: 0,
    basePoints: 1000,
    explanation: 'A-ha’s "Take On Me" hit #1 on the Billboard Hot 100 in October 1985, immortalized by Morten Harket’s four-octave vocal range and revolutionary rotoscoped pencil animation.',
    hostIntroCommentary: 'Listen up! It is Question One: Name That 80s Song Clip! Just shout your name or the answer when you know it!',
    hostCorrectRoast: 'Bingo! You know your Norwegian falsetto imports! A-ha thanks you, and so does music video history.',
    hostWrongRoast: 'Wrong! That was A-ha’s "Take On Me"! Did you think that was Mozart playing hopscotch?!',
    sponsorTitle: 'Aqua Net Super Extra Hold',
    sponsorCopy: 'Aqua Net Hairspray: Defying atmospheric physics and ozone layers since 1982.'
  },
  // --- Question 2: Authentic Sound Byte (Ferris Bueller) ---
  {
    id: 'q_char_1',
    category: 'WHO SAID THAT?!',
    title: 'The Great 80s Sound Byte',
    question: '"Life moves pretty fast. If you don\'t stop and look around once in a while, you could miss it." Which fourth-wall-breaking 1986 teen hero said this while faking a fever of 101 degrees?',
    type: 'SOUND_BYTE',
    soundByteQuote: 'Life moves pretty fast. If you don\'t stop and look around once in a while, you could miss it.',
    characterSilhouetteHint: 'Ferris Bueller',
    options: ['Ferris Bueller', 'Marty McFly', 'Jeff Spicoli', 'Duckie Dale'],
    correctIndex: 0,
    basePoints: 1000,
    explanation: 'Matthew Broderick delivered this iconic opening monologue in John Hughes’ 1986 classic "Ferris Bueller\'s Day Off". Bueller... Bueller... Bueller?',
    hostIntroCommentary: 'Listen to this authentic movie sound byte! Just shout your name to buzz in!',
    hostCorrectRoast: 'Correct! You get the cash, and Cameron Frye gets to kick his dad’s Ferrari off the glass pavilion.',
    hostWrongRoast: 'Wrong! That’s Ferris Bueller! Someone call Principal Rooney, we’ve got a truant player in the studio.',
    sponsorTitle: 'Swatch Watches',
    sponsorCopy: 'Why wear one watch when you can strap four neon timepieces to your forearm simultaneously?'
  },
  // --- Question 3: Authentic Song Clip (Rick Astley) ---
  {
    id: 'q_song_2',
    category: 'NEVER GONNA FORGET',
    title: 'The Original Prank Anthem',
    question: 'Listen to this clip from the actual song! Before it became the Internet’s most persistent hyperlink prank, who sang this 1987 smash hit?',
    type: 'SONG_CLIP',
    audioClipKey: 'never_gonna_give_you_up',
    options: ['Rick Astley', 'George Michael', 'Jason Donovan', 'Kylie Minogue'],
    correctIndex: 0,
    basePoints: 1200,
    explanation: 'Rick Astley was only 21 years old when "Never Gonna Give You Up" topped the charts in 25 countries in 1987, decades before rickrolling took over the internet.',
    hostIntroCommentary: 'Listen to this clip from the actual song! Shout your answer into the room!',
    hostCorrectRoast: 'You got Rickrolled and you still got it right! Rick Astley will never give you up, but I might.',
    hostWrongRoast: 'You missed Rick Astley?! You just got Rick-wrecked. Minus cash for your wallet!',
    sponsorTitle: 'Tab Diet Cola',
    sponsorCopy: 'Tab: Delicious saccharin flavor, zero calories, and 100% genuine metallic aftertaste.'
  },
  // --- Question 4: Authentic Sound Byte (Doc Brown) ---
  {
    id: 'q_char_2',
    category: 'HEAVY METAL TIME TRAVEL',
    title: '1.21 Gigawatts of Wisdom',
    question: '"Roads? Where we\'re going, we don\'t need roads!" Which wild-haired inventor uttered these immortal words right before hovering a sports car into the future?',
    type: 'SOUND_BYTE',
    soundByteQuote: 'Roads? Where we\'re going, we don\'t need roads!',
    characterSilhouetteHint: 'Doc Brown',
    options: ['Dr. Emmett "Doc" Brown', 'Dr. Peter Venkman', 'Wayne Szalinski', 'Professor Falken'],
    correctIndex: 0,
    basePoints: 1200,
    explanation: 'Christopher Lloyd as Dr. Emmett Brown in the closing scene of 1985’s "Back to the Future", setting up their trip to the futuristic year of 2015.',
    hostIntroCommentary: 'Great Scott! An authentic movie sound byte is coming through your speakers right now!',
    hostCorrectRoast: 'Great Scott, you nailed it! 1.21 gigawatts of pure trivia dominance!',
    hostWrongRoast: 'Heavy! You missed Doc Brown?! You’re about as sharp as a box of Libyan plutonium.',
    sponsorTitle: 'Members Only Jackets',
    sponsorCopy: 'When you want everyone at the roller rink to know you belong to an ambiguous club with zero qualifications.'
  },
  // --- Question 5: Botched Products Trivia ---
  {
    id: 'q_trivia_1',
    category: 'BOGUS BOTCHED BEVERAGES',
    title: 'The Great Carbonated Disaster of 1985',
    question: 'In April 1985, the Coca-Cola Company made what is widely considered one of the biggest marketing blunders of the 20th century by replacing their century-old formula with what short-lived product?',
    type: 'TRIVIA',
    options: ['New Coke', 'Crystal Pepsi', 'OK Soda', 'Jolt Cola Extreme'],
    correctIndex: 0,
    basePoints: 1500,
    explanation: 'New Coke lasted only 79 days before public outrage and hoarding of original Coke compelled the company to bring back "Coca-Cola Classic".',
    hostIntroCommentary: 'Let us talk culinary hubris. It is 1985, and someone in Atlanta had an absolute brain malfunction.',
    hostCorrectRoast: 'Right on the money! New Coke: proving that nobody asks for change when they just want pure corn syrup.',
    hostWrongRoast: 'Wrong! Crystal Pepsi didn’t ruin our tastebuds until 1992! That was the infamous New Coke catastrophe.',
    sponsorTitle: 'ColecoVision Home Arcade',
    sponsorCopy: 'State of the art 8-bit graphics! It almost looks like Donkey Kong if you squint from across the carpet.'
  },
  // --- Question 6: Authentic Song Clip (Eurythmics) ---
  {
    id: 'q_song_3',
    category: 'DARK SYNTH PULSES',
    title: 'Eurythmics Night Terrors',
    question: 'Listen to this clip from the actual song! Which Annie Lennox and Dave Stewart duo track asked "Who am I to disagree?" in 1983?',
    type: 'SONG_CLIP',
    audioClipKey: 'sweet_dreams',
    options: ['Eurythmics ("Sweet Dreams")', 'Soft Cell ("Tainted Love")', 'Tears for Fears ("Mad World")', 'The Human League ("Don\'t You Want Me")'],
    correctIndex: 0,
    basePoints: 1500,
    explanation: '"Sweet Dreams (Are Made of This)" catapulted Eurythmics to international stardom with its distinct Movement Systems Drum Computer beat and Annie Lennox’s cropped orange hair.',
    hostIntroCommentary: 'Listen to this clip from the actual song! Shout your answer into the room!',
    hostCorrectRoast: 'Sweet Dreams are made of this! Annie Lennox is nodding in approval from a retro music video.',
    hostWrongRoast: 'Incorrect! That’s Eurythmics! Some of them want to use you, and that question definitely just did.',
    sponsorTitle: 'Sony Walkman Sports Edition',
    sponsorCopy: 'Bright yellow plastic so if you drop it while rollerblading, search and rescue can find it from space.'
  },
  // --- Question 7: Authentic Sound Byte (Terminator) ---
  {
    id: 'q_char_3',
    category: 'BAD GUYS IN BERLIN & BEYOND',
    title: 'Hasta La Vista, Player',
    question: '"I\'ll be back." When Arnold Schwarzenegger uttered these three words to a police station desk sergeant in 1984, what movie weapon did he drive through the front doors moments later?',
    type: 'SOUND_BYTE',
    soundByteQuote: 'I\'ll be back.',
    characterSilhouetteHint: 'Terminator',
    options: ['A full-sized station wagon / car', 'A military tank', 'A helicopter', 'A city garbage truck'],
    correctIndex: 0,
    basePoints: 1800,
    explanation: 'In 1984’s "The Terminator", after being told he cannot see Sarah Connor, the T-800 surveys the room, says "I’ll be back," and crashes a sedan right through the precinct reception desk.',
    hostIntroCommentary: 'Listen to this legendary action sound byte. If you do not get this, your cybernetic CPU needs defragmenting.',
    hostCorrectRoast: 'Target eliminated! You smashed that answer like an 80s cyborg through plate glass!',
    hostWrongRoast: 'Terminated! He drove a car straight through the lobby! Your points just went hasta la vista, baby.',
    sponsorTitle: 'Pound Puppies',
    sponsorCopy: 'Adopt a wrinkly plush puppy that comes with its own cardboard kennel and adoption certificate!'
  },
  // --- Question 8: Authentic Song Clip (The Final Countdown) ---
  {
    id: 'q_song_4',
    category: 'EPIC ARENA ROCK',
    title: 'The Brass Horns of Destiny',
    question: 'Listen to this clip from the actual song! Which Swedish rock band counted down to lift-off at the top of the European charts in 1986?',
    type: 'SONG_CLIP',
    audioClipKey: 'the_final_countdown',
    options: ['Europe ("The Final Countdown")', 'Scorpions ("Rock You Like a Hurricane")', 'Def Leppard ("Photograph")', 'Bon Jovi ("Livin\' On A Prayer")'],
    correctIndex: 0,
    basePoints: 2000,
    explanation: 'Europe’s "The Final Countdown" was built around a keyboard riff that Joey Tempest wrote on a borrowed Korg Polysix synthesizer while in college.',
    hostIntroCommentary: 'Bask in the glory of Swedish keyboard stadium bombast! Name this song clip or perish.',
    hostCorrectRoast: 'IT’S THE FINAL COUNTDOWN! You scored big time, rock star!',
    hostWrongRoast: 'Defeat! That was Europe’s "The Final Countdown"! The stadium rock gods weep for your blunder.',
    sponsorTitle: 'Aqua Net Super Extra Hold',
    sponsorCopy: 'Now in unscented—so your family only chokes on the chemicals, not the lavender.'
  }
];

export const JACK_ATTACK_DATA: JackAttackRound = {
  topic: '80s CATCHPHRASES & POP ICONS',
  clueRule: 'Match the iconic 80s character or person to what made them famous in the 80s! Shout your name or buzz in when you see a match!',
  pairs: [
    { clue: 'Mr. T / B.A. Baracus', match: '"I pity the fool!"', isCorrect: true },
    { clue: 'Mr. T / B.A. Baracus', match: '"Did I do that?"', isCorrect: false },
    { clue: 'Wendy\'s Grandma (Clara Peller)', match: '"Where\'s the beef?!"', isCorrect: true },
    { clue: 'Wendy\'s Grandma (Clara Peller)', match: '"Have it your way!"', isCorrect: false },
    { clue: 'Doc Brown', match: '"1.21 Gigawatts!"', isCorrect: true },
    { clue: 'Doc Brown', match: '"I am Iron Man!"', isCorrect: false },
    { clue: 'The Terminator', match: '"Hasta la vista, baby"', isCorrect: true },
    { clue: 'The Terminator', match: '"Beam me up, Scotty"', isCorrect: false },
    { clue: 'Alf', match: 'Hungry for cats & loves Melmac', isCorrect: true },
    { clue: 'Alf', match: 'Eats Reese\'s Pieces only', isCorrect: false },
    { clue: 'Pac-Man', match: 'Blinking Power Pellets & Inky', isCorrect: true },
    { clue: 'Pac-Man', match: 'Rescuing Princess Peach', isCorrect: false },
    { clue: 'Inspector Gadget', match: '"Go Go Gadget Copter!"', isCorrect: true },
    { clue: 'Inspector Gadget', match: '"Cowabunga, dude!"', isCorrect: false },
    { clue: 'Run-D.M.C.', match: '"My Adidas" & unlaced shell toes', isCorrect: true },
    { clue: 'Run-D.M.C.', match: '"U Can\'t Touch This"', isCorrect: false },
  ]
};
