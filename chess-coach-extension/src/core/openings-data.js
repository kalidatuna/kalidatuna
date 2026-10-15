/*
 * Curated opening book.
 *
 * Each entry is one named line, written as SAN moves from the start position.
 *   eco      ECO code (approximate family code for teaching purposes)
 *   name     Display name
 *   moves    Space-separated SAN
 *   why      Explains the final move(s) of the line - shown as the "book note"
 *   summary  What the opening is about (shown when it is the current opening)
 *   plans    { w: [...], b: [...] } plans for each side
 *   traps    Common tricks / mistakes to know
 *   notes    Optional { plyNumber: text } notes for intermediate moves of long lines
 *
 * Lines that extend another line inherit nothing automatically; each line's text
 * is written to stand on its own when it is the deepest match.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  CC.OPENINGS = [
    // ---------------------------------------------------------------- 1.e4
    {
      eco: 'B00', name: "King's Pawn Opening", moves: 'e4',
      why: 'Grabs central space, opens lines for the queen and the light-squared bishop.',
      summary: 'The most popular first move. It leads to open, tactical games where fast development and king safety matter most.',
      plans: { w: ['Follow up with Nf3, Bc4/Bb5 and castle quickly.', 'Try to add d4 to build a full pawn center.'], b: ['Fight for the center at once with ...e5, ...c5, ...e6 or ...c6.'] }
    },
    {
      eco: 'C20', name: "King's Pawn Game", moves: 'e4 e5',
      why: 'Mirrors White: claims its own share of the center and frees the dark-squared bishop and queen.',
      summary: 'Symmetrical open game. Both sides race to develop; the f7/f2 squares are early targets.',
      plans: { w: ['Attack e5 with Nf3, develop the kingside, castle.', 'Prepare d4 to challenge the center.'], b: ['Defend e5 (usually ...Nc6), develop, castle.', 'Watch the f7 square - it is defended only by the king.'] }
    },
    {
      eco: 'C20', name: 'Scholar\'s Mate Attempt', moves: 'e4 e5 Qh5',
      why: 'Early queen sortie: threatens Qxe5+ and, with Bc4, the Qxf7# mate.',
      summary: 'A beginner trap, not a good opening. Black defends simply and then gains time by attacking the exposed queen.',
      plans: { w: ['Objectively dubious; the queen can be chased.'], b: ['Defend e5 with ...Nc6, then answer Bc4 with ...g6 or ...Qe7.', 'Develop with tempo by hitting the queen (...g6, ...Nf6).'] },
      traps: ['After 3.Bc4, the move ...Nf6?? allows Qxf7# - play ...g6 or ...Qe7 instead.']
    },
    {
      eco: 'C20', name: 'Scholar\'s Mate Attempt: Defended', moves: 'e4 e5 Qh5 Nc6 Bc4 g6 Qf3 Nf6',
      why: 'Blocks the f-file pressure on f7 with a developing move. Black is now ahead in development.',
      summary: 'The correct way to meet the Scholar\'s Mate idea: block, develop, then chase the queen.',
      plans: { w: ['Retreat and develop normally; admit the queen trip cost time.'], b: ['Continue ...Bg7, ...O-O and ...d6; use ...Nd4 ideas to hit the queen.'] }
    },
    {
      eco: 'C40', name: "King's Knight Opening", moves: 'e4 e5 Nf3',
      why: 'Develops with a threat: the knight attacks the e5 pawn.',
      summary: 'The main road in 1.e4 e5. Black must defend or counter-attack e5.',
      plans: { w: ['Develop the bishop to c4 or b5 and castle.'], b: ['Defend e5 with ...Nc6 (most natural) or counter with ...Nf6 (Petrov).'] }
    },
    {
      eco: 'C44', name: "King's Knight Opening: Normal Variation", moves: 'e4 e5 Nf3 Nc6',
      why: 'Defends e5 while developing a knight toward the center - the most principled reply.',
      summary: 'Black defends e5 naturally. White now chooses between Bc4 (Italian), Bb5 (Ruy Lopez), d4 (Scotch) and others.',
      plans: { w: ['Pick a plan: Bc4 (fast attack on f7), Bb5 (long-term pressure on e5), or d4 (open the center).'], b: ['Develop the kingside pieces next and castle.'] }
    },
    {
      eco: 'C50', name: 'Italian Game', moves: 'e4 e5 Nf3 Nc6 Bc4',
      why: 'The bishop aims at f7, the weakest square in Black\'s camp, and prepares to castle.',
      summary: 'A classical opening with quick development. White eyes f7; Black chooses between ...Bc5 (Giuoco Piano) and ...Nf6 (Two Knights).',
      plans: { w: ['Castle, play c3 and d4 (or slow d3) to build the center.', 'Use Ng5 / Bxf7 tactics only when they really work.'], b: ['Develop with ...Bc5 or ...Nf6, castle, and challenge with ...d5 when possible.'] },
      traps: ['After 3...Nd4?! (Blackburne-Shilling), 4.Nxe5? Qg5! is a trap - just play 4.Nxd4 or 4.c3.']
    },
    {
      eco: 'C50', name: 'Italian Game: Giuoco Piano', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5',
      why: 'Mirrors White: the bishop also targets the f-pawn (f2) and prepares castling.',
      summary: '"The quiet game". Both bishops point at the enemy king\'s weak pawn. Central pawn moves (c3/d4 or d3) decide the character.',
      plans: { w: ['c3 + d4 for a big center (sharp), or c3 + d3 for a slow maneuvering game (Giuoco Pianissimo).'], b: ['...Nf6, ...d6, ...O-O; keep the bishop on the a7-g1 diagonal; meet d4 with exd4.'] }
    },
    {
      eco: 'C53', name: 'Italian Game: Giuoco Piano, Main Line', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3',
      why: 'Prepares d4 to build an ideal pawn center and gives the queen a path to b3.',
      summary: 'White is preparing d2-d4. Black must react: ...Nf6 hits e4 and is the main move.',
      plans: { w: ['Play d4 next; if exd4, recapture cxd4 to keep a broad center.'], b: ['...Nf6 to pressure e4, and ...d5 counter-strikes when safe.'] }
    },
    {
      eco: 'C54', name: 'Italian Game: Classical Variation', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+',
      why: 'Check gains time and pins/develops before White\'s center gets too strong.',
      summary: 'Sharp central play. White has a big center; Black hits it and the e4 pawn.',
      plans: { w: ['Block with Bd2 (solid) or Nc3 (gambit-ish Moller attack).'], b: ['Trade on d2 and strike at the center with ...d5.'] }
    },
    {
      eco: 'C50', name: 'Italian Game: Giuoco Pianissimo', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 d3',
      why: 'A quiet, solid move: protects e4 and keeps all options open for slow maneuvering.',
      summary: 'Modern "slow Italian" popular at all levels. Pieces maneuver; pawn breaks (d4, ...d5, b4, a4) come later.',
      plans: { w: ['c3, O-O, Re1, a4, Nbd2-f1-g3 maneuver; prepare d4 at the right moment.'], b: ['...Nf6, ...d6, ...O-O, ...a6, ...Ba7 keeps the bishop safe; prepare ...d5.'] }
    },
    {
      eco: 'C51', name: 'Evans Gambit', moves: 'e4 e5 Nf3 Nc6 Bc4 Bc5 b4',
      why: 'Offers a pawn to deflect Black\'s bishop and gain time for c3 and d4.',
      summary: 'A romantic gambit. White gives a pawn for rapid development and a strong center.',
      plans: { w: ['After ...Bxb4, play c3 and d4 with tempo, castle and attack.'], b: ['Accepting is fine: ...Bxb4 then ...Ba5; return the pawn later if needed to finish development.'] }
    },
    {
      eco: 'C55', name: 'Italian Game: Two Knights Defense', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6',
      why: 'Counter-attacks e4 instead of copying White; a sharper choice than ...Bc5.',
      summary: 'Black develops and counter-attacks. Ng5 (attacking f7) and d4 lead to tactics; d3 is the quiet option.',
      plans: { w: ['d3 (solid), d4 (sharp) or Ng5 (attack f7 - leads to the Fried Liver lines).'], b: ['Against Ng5, play ...d5! and after exd5 avoid ...Nxd5? - prefer ...Na5.'] },
      traps: ['After 4.Ng5 d5 5.exd5, the natural 5...Nxd5? allows 6.Nxf7! (Fried Liver). 5...Na5 is main line.']
    },
    {
      eco: 'C57', name: 'Two Knights: Knight Attack', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5',
      why: 'Double attack on f7 with knight and bishop. It breaks the rule "do not move a piece twice" but creates a direct threat.',
      summary: 'White attacks f7. Black must react precisely: ...d5 blocks the bishop.',
      plans: { w: ['If ...d5 exd5 Nxd5?, sacrifice Nxf7! or play d4 for a big attack.'], b: ['Play ...d5!, and after exd5 use ...Na5 to hit the bishop and gain development for the pawn.'] }
    },
    {
      eco: 'C58', name: 'Two Knights: Main Line (...Na5)', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5',
      why: 'Hits the c4 bishop; Black gives a pawn but gains time and active play.',
      summary: 'Black is a pawn down but White\'s knight and bishop have used many tempi. Black develops fast.',
      plans: { w: ['Bb5+ is standard; keep the extra pawn and finish development.'], b: ['...c6, ...h6 and ...e4 to kick White\'s pieces with gain of time.'] }
    },
    {
      eco: 'C57', name: 'Two Knights: Fried Liver Attack', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7',
      why: 'Knight sacrifice on f7 forks queen and rook and drags the black king into the open.',
      summary: 'A famous attacking trap. After ...Kxf7 Qf3+ the black king is very exposed. Great for learning king-hunt patterns.',
      plans: { w: ['Qf3+, Nc3 and d4: bring everything at the exposed king.'], b: ['Prevent this line earlier with 5...Na5 instead of 5...Nxd5.'] }
    },
    {
      eco: 'C55', name: 'Two Knights: Modern Bishop\'s Opening', moves: 'e4 e5 Nf3 Nc6 Bc4 Nf6 d3',
      why: 'Calmly defends e4 and avoids complications; similar to the slow Italian.',
      summary: 'Quiet, maneuvering structure.',
      plans: { w: ['c3, O-O, Re1, Nbd2 and later d4.'], b: ['...Bc5 or ...Be7, ...d6, ...O-O and maybe ...d5 later.'] }
    },
    {
      eco: 'C60', name: 'Ruy Lopez', moves: 'e4 e5 Nf3 Nc6 Bb5',
      why: 'Attacks the knight that defends e5, creating long-term pressure on Black\'s center.',
      summary: 'The "Spanish". One of the oldest and deepest openings. White builds slow pressure; Black aims for a solid but active setup.',
      plans: { w: ['Castle, Re1, c3 and d4. Retreat the bishop to a4/b3 when attacked.'], b: ['...a6 to question the bishop, or ...Nf6 (Berlin) to counter-attack e4.'] },
      traps: ['Bxc6 followed by Nxe5 does NOT win a pawn early: Black gets it back with ...Qd4 or ...Qg5 ideas.']
    },
    {
      eco: 'C70', name: 'Ruy Lopez: Morphy Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 a6',
      why: 'Asks the bishop to decide: trade on c6 or retreat. The pawn on a6 also gives ...b5 options.',
      summary: 'The main line. Black gains queenside space with ...b5 later.',
      plans: { w: ['Ba4 keeps the pin-like pressure; Bxc6 (Exchange) damages Black\'s pawns.'], b: ['...Nf6, ...Be7, ...b5, ...d6, ...O-O.'] }
    },
    {
      eco: 'C68', name: 'Ruy Lopez: Exchange Variation', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6',
      why: 'Recapturing away from the center with ...dxc6 opens the d-file for the queen and frees the c8 bishop.',
      summary: 'White gives the bishop pair for a better pawn structure (4 vs 3 on the kingside). Endgames favor White; Black has bishops.',
      plans: { w: ['O-O, d4 and trade pieces; the kingside majority matters in endgames.'], b: ['Use the bishop pair, ...f6 to hold e5, and develop quickly.'] }
    },
    {
      eco: 'C78', name: 'Ruy Lopez: Morphy Defense, Main Line', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O',
      why: 'Castling first: White does not fear ...Nxe4 because e5 becomes weak and Re1 regains the pawn.',
      summary: 'Standard Spanish position. Black usually plays ...Be7 (Closed) or ...Nxe4 (Open).',
      plans: { w: ['Re1, c3, h3 and d4.'], b: ['...Be7, ...b5, ...d6, ...O-O - the Closed Spanish setup.'] },
      notes: { 7: 'Retreating keeps the bishop on the a4-e8 diagonal so the pressure on c6 continues.', 8: 'Develops and counter-attacks e4.' }
    },
    {
      eco: 'C84', name: 'Ruy Lopez: Closed', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3',
      why: 'Prevents ...Bg4 (pinning the f3 knight) so White can play d4 without losing control of the center.',
      summary: 'The classical tabiya of the Ruy Lopez. Rich maneuvering positions: Nbd2-f1-g3, while Black plays ...Na5/...c5 or ...Nb8-d7.',
      plans: { w: ['d4, Nbd2-f1-g3, and a kingside attack; a4 to pressure b5.'], b: ['...Na5 + ...c5 (Chigorin), ...Bb7 (Zaitsev) or ...Nb8 (Breyer).'] },
      notes: { 10: 'Develops and prepares castling.', 11: 'The rook defends e4 so the threat of ...Nxe4 disappears.', 12: 'Gains space and kicks the bishop.', 13: 'The bishop moves to b3 where it still points at f7.', 14: 'Supports e5 and opens the c8 bishop.', 15: 'Prepares d4 and gives the bishop a retreat square on c2.', 16: 'King to safety.' }
    },
    {
      eco: 'C80', name: 'Ruy Lopez: Open', moves: 'e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4',
      why: 'Black grabs the e4 pawn. It is not really winning a pawn - White regains it - but Black gets free piece play.',
      summary: 'Dynamic line with open lines and active pieces.',
      plans: { w: ['d4, Re1 or Qe2 to regain material and attack the centralized knight.'], b: ['...b5, ...d5 to support the e4 knight; develop fast.'] }
    },
    {
      eco: 'C65', name: 'Ruy Lopez: Berlin Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6',
      why: 'Counter-attacks e4 immediately instead of ...a6. Extremely solid.',
      summary: 'The "Berlin Wall": a rock-solid defense used at the top level. Often leads to an early queen trade.',
      plans: { w: ['O-O then d4 or the quiet d3.'], b: ['After O-O, ...Nxe4 is fine: d4 Nd6 Bxc6 dxc6 dxe5 Nf5 - the Berlin endgame.'] }
    },
    {
      eco: 'C64', name: 'Ruy Lopez: Classical Defense', moves: 'e4 e5 Nf3 Nc6 Bb5 Bc5',
      why: 'Active bishop development aiming at f2.',
      summary: 'A less common but sound line. White plays c3 and d4 to gain tempo on the bishop.',
      plans: { w: ['O-O, c3 and d4.'], b: ['...Nf6 / ...Nd4 and fast castling.'] }
    },
    {
      eco: 'C45', name: 'Scotch Game', moves: 'e4 e5 Nf3 Nc6 d4',
      why: 'Opens the center immediately and attacks e5 twice.',
      summary: 'Direct central play. After ...exd4 Nxd4, White has a free game with a strong knight on d4.',
      plans: { w: ['After 3...exd4 4.Nxd4, develop quickly: Nc3, Be2/Bc4, O-O.'], b: ['...exd4, then hit the d4 knight with ...Nf6/...Bc5 and develop.'] }
    },
    {
      eco: 'C45', name: 'Scotch Game: Main Line', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Nxd4',
      why: 'Recaptures and centralizes the knight.',
      summary: 'Black chooses ...Bc5 (Classical) or ...Nf6 (Schmidt). Both attack the centralized knight or e4.',
      plans: { w: ['Keep the knight active; Nxc6 + e5 ideas vs ...Nf6.'], b: ['...Bc5 (attacking d4) or ...Nf6 (attacking e4).'] }
    },
    {
      eco: 'C44', name: 'Scotch Gambit', moves: 'e4 e5 Nf3 Nc6 d4 exd4 Bc4',
      why: 'Develops instead of recapturing; White offers a pawn for development and attack on f7.',
      summary: 'Gambit play combining Scotch and Italian ideas.',
      plans: { w: ['c3 or O-O, fast development, pressure on f7.'], b: ['...Nf6 or ...Bc5; return the pawn if it helps to castle safely.'] }
    },
    {
      eco: 'C44', name: 'Ponziani Opening', moves: 'e4 e5 Nf3 Nc6 c3',
      why: 'Prepares d4 for a big pawn center; a rare but sound idea.',
      summary: 'White wants d4. Black should counter-attack fast with ...Nf6 or ...d5.',
      plans: { w: ['d4 next; Qa4 ideas.'], b: ['...Nf6 hitting e4, or ...d5 striking the center.'] }
    },
    {
      eco: 'C46', name: 'Four Knights Game', moves: 'e4 e5 Nf3 Nc6 Nc3 Nf6',
      why: 'Symmetrical development: both sides bring out both knights first.',
      summary: 'Solid and principled. White often continues Bb5 (Spanish Four Knights) or d4 (Scotch Four Knights).',
      plans: { w: ['Bb5 and O-O, or d4 to open the center.'], b: ['Copy carefully: ...Bb4, ...O-O, ...d6. Watch for Nd5 jumps.'] }
    },
    {
      eco: 'C42', name: 'Petrov\'s Defense', moves: 'e4 e5 Nf3 Nf6',
      why: 'Counter-attacks e4 instead of defending e5. Very solid.',
      summary: 'The "Russian Game". Black plays for equality with symmetrical structures.',
      plans: { w: ['3.Nxe5 d6! 4.Nf3 Nxe4 5.d4 is the main line; or 3.d4.'], b: ['After 3.Nxe5, play ...d6 FIRST - not 3...Nxe4? 4.Qe2! winning material.'] },
      traps: ['3.Nxe5 Nxe4?? 4.Qe2! and if the knight moves, Nc6+ uncovers an attack on the queen.']
    },
    {
      eco: 'C41', name: 'Philidor Defense', moves: 'e4 e5 Nf3 d6',
      why: 'Defends e5 with a pawn - solid but a little passive, it blocks the f8 bishop.',
      summary: 'A compact setup. White gets more space; Black aims for a sturdy position with ...Nf6, ...Nbd7, ...Be7.',
      plans: { w: ['d4 and Nc3, Bc4: use the space advantage.'], b: ['...Nf6, ...Nbd7, ...Be7, ...O-O, ...c6 (Hanham setup).'] },
      traps: ['In the Philidor, ...Be7 before ...Nf6 or careless ...Nbd7 can allow Bxf7+ tactics.']
    },
    {
      eco: 'C40', name: 'Latvian Gambit', moves: 'e4 e5 Nf3 f5',
      why: 'A very risky counter-gambit weakening Black\'s king.',
      summary: 'Objectively dubious. White should calmly take control with Nxe5.',
      plans: { w: ['3.Nxe5 and Qh5+ ideas; develop and exploit the weakened e8-h5 diagonal.'], b: ['Fight for initiative; very sharp.'] }
    },
    {
      eco: 'C30', name: "King's Gambit", moves: 'e4 e5 f4',
      why: 'Offers the f-pawn to deflect e5 and open the f-file for an attack.',
      summary: 'Romantic and sharp. White gives a pawn for the center and open f-file; king safety is a concern for both.',
      plans: { w: ['Nf3, d4, Bc4 and O-O; attack along the f-file.'], b: ['Accept with ...exf4 and develop, or decline with ...Bc5 / ...d5.'] }
    },
    {
      eco: 'C33', name: "King's Gambit Accepted", moves: 'e4 e5 f4 exf4',
      why: 'Takes the pawn. Black can try to hold it with ...g5 or return it for development.',
      summary: 'Classic sharp battle.',
      plans: { w: ['Nf3 (stops ...Qh4+), d4 and Bxf4 to regain the pawn with a great center.'], b: ['...d5 (giving back the pawn) or ...g5 to keep it.'] }
    },
    {
      eco: 'C31', name: "King's Gambit Declined: Falkbeer", moves: 'e4 e5 f4 d5',
      why: 'Counter-gambit: strikes the center instead of accepting.',
      summary: 'Black fights for the initiative immediately.',
      plans: { w: ['exd5 and Nf3; keep the center.'], b: ['...e4 or ...exf4 depending on the line; develop quickly.'] }
    },
    {
      eco: 'C25', name: 'Vienna Game', moves: 'e4 e5 Nc3',
      why: 'Develops a knight and keeps f4 available for a delayed King\'s Gambit.',
      summary: 'Flexible. White can go for f4 attacks or a quiet Bc4/g3 setup.',
      plans: { w: ['Bc4 or f4 (Vienna Gambit), or g3 + Bg2.'], b: ['...Nf6 and ...d5 at the right moment; ...Nc6 / ...Bc5.'] }
    },
    {
      eco: 'C29', name: 'Vienna Gambit', moves: 'e4 e5 Nc3 Nf6 f4',
      why: 'Delayed King\'s Gambit: f4 now with a knight already developed.',
      summary: 'Sharp. Black\'s best reply is ...d5! hitting the center.',
      plans: { w: ['After ...d5, fxe5 Nxe4 Nf3: active pieces.'], b: ['...d5! to counter-strike in the center.'] }
    },
    {
      eco: 'C23', name: "Bishop's Opening", moves: 'e4 e5 Bc4',
      why: 'Puts the bishop on its best diagonal right away, eyeing f7.',
      summary: 'Flexible; can transpose to Italian or Vienna setups.',
      plans: { w: ['d3, Nf3, O-O or Nc3 + f4 ideas.'], b: ['...Nf6 hitting e4, then ...c6 and ...d5 for central play.'] }
    },
    {
      eco: 'C21', name: 'Center Game', moves: 'e4 e5 d4 exd4 Qxd4',
      why: 'Recaptures with the queen - central but exposed to ...Nc6 with tempo.',
      summary: 'White develops the queen early; Black gains time by hitting it.',
      plans: { w: ['Qe3, Nc3, Bd2 and O-O-O.'], b: ['...Nc6 with tempo, ...Nf6, ...Bb4/...Be7 and quick castling.'] }
    },
    {
      eco: 'C21', name: 'Danish Gambit', moves: 'e4 e5 d4 exd4 c3',
      why: 'Offers more pawns for a huge lead in development and two raking bishops.',
      summary: 'Very sharp gambit. Black can accept, but returning material with ...d5 is the safe approach.',
      plans: { w: ['Bc4, Bxb2 and a direct kingside attack.'], b: ['...d5! returning the pawn and developing quickly is safest.'] }
    },

    // Sicilian
    {
      eco: 'B20', name: 'Sicilian Defense', moves: 'e4 c5',
      why: 'Fights for d4 from the side, creating an unbalanced position.',
      summary: 'The most popular reply to 1.e4. Imbalances: White often attacks on the kingside, Black counterattacks on the queenside and uses the half-open c-file.',
      plans: { w: ['Nf3 and d4 (Open Sicilian), or alternatives like c3 (Alapin), Nc3 (Closed).'], b: ['Trade the c-pawn for White\'s d-pawn (more central pawns), use the c-file.'] }
    },
    {
      eco: 'B27', name: 'Sicilian Defense: 2.Nf3', moves: 'e4 c5 Nf3',
      why: 'Develops and prepares d4.',
      summary: 'Black chooses a system with ...d6, ...Nc6 or ...e6.',
      plans: { w: ['d4 next to open the position.'], b: ['...d6 (Najdorf/Dragon), ...Nc6 (Classical/Sveshnikov) or ...e6 (Kan/Taimanov).'] }
    },
    {
      eco: 'B50', name: 'Sicilian Defense: 2...d6', moves: 'e4 c5 Nf3 d6',
      why: 'Controls e5 and prepares ...Nf6 without allowing e5 kicks.',
      summary: 'Leads to Najdorf, Dragon, Classical and Scheveningen setups after d4.',
      plans: { w: ['d4 cxd4 Nxd4 Nf6 Nc3 - the Open Sicilian.'], b: ['...cxd4, ...Nf6 and then a/your chosen system.'] }
    },
    {
      eco: 'B54', name: 'Open Sicilian', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4',
      why: 'White opens the center; Black has traded a wing pawn for a central pawn.',
      summary: 'Lead in development for White vs. long-term structural pluses for Black (two central pawns, half-open c-file).',
      plans: { w: ['Nc3, then choose Be3/f3/Qd2/O-O-O (English Attack/Yugoslav) or Bg5 lines and attack.'], b: ['...Nf6 to hit e4, then pick a system.'] }
    },
    {
      eco: 'B56', name: 'Open Sicilian: Main Position', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3',
      why: 'Defends e4 and develops. Now Black picks the system with move 5.',
      summary: 'Key crossroads: 5...a6 Najdorf, 5...g6 Dragon, 5...Nc6 Classical, 5...e6 Scheveningen.',
      plans: { w: ['Be3, f3, Qd2, O-O-O and g4 against most setups.'], b: ['Choose your setup and play for ...d5 or queenside counterplay.'] }
    },
    {
      eco: 'B90', name: 'Sicilian: Najdorf Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
      why: 'Keeps White\'s pieces off b5, prepares ...e5 or ...b5 - flexible and ambitious.',
      summary: 'The most famous Sicilian. Black waits to see White\'s setup, then plays ...e5 or ...e6 and queenside expansion.',
      plans: { w: ['English Attack (Be3, f3, Qd2, O-O-O, g4) or 6.Bg5 / 6.Be2.'], b: ['...e5 or ...e6, ...b5, ...Bb7, ...Nbd7 and counterplay on the c-file.'] }
    },
    {
      eco: 'B70', name: 'Sicilian: Dragon Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6',
      why: 'Prepares ...Bg7: the "Dragon" bishop rakes the long diagonal toward White\'s queenside.',
      summary: 'Sharp opposite-side castling races are typical (Yugoslav Attack).',
      plans: { w: ['Be3, f3, Qd2, O-O-O, h4-h5 and Bh6 to trade the dragon bishop.'], b: ['...Bg7, ...O-O, ...Nc6, ...Rc8 and ...Rxc3 exchange sacrifices.'] }
    },
    {
      eco: 'B57', name: 'Sicilian: Classical Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6',
      why: 'Develops the knight to its natural square and hits the d4 knight.',
      summary: 'Black develops classically; White chooses Bg5 (Richter-Rauzer) or Bc4 (Sozin).',
      plans: { w: ['Bg5 + Qd2 + O-O-O, or Bc4 aimed at f7/e6.'], b: ['...e6, ...Be7, ...O-O, ...a6 and ...Qc7.'] }
    },
    {
      eco: 'B80', name: 'Sicilian: Scheveningen Variation', moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6',
      why: 'A small but solid center: pawns on d6 and e6 control key squares.',
      summary: 'Flexible "small center". White often plays g4 (Keres Attack) or the English Attack.',
      plans: { w: ['g4-g5 (Keres) or Be3, f3, Qd2.'], b: ['...a6, ...Qc7, ...Nc6, ...Be7, ...O-O; break with ...d5 or ...b5.'] }
    },
    {
      eco: 'B30', name: 'Sicilian Defense: Old Sicilian', moves: 'e4 c5 Nf3 Nc6',
      why: 'Develops and keeps options for ...e5 (Sveshnikov) or ...g6 (Accelerated Dragon).',
      summary: 'Flexible move order. White may go d4 (Open) or Bb5 (Rossolimo).',
      plans: { w: ['d4 or Bb5.'], b: ['After d4 cxd4 Nxd4: ...Nf6, ...e5 (Sveshnikov) or ...g6 (Accelerated Dragon).'] }
    },
    {
      eco: 'B33', name: 'Sicilian: Sveshnikov Variation', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5',
      why: 'Kicks the d4 knight and grabs central space, accepting a hole on d5.',
      summary: 'Dynamic: Black accepts a backward d-pawn and d5 hole in exchange for active pieces and the bishop pair.',
      plans: { w: ['Ndb5, Bg5, Nd5: control the d5 hole.'], b: ['...d6, ...a6, ...b5, ...f5: fight back against d5 and attack.'] }
    },
    {
      eco: 'B35', name: 'Sicilian: Accelerated Dragon', moves: 'e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6',
      why: 'Dragon fianchetto without ...d6, keeping ...d5 in one move.',
      summary: 'Black saves a tempo on ...d6 to strike with ...d5. White can play c4 (Maroczy Bind) to restrain.',
      plans: { w: ['c4 (Maroczy Bind) for a space advantage, or Nc3, Be3, Bc4.'], b: ['...Bg7, ...Nf6, ...O-O and ...d5 when possible.'] }
    },
    {
      eco: 'B31', name: 'Sicilian: Rossolimo Variation', moves: 'e4 c5 Nf3 Nc6 Bb5',
      why: 'Avoids the Open Sicilian; plans Bxc6 to damage Black\'s pawns.',
      summary: 'Positional anti-Sicilian.',
      plans: { w: ['O-O, Re1, c3 and d4, or Bxc6 + d3.'], b: ['...g6 + ...Bg7, or ...e6 + ...Nge7; keep the bishop pair if possible.'] }
    },
    {
      eco: 'B40', name: 'Sicilian Defense: French Variation', moves: 'e4 c5 Nf3 e6',
      why: 'Prepares ...d5 and keeps the f8 bishop flexible.',
      summary: 'Leads to the Kan (...a6) and Taimanov (...Nc6) systems after d4.',
      plans: { w: ['d4 cxd4 Nxd4, then Nc3 or c4.'], b: ['...a6 (Kan) or ...Nc6 (Taimanov); later ...Qc7 and ...b5.'] }
    },
    {
      eco: 'B46', name: 'Sicilian: Taimanov Variation', moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6',
      why: 'Develops and challenges the d4 knight; very flexible.',
      summary: 'Black keeps options of ...Qc7, ...a6 and ...Nf6 or ...Bb4.',
      plans: { w: ['Nc3, Be3, Qd2/Qf3 and O-O-O.'], b: ['...Qc7, ...a6, ...Nf6 and ...Bb4 pressure on e4.'] }
    },
    {
      eco: 'B41', name: 'Sicilian: Kan Variation', moves: 'e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6',
      why: 'Controls b5 and prepares ...Qc7/...b5 without committing the pieces.',
      summary: 'Very flexible hedgehog-like setups.',
      plans: { w: ['Bd3 + O-O + c4 (Maroczy-style).'], b: ['...Qc7, ...Nf6, ...b5, ...Bb7.'] }
    },
    {
      eco: 'B22', name: 'Sicilian: Alapin Variation', moves: 'e4 c5 c3',
      why: 'Prepares d4 so that White can recapture with a pawn and keep a full center.',
      summary: 'A popular anti-Sicilian. Black usually strikes the center at once with ...d5 or ...Nf6.',
      plans: { w: ['d4; recapture cxd4 for an ideal center.'], b: ['...Nf6 (hitting e4) or ...d5 (Qxd5 lines).'] }
    },
    {
      eco: 'B23', name: 'Sicilian: Closed Variation', moves: 'e4 c5 Nc3',
      why: 'Keeps the center closed and prepares g3/Bg2 or f4 setups.',
      summary: 'Slower, kingside-oriented play for White.',
      plans: { w: ['g3, Bg2, d3, f4 and Nf3 - then a kingside attack.'], b: ['...Nc6, ...g6, ...Bg7, ...d6; queenside expansion with ...Rb8 and ...b5.'] }
    },
    {
      eco: 'B21', name: 'Sicilian: Smith-Morra Gambit', moves: 'e4 c5 d4 cxd4 c3',
      why: 'Offers a pawn for a lead in development and open c- and d-files.',
      summary: 'Aggressive gambit popular in club play.',
      plans: { w: ['Nxc3, Nf3, Bc4, O-O, Qe2, Rd1 and pressure on d6/f7.'], b: ['Accept and develop carefully (...Nc6, ...d6, ...e6, ...Nf6), or decline with ...Nf6/...d5.'] }
    },

    // French
    {
      eco: 'C00', name: 'French Defense', moves: 'e4 e6',
      why: 'Prepares ...d5 with a solid pawn chain, accepting a passive light-squared bishop.',
      summary: 'Solid and counterattacking. Black challenges White\'s center with ...d5, then ...c5 and ...f6 breaks.',
      plans: { w: ['d4 and Nc3/Nd2/e5 - build the center.'], b: ['...d5, then attack the base of White\'s pawn chain with ...c5.'] }
    },
    {
      eco: 'C00', name: 'French Defense: Normal', moves: 'e4 e6 d4 d5',
      why: 'Attacks e4 from a protected square.',
      summary: 'White must decide what to do with e4: defend it (Nc3/Nd2), push it (e5) or trade it (exd5).',
      plans: { w: ['Nc3 (main), Nd2 (Tarrasch), e5 (Advance) or exd5 (Exchange).'], b: ['Hit the center with ...c5 and ...f6 at the right moments.'] }
    },
    {
      eco: 'C02', name: 'French: Advance Variation', moves: 'e4 e6 d4 d5 e5',
      why: 'Gains space and cramps Black; but the pawn chain can be attacked.',
      summary: 'Classic pawn-chain battle. Black attacks d4 with ...c5, ...Nc6, ...Qb6.',
      plans: { w: ['c3, Nf3, Bd3/Be2: hold d4 and attack on the kingside.'], b: ['...c5, ...Nc6, ...Qb6 pressure on d4; later ...f6.'] },
      traps: ['In the Advance, careless Bd3 can drop d4: ...cxd4 cxd4 Qb6 / ...Nxd4 ideas.']
    },
    {
      eco: 'C01', name: 'French: Exchange Variation', moves: 'e4 e6 d4 d5 exd5 exd5',
      why: 'Releases the tension and creates a symmetrical structure; Black\'s c8 bishop is freed.',
      summary: 'Quiet and symmetrical. Easy development for both sides.',
      plans: { w: ['Bd3, Nf3, O-O, c4 ideas to create imbalance.'], b: ['...Bd6, ...Nf6, ...O-O, ...Bg4; develop actively.'] }
    },
    {
      eco: 'C10', name: 'French: Paris/Main (3.Nc3)', moves: 'e4 e6 d4 d5 Nc3',
      why: 'Defends e4 with a developing move.',
      summary: 'Main line. Black chooses Winawer (...Bb4), Classical (...Nf6) or Rubinstein (...dxe4).',
      plans: { w: ['e5 or Bg5 depending on Black\'s reply.'], b: ['...Bb4 (pin), ...Nf6 or ...dxe4.'] }
    },
    {
      eco: 'C15', name: 'French: Winawer Variation', moves: 'e4 e6 d4 d5 Nc3 Bb4',
      why: 'Pins the c3 knight, adding pressure to e4.',
      summary: 'Very sharp. White often gets the bishop pair and doubled c-pawns after a3 Bxc3+ bxc3.',
      plans: { w: ['e5, a3, Qg4 attacking g7.'], b: ['...c5, ...Ne7, ...Qc7 and queenside play.'] }
    },
    {
      eco: 'C11', name: 'French: Classical Variation', moves: 'e4 e6 d4 d5 Nc3 Nf6',
      why: 'Develops and attacks e4 again.',
      summary: 'White chooses e5 (Steinitz) or Bg5 (pin).',
      plans: { w: ['e5 + f4 (Steinitz) or Bg5.'], b: ['...c5 and ...Nc6 vs the center; ...f6 break.'] }
    },
    {
      eco: 'C03', name: 'French: Tarrasch Variation', moves: 'e4 e6 d4 d5 Nd2',
      why: 'Defends e4 without allowing the ...Bb4 pin.',
      summary: 'Solid for White. Black often gets an isolated d-pawn after ...c5.',
      plans: { w: ['Ngf3, Bd3/Bb5 and pressure on an isolated d5 pawn.'], b: ['...c5 or ...Nf6; active piece play vs the IQP.'] }
    },

    // Caro-Kann
    {
      eco: 'B10', name: 'Caro-Kann Defense', moves: 'e4 c6',
      why: 'Prepares ...d5 while keeping the c8 bishop free (unlike the French).',
      summary: 'Very solid. Black gets a sound structure and develops the light bishop before ...e6.',
      plans: { w: ['d4 and then Nc3, e5 (Advance) or exd5 (Exchange).'], b: ['...d5, develop the c8 bishop to f5/g4, then ...e6.'] }
    },
    {
      eco: 'B12', name: 'Caro-Kann Defense: Main', moves: 'e4 c6 d4 d5',
      why: 'Challenges e4 with support from the c6 pawn.',
      summary: 'White picks Advance (e5), Classical (Nc3/Nd2) or Exchange (exd5).',
      plans: { w: ['e5, Nc3 or exd5.'], b: ['Develop the light bishop outside the pawn chain.'] }
    },
    {
      eco: 'B12', name: 'Caro-Kann: Advance Variation', moves: 'e4 c6 d4 d5 e5',
      why: 'Gains space; the trade-off is that Black\'s bishop comes to f5 freely.',
      summary: 'Black plays ...Bf5, ...e6 and ...c5 against White\'s pawn chain.',
      plans: { w: ['Nf3, Be2, O-O; or sharp g4/h4 lines hitting the f5 bishop.'], b: ['...Bf5, ...e6, ...c5 and ...Nc6.'] }
    },
    {
      eco: 'B18', name: 'Caro-Kann: Classical Variation', moves: 'e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5',
      why: 'Develops the bishop with tempo on the e4 knight.',
      summary: 'Solid classical line. White gains space with h4-h5; Black stays compact.',
      plans: { w: ['Ng3, h4-h5, Nf3, Bd3 and queenside castling.'], b: ['...Bg6/h7, ...Nd7, ...Ngf6, ...e6 and solid play.'] }
    },
    {
      eco: 'B13', name: 'Caro-Kann: Exchange Variation', moves: 'e4 c6 d4 d5 exd5 cxd5',
      why: 'Black recaptures with the c-pawn, keeping a central pawn.',
      summary: 'Symmetrical-ish. White often plays Bd3, c3 (Carlsbad structure); or c4 (Panov) for an IQP.',
      plans: { w: ['Bd3, c3, Bf4 / or c4 Panov-Botvinnik attack.'], b: ['...Nc6, ...Nf6, ...Bg4; minority-attack style play.'] }
    },

    // Others vs e4
    {
      eco: 'B01', name: 'Scandinavian Defense', moves: 'e4 d5',
      why: 'Immediately challenges e4.',
      summary: 'After exd5 Qxd5 Black develops the queen early but gets a simple structure.',
      plans: { w: ['exd5 then Nc3 with tempo on the queen.'], b: ['...Qxd5, ...Qa5/Qd6, ...Nf6, ...Bf5/g4, ...c6.'] }
    },
    {
      eco: 'B01', name: 'Scandinavian: Main Line', moves: 'e4 d5 exd5 Qxd5 Nc3 Qa5',
      why: 'The queen retreats to a safe active square, pinning the c3 knight indirectly.',
      summary: 'Black accepts losing a tempo; plans ...Nf6, ...c6, ...Bf5.',
      plans: { w: ['d4, Nf3, Bc4/Bd2: develop with tempo.'], b: ['...Nf6, ...c6, ...Bf5 and ...e6.'] }
    },
    {
      eco: 'B01', name: 'Scandinavian: Modern Variation', moves: 'e4 d5 exd5 Nf6',
      why: 'Recaptures with a knight instead of the queen.',
      summary: 'White can try to keep the pawn (c4) but this gives Black development.',
      plans: { w: ['d4 and Nf3, avoiding greed.'], b: ['...Nxd5 and fast development.'] }
    },
    {
      eco: 'B02', name: 'Alekhine Defense', moves: 'e4 Nf6',
      why: 'Provokes White\'s pawns forward to attack them later.',
      summary: 'Hypermodern: let White build a center, then undermine it.',
      plans: { w: ['e5, d4, c4 (and maybe f4) - but don\'t overextend.'], b: ['...Nd5, ...d6, attack the pawns with ...Bg4, ...Nc6, ...dxe5.'] }
    },
    {
      eco: 'B07', name: 'Pirc Defense', moves: 'e4 d6 d4 Nf6 Nc3 g6',
      why: 'Fianchetto setup: lets White take the center and plans to strike back later.',
      summary: 'Hypermodern defense. Black plays ...Bg7, ...O-O, then ...c5 or ...e5.',
      plans: { w: ['f4 (Austrian Attack), or Be3/Qd2/f3 and O-O-O.'], b: ['...Bg7, ...O-O, ...c6/...c5 or ...e5 breaks.'] }
    },
    {
      eco: 'B06', name: 'Modern Defense', moves: 'e4 g6',
      why: 'Fianchetto first; very flexible.',
      summary: 'Similar ideas to the Pirc but more flexible move order.',
      plans: { w: ['d4, Nc3, Be3, Qd2 setups.'], b: ['...Bg7, ...d6, ...c6/...a6 and queenside play.'] }
    },

    // ---------------------------------------------------------------- 1.d4
    {
      eco: 'A40', name: "Queen's Pawn Opening", moves: 'd4',
      why: 'Claims the center with a pawn that is already protected by the queen.',
      summary: 'Leads to more strategic, closed positions than 1.e4.',
      plans: { w: ['c4 (Queen\'s Gambit), or Nf3 / Bf4 systems.'], b: ['...d5 or ...Nf6 and a solid setup.'] }
    },
    {
      eco: 'D00', name: "Queen's Pawn Game", moves: 'd4 d5',
      why: 'Stops White from playing e4 easily and stakes an equal share of the center.',
      summary: 'Classical symmetrical center.',
      plans: { w: ['c4 (Queen\'s Gambit) or Bf4/Nf3 (London).'], b: ['...Nf6, ...e6 or ...c6; develop and castle.'] }
    },
    {
      eco: 'D06', name: "Queen's Gambit", moves: 'd4 d5 c4',
      why: 'Offers a wing pawn to deflect Black\'s d-pawn from the center.',
      summary: 'Not a real gambit: if Black takes, White usually regains the pawn. The fight is about the center.',
      plans: { w: ['Nc3, Nf3, Bg5/Bf4, e3; pressure on d5.'], b: ['Hold d5 with ...e6 (QGD) or ...c6 (Slav), or take with ...dxc4 (QGA).'] }
    },
    {
      eco: 'D30', name: "Queen's Gambit Declined", moves: 'd4 d5 c4 e6',
      why: 'Supports d5 solidly; the price is a temporarily blocked c8 bishop.',
      summary: 'Classical and very solid. Black aims for ...Nf6, ...Be7, ...O-O and freeing breaks ...c5 or ...e5.',
      plans: { w: ['Nc3, Bg5, e3, Nf3; minority attack (b4-b5) in the Exchange structure.'], b: ['...Nf6, ...Be7, ...O-O, ...Nbd7, then ...c5 or ...dxc4 + ...e5.'] }
    },
    {
      eco: 'D35', name: 'QGD: Exchange Variation', moves: 'd4 d5 c4 e6 Nc3 Nf6 cxd5 exd5',
      why: 'White clarifies the center, creating the Carlsbad structure.',
      summary: 'Typical plans: minority attack for White, kingside play for Black.',
      plans: { w: ['Bg5, e3, Bd3, Qc2, then b4-b5 (minority attack).'], b: ['...c6, ...Be7, ...Nbd7, ...Re8, ...Nf8-g6 and kingside chances.'] }
    },
    {
      eco: 'D37', name: 'QGD: Main Line', moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 Be7',
      why: 'Breaks the pin calmly and prepares castling.',
      summary: 'Classical QGD. Black often plays ...h6, ...O-O and ...Nbd7 or the Tartakower ...b6.',
      plans: { w: ['e3, Nf3, Rc1, Bd3 and central pressure.'], b: ['...O-O, ...h6, ...b6 or ...Ne4 freeing exchanges.'] }
    },
    {
      eco: 'D20', name: "Queen's Gambit Accepted", moves: 'd4 d5 c4 dxc4',
      why: 'Takes the pawn, giving up the center temporarily to develop freely.',
      summary: 'Black should not try to hold the pawn with ...b5; instead develop and strike with ...c5.',
      plans: { w: ['e3/e4, Bxc4 and use the central majority.'], b: ['...Nf6, ...e6, ...c5, ...a6 and ...b5 at the right moment.'] },
      traps: ['Holding the pawn with ...b5 often loses to a4 and Qf3 or Qb3 tricks.']
    },
    {
      eco: 'D10', name: 'Slav Defense', moves: 'd4 d5 c4 c6',
      why: 'Supports d5 while keeping the c8 bishop free to develop.',
      summary: 'Solid like the QGD but with the light-squared bishop free. Black may take on c4 and try to keep it with ...b5.',
      plans: { w: ['Nf3, Nc3, e3; a4 to stop ...b5 after ...dxc4.'], b: ['...Nf6, ...dxc4 + ...Bf5, or ...e6 (Semi-Slav).'] }
    },
    {
      eco: 'D43', name: 'Semi-Slav Defense', moves: 'd4 d5 c4 c6 Nf3 Nf6 Nc3 e6',
      why: 'Combines ...c6 and ...e6: very solid, with ...dxc4 and ...b5 ideas.',
      summary: 'Rich and sharp (Meran, Moscow, Botvinnik lines).',
      plans: { w: ['e3 + Bd3 (Meran) or Bg5 (Moscow/Botvinnik).'], b: ['...dxc4, ...b5, ...Bb7, ...a6 and ...c5.'] }
    },
    {
      eco: 'D02', name: 'London System', moves: 'd4 d5 Bf4',
      why: 'Develops the bishop outside the pawn chain before e3.',
      summary: 'A system opening: White aims for the same easy setup (e3, Nf3, Bd3, c3, Nbd2) against almost anything.',
      plans: { w: ['e3, Nf3, c3, Bd3, Nbd2 and Ne5 or h3; kingside attack ideas.'], b: ['...c5 + ...Qb6 hitting b2, or ...Nh5 / ...Bd6 to challenge the bishop.'] },
      traps: ['After ...c5, careless Nf3 can allow ...Qb6 attacking b2 and d4 together.']
    },
    {
      eco: 'D02', name: 'London System (vs ...Nf6)', moves: 'd4 Nf6 Bf4',
      why: 'Same London idea against ...Nf6.',
      summary: 'White sets up e3, Nf3, c3, Bd3 regardless of Black\'s system.',
      plans: { w: ['e3, Nf3, c3, Bd3, Nbd2, O-O.'], b: ['...c5 + ...Qb6, or a ...g6/...Bg7 King\'s Indian setup.'] }
    },
    {
      eco: 'A45', name: 'Indian Defense', moves: 'd4 Nf6',
      why: 'Develops and stops e4 without committing a central pawn.',
      summary: 'Gateway to the King\'s Indian, Nimzo-Indian, Queen\'s Indian, Grünfeld and more.',
      plans: { w: ['c4 and Nc3/Nf3; or system play (London, Trompowsky).'], b: ['Choose: ...e6 (Nimzo/QID), ...g6 (KID/Grünfeld), ...c5 (Benoni).'] }
    },
    {
      eco: 'A50', name: 'Indian Defense: Normal', moves: 'd4 Nf6 c4',
      why: 'Gains more central control and prepares Nc3 and e4.',
      summary: 'The main road for the Indian defenses.',
      plans: { w: ['Nc3 + e4 if allowed.'], b: ['...e6 or ...g6, depending on your repertoire.'] }
    },
    {
      eco: 'E60', name: "King's Indian Defense", moves: 'd4 Nf6 c4 g6',
      why: 'Prepares ...Bg7 and lets White build a center to attack it later.',
      summary: 'Hypermodern and combative. Black allows a big White center, then strikes with ...e5 or ...c5 and often attacks the king.',
      plans: { w: ['Nc3, e4, Nf3, Be2, O-O: a large center and queenside expansion (c5).'], b: ['...Bg7, ...d6, ...O-O, ...e5, then ...f5 and a kingside attack.'] }
    },
    {
      eco: 'E90', name: "King's Indian: Classical", moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5',
      why: 'Strikes the center at the right time, after castling.',
      summary: 'The main tabiya: after d5, typical race - White on the queenside, Black on the kingside with ...f5.',
      plans: { w: ['O-O, d5, Ne1/Nd2, b4 and c5: queenside break.'], b: ['...Nc6/...Na6, ...Ne8, ...f5-f4, ...g5-g4 kingside attack.'] },
      notes: { 6: 'The dragon bishop on g7 will put pressure on the long diagonal.', 7: 'White occupies the center with two pawns.', 8: 'Controls e5 and prepares ...e5.', 10: 'King safety first, then counterplay.' }
    },
    {
      eco: 'D80', name: 'Grünfeld Defense', moves: 'd4 Nf6 c4 g6 Nc3 d5',
      why: 'Hits the center immediately instead of allowing e4.',
      summary: 'Black invites White to build a big center (cxd5 Nxd5 e4 Nxc3 bxc3) and then attacks it with ...Bg7, ...c5, ...Nc6.',
      plans: { w: ['Exchange variation: big center, then Be3/Rc1/Qd2, or Bc4 + Ne2.'], b: ['...Bg7, ...c5, ...Nc6, ...Qa5 and pressure on d4.'] }
    },
    {
      eco: 'E20', name: 'Nimzo-Indian Defense', moves: 'd4 Nf6 c4 e6 Nc3 Bb4',
      why: 'Pins the c3 knight to stop e4; Black is willing to give the bishop for doubled pawns.',
      summary: 'One of Black\'s most respected defenses: control of e4 and structural targets.',
      plans: { w: ['Qc2 (Classical), e3 (Rubinstein) or a3 (Sämisch); use the bishop pair.'], b: ['...O-O, ...d5/...b6/...c5; control e4 and play against doubled c-pawns.'] }
    },
    {
      eco: 'E12', name: "Queen's Indian Defense", moves: 'd4 Nf6 c4 e6 Nf3 b6',
      why: 'Prepares ...Bb7 to control e4 from a distance.',
      summary: 'Solid, positional. Fight for the light squares, especially e4.',
      plans: { w: ['g3 + Bg2, or a3 (Petrosian) to prevent ...Bb4.'], b: ['...Bb7/...Ba6, ...Be7, ...O-O, ...d5 or ...c5.'] }
    },
    {
      eco: 'E01', name: 'Catalan Opening', moves: 'd4 Nf6 c4 e6 g3',
      why: 'Prepares Bg2 to pressure the long diagonal toward Black\'s queenside.',
      summary: 'Positional opening. White often gives the c4 pawn temporarily for long-term pressure.',
      plans: { w: ['Bg2, Nf3, O-O, Qc2/Qa4 to win back c4; pressure on b7 and d5.'], b: ['...d5, ...Be7, ...O-O, maybe ...dxc4 and ...c5 or ...b5.'] }
    },
    {
      eco: 'A56', name: 'Benoni Defense', moves: 'd4 Nf6 c4 c5',
      why: 'Challenges d4 immediately from the side.',
      summary: 'After d5, imbalanced structures: Black gets a queenside majority, White a central one.',
      plans: { w: ['d5, Nc3, e4: space and central e5 break.'], b: ['...e6, ...exd5, ...d6, ...g6, ...Bg7 and ...a6-b5.'] }
    },
    {
      eco: 'A57', name: 'Benko Gambit', moves: 'd4 Nf6 c4 c5 d5 b5',
      why: 'Sacrifices a queenside pawn for long-term pressure on the a- and b-files.',
      summary: 'Black plays for open queenside files and a dark-squared fianchetto.',
      plans: { w: ['Keep the pawn, finish development, and return it if needed.'], b: ['...a6, ...bxa6 lines, ...g6, ...Bg7, ...Qa5 and rooks to a- and b-files.'] }
    },
    {
      eco: 'A51', name: 'Budapest Gambit', moves: 'd4 Nf6 c4 e5',
      why: 'Counter-gambit: offers e5 to get active piece play.',
      summary: 'Black regains the pawn on e5 in most lines with ...Ng4 and ...Nc6.',
      plans: { w: ['dxe5, then Bf4/Nf3 to hold e5 temporarily.'], b: ['...Ng4, ...Nc6, ...Bb4+ and regain e5.'] }
    },
    {
      eco: 'A45', name: 'Trompowsky Attack', moves: 'd4 Nf6 Bg5',
      why: 'Threatens to double Black\'s pawns with Bxf6 and avoids main-line theory.',
      summary: 'A tricky system. Black often plays ...Ne4 or ...e6.',
      plans: { w: ['Bxf6 for structure, or e3/Bf4/h4 depending on Black\'s move.'], b: ['...Ne4, ...e6 or ...c5 + ...Qb6 hitting b2.'] }
    },
    {
      eco: 'A80', name: 'Dutch Defense', moves: 'd4 f5',
      why: 'Controls e4 and prepares a kingside setup, weakening the king a little.',
      summary: 'Combative: Stonewall (...d5, ...e6, ...c6) or Leningrad (...g6, ...Bg7) setups.',
      plans: { w: ['g3, Bg2, c4, Nh3/Nf3 and e4 break; watch the e-file and e6.'], b: ['...Nf6, ...e6 or ...g6, ...O-O and kingside play with ...Qe8-h5.'] }
    },
    {
      eco: 'A40', name: 'Englund Gambit', moves: 'd4 e5',
      why: 'An offbeat gambit that sets traps but is objectively dubious.',
      summary: 'White should take and develop calmly.',
      plans: { w: ['dxe5, Nf3, Bf4 and careful development; beware Qe7/Qb4+ tricks.'], b: ['...Nc6, ...Qe7 and hope for traps.'] },
      traps: ['1.d4 e5 2.dxe5 Nc6 3.Nf3 Qe7 4.Bf4? Qb4+ wins material; 4.Qd5 or 4.Nc3 is safer.']
    },

    // ---------------------------------------------------------------- Flank openings
    {
      eco: 'A10', name: 'English Opening', moves: 'c4',
      why: 'Controls d5 from the side; flexible and positional.',
      summary: 'Often transposes to queen\'s pawn openings or becomes a reversed Sicilian.',
      plans: { w: ['Nc3, g3, Bg2, Nf3: control the light squares.'], b: ['...e5 (Reversed Sicilian), ...c5 (Symmetrical) or ...Nf6.'] }
    },
    {
      eco: 'A20', name: "English: King's English", moves: 'c4 e5',
      why: 'A Sicilian with colors reversed: Black takes the center.',
      summary: 'White plays the Sicilian ideas a tempo up.',
      plans: { w: ['Nc3, g3, Bg2, d3 and queenside expansion.'], b: ['...Nf6, ...Nc6, ...Bb4 or ...d5 setups.'] }
    },
    {
      eco: 'A30', name: 'English: Symmetrical', moves: 'c4 c5',
      why: 'Mirrors White; keeps the position balanced.',
      summary: 'Maneuvering battles with fianchettoed bishops.',
      plans: { w: ['Nc3, g3, Bg2, Nf3, O-O, d4 at the right time.'], b: ['...Nc6, ...g6, ...Bg7 or a hedgehog setup.'] }
    },
    {
      eco: 'A04', name: 'Zukertort / Réti Opening', moves: 'Nf3',
      why: 'Develops a knight and controls e5/d4 while keeping pawn moves flexible.',
      summary: 'A hypermodern flexible start; can transpose to many openings.',
      plans: { w: ['c4 (Réti), g3 + Bg2, or d4.'], b: ['...d5, ...Nf6 or ...c5.'] }
    },
    {
      eco: 'A05', name: 'Zukertort Opening: 1...Nf6', moves: 'Nf3 Nf6',
      why: 'Mirrors White\'s flexible knight development and keeps e4 under control.',
      summary: 'Both sides keep options open; this often transposes to Indian defenses or the English.',
      plans: { w: ['c4 or d4 to transpose to main openings, or g3 + Bg2.'], b: ['...g6, ...e6 or ...d5 depending on your repertoire.'] }
    },
    {
      eco: 'A46', name: 'Indian Defense: Knights Variation', moves: 'd4 Nf6 Nf3',
      why: 'Develops and keeps c4 or a London setup in reserve.',
      summary: 'A flexible move order that avoids some sharp lines (like the Budapest).',
      plans: { w: ['c4 to transpose, or Bf4/Bg5 system play.'], b: ['...e6, ...g6 or ...d5.'] }
    },
    {
      eco: 'D02', name: "Queen's Pawn Game: Zukertort Variation", moves: 'd4 d5 Nf3',
      why: 'Develops the knight and keeps options of c4 or a London/Colle setup.',
      summary: 'Flexible queen\'s pawn setup.',
      plans: { w: ['c4, Bf4 or e3 + Bd3 (Colle).'], b: ['...Nf6, ...c5 or ...Bf5.'] }
    },
    {
      eco: 'A15', name: 'English Opening: Anglo-Indian Defense', moves: 'c4 Nf6',
      why: 'Flexible knight development that controls e4 and d5.',
      summary: 'Can transpose to many 1.d4 openings or stay in English structures.',
      plans: { w: ['Nc3, g3, Bg2, or d4 to transpose.'], b: ['...e6, ...g6, ...c5 or ...e5.'] }
    },
    {
      eco: 'A09', name: 'Réti Opening', moves: 'Nf3 d5 c4',
      why: 'Hits d5 from the flank, hypermodern style.',
      summary: 'Pressure on Black\'s center from the side; fianchetto bishops.',
      plans: { w: ['g3, Bg2, O-O, b3 + Bb2.'], b: ['...d4 for space, or ...e6/...c6 solidly.'] }
    },
    {
      eco: 'A07', name: "King's Indian Attack", moves: 'Nf3 d5 g3',
      why: 'Fianchetto setup with Nf3, g3, Bg2, O-O, d3 and e4.',
      summary: 'A system White can play against almost anything.',
      plans: { w: ['Bg2, O-O, d3, Nbd2, e4, then e5 and kingside attack.'], b: ['...c5, ...Nc6, ...e6/...g6; queenside expansion.'] }
    },
    {
      eco: 'A02', name: "Bird's Opening", moves: 'f4',
      why: 'Controls e5; a reversed Dutch.',
      summary: 'Unusual; White aims for kingside play.',
      plans: { w: ['Nf3, e3, b3/Bb2 or g3/Bg2.'], b: ['...d5 or the sharp From\'s Gambit ...e5.'] }
    }
  ];

  /* General principles shown as the thinking checklist / lessons. */
  CC.PRINCIPLES = {
    opening: [
      'Control the center with pawns (e4/d4 or e5/d5) and pieces.',
      'Develop knights and bishops before moving the queen or rooks.',
      'Try not to move the same piece twice before you finish developing.',
      'Castle early to protect your king and connect your rooks.',
      'Do not grab pawns if it costs you several moves of development.',
      'Connect your rooks and put them on open or half-open files.'
    ],
    checklist: [
      'What did my opponent\'s last move change? What does it attack or threaten?',
      'Checks, captures, threats - for both sides - before every move.',
      'Is any piece undefended or attacked more times than it is defended?',
      'Which of my pieces is worst? Can I improve it?',
      'After choosing a move, ask: what is my opponent\'s best reply?'
    ]
  };
})(globalThis);
