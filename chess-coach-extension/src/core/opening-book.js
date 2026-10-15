/*
 * Opening book index.
 *
 * Two sources are merged:
 *  - CC.OPENING_DB: ~3,900 named lines from the lichess chess-openings data set
 *    (accurate names and broad coverage, but no explanations), precomputed by
 *    scripts/build-opening-db.js.
 *  - CC.OPENINGS: hand-written lines with summaries, plans, traps and notes.
 *
 * Positions are keyed by a hash of piece placement + side to move, so
 * transpositions (reaching a book position by another move order) are found.
 * Positions without their own hand-written notes inherit the plans of the
 * nearest hand-written opening they grew out of (e.g. every Najdorf sub-line
 * gets the Najdorf plans).
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const { Chess } = root.ChessJS;

  /** 52-bit FNV-1a style hash of a string, as a short base-36 string. */
  function hashString(s) {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
      h2 ^= h2 >>> 13;
    }
    return (h1 >>> 0).toString(36) + '.' + ((h2 >>> 0) & 0xfffff).toString(36);
  }

  /** Book key for a FEN: placement + side to move (castling/en passant ignored). */
  function positionKey(fen) {
    const parts = fen.split(' ');
    return hashString(parts[0] + ' ' + (parts[1] || 'w'));
  }

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  class OpeningBook {
    constructor(curated, db) {
      this.lines = [];
      this.curatedLines = [];
      this.byId = new Map();
      this.nodes = new Map(); // key -> { key, edges: Map(san -> edge), curated, dbLine }
      this.startKey = positionKey(new Chess().fen());
      this._node(this.startKey);
      if (db) this._loadDb(db);
      for (const raw of curated || []) this._addCurated(raw);
      this._inheritTeaching();
      this._weights = new Map();
      this._infoCache = new Map();
    }

    _node(key) {
      let n = this.nodes.get(key);
      if (!n) {
        n = { key, edges: new Map(), curated: null, dbLine: null, teach: null };
        this.nodes.set(key, n);
      }
      return n;
    }

    _edge(fromKey, san, toKey) {
      const node = this._node(fromKey);
      let edge = node.edges.get(san);
      if (!edge) {
        edge = { san, key: toKey, why: null, note: null, curated: 0 };
        node.edges.set(san, edge);
      }
      this._node(toKey);
      return edge;
    }

    _register(line) {
      if (this.byId.has(line.id)) throw new Error('Duplicate opening id: ' + line.id);
      this.byId.set(line.id, line);
      this.lines.push(line);
    }

    _loadDb(db) {
      for (const [from, san, to] of db.edges) this._edge(db.positions[from], san, db.positions[to]);
      const seen = new Map();
      for (const [eco, name, moves] of db.lines) {
        const sans = moves.split(' ');
        let key = this.startKey;
        for (const san of sans) key = this.nodes.get(key).edges.get(san).key;
        const base = 'db-' + slug(name);
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        const line = { id: n > 1 ? `${base}-${n}` : base, eco, name, sans, moves, key, source: 'db', side: sans.length % 2 === 1 ? 'w' : 'b' };
        const node = this.nodes.get(key);
        if (!node.dbLine) node.dbLine = line;
        this._register(line);
      }
    }

    _addCurated(raw) {
      const sans = raw.moves.trim().split(/\s+/);
      const chess = new Chess();
      const line = Object.assign({}, raw, {
        id: slug(raw.name),
        sans,
        source: 'curated',
        // The side that "chooses" this opening is the one who made the last move.
        side: sans.length % 2 === 1 ? 'w' : 'b',
        plans: raw.plans || { w: [], b: [] },
        traps: raw.traps || [],
        notes: raw.notes || {}
      });
      let key = this.startKey;
      let edge = null;
      sans.forEach((s, i) => {
        const mv = chess.move(s); // throws on illegal SAN - caught by tests
        const next = positionKey(chess.fen());
        edge = this._edge(key, mv.san, next);
        edge.curated++;
        if (!edge.note && line.notes[i + 1]) edge.note = line.notes[i + 1];
        key = next;
      });
      line.sans = chess.history();
      line.key = key;
      // The "why" of a line explains the move that reaches its final position.
      if (edge && !edge.why) edge.why = line.why;
      const end = this.nodes.get(key);
      if (!end.curated) end.curated = line;
      this._register(line);
      this.curatedLines.push(line);
    }

    /** Breadth-first from the start: each position inherits the nearest hand-written opening. */
    _inheritTeaching() {
      const start = this.nodes.get(this.startKey);
      const seen = new Set([this.startKey]);
      const queue = [start];
      while (queue.length) {
        const node = queue.shift();
        if (node.curated) node.teach = node.curated;
        for (const edge of node.edges.values()) {
          if (seen.has(edge.key)) continue;
          seen.add(edge.key);
          const child = this.nodes.get(edge.key);
          child.teach = node.teach;
          queue.push(child);
        }
      }
    }

    has(key) {
      return this.nodes.has(key);
    }

    /**
     * Opening information for a position that has a name, merging the data-set
     * name with hand-written teaching material. Null if the position is unnamed.
     */
    namedAt(key) {
      const n = this.nodes.get(key);
      if (!n || (!n.curated && !n.dbLine)) return null;
      return this._info(n);
    }

    /** Teaching information for any line (curated or data set). */
    describe(line) {
      const n = this.nodes.get(line.key);
      const info = this._info(n);
      return Object.assign({}, info, { id: line.id, name: line.name, eco: line.eco, sans: line.sans, side: line.side });
    }

    _info(n) {
      if (this._infoCache.has(n.key)) return this._infoCache.get(n.key);
      const named = n.dbLine || n.curated;
      const teach = n.curated || n.teach;
      const info = {
        id: (n.curated || n.dbLine).id,
        name: named.name,
        eco: named.eco,
        sans: (n.curated || n.dbLine).sans,
        why: n.curated ? n.curated.why : null,
        summary: teach ? teach.summary : null,
        plans: teach ? teach.plans : { w: [], b: [] },
        traps: teach ? teach.traps : [],
        // When the teaching material comes from a parent opening, say so.
        family: teach && teach !== n.curated ? teach.name : null
      };
      this._infoCache.set(n.key, info);
      return info;
    }

    /** Number of named lines reachable from a position (how "main" a move is). */
    _weight(key, stack) {
      if (this._weights.has(key)) return this._weights.get(key);
      stack = stack || new Set();
      if (stack.has(key)) return 0;
      stack.add(key);
      const n = this.nodes.get(key);
      let w = n.curated || n.dbLine ? 1 : 0;
      for (const e of n.edges.values()) w += this._weight(e.key, stack);
      stack.delete(key);
      this._weights.set(key, w);
      return w;
    }

    _leadsTo(key) {
      const out = [];
      const seen = new Set([key]);
      let frontier = [key];
      for (let depth = 0; depth < 6 && out.length < 2 && frontier.length; depth++) {
        const next = [];
        for (const k of frontier) {
          for (const e of this.nodes.get(k).edges.values()) {
            if (seen.has(e.key)) continue;
            seen.add(e.key);
            const info = this.namedAt(e.key);
            if (info && !out.includes(info.name)) out.push(info.name);
            else next.push(e.key);
          }
        }
        frontier = next;
      }
      return out.slice(0, 2);
    }

    /**
     * Book continuations from a position. Moves from the hand-written lines
     * (main lines with explanations) come first, then by how many named lines
     * follow from them.
     */
    continuations(key) {
      const n = this.nodes.get(key);
      if (!n) return [];
      const out = [];
      for (const edge of n.edges.values()) {
        const named = this.namedAt(edge.key);
        out.push({
          san: edge.san,
          note: edge.why || edge.note || null,
          opening: named ? named.name : null,
          leadsTo: named ? [] : this._leadsTo(edge.key),
          main: edge.curated > 0,
          weight: edge.curated * 100000 + this._weight(edge.key)
        });
      }
      out.sort((a, b) => b.weight - a.weight);
      return out;
    }

    /** The hand-written note for a book move from position `key`, if any. */
    noteFor(key, san) {
      const n = this.nodes.get(key);
      const e = n && n.edges.get(san);
      return e ? e.why || e.note || null : null;
    }

    isBookMove(key, san) {
      const n = this.nodes.get(key);
      return !!(n && n.edges.has(san));
    }

    /**
     * Walk a game (list of SAN moves from the start position) through the book.
     * Returns where the game left theory and the most specific opening reached.
     */
    analyzeGame(sans, startFen) {
      const chess = startFen ? new Chess(startFen) : new Chess();
      const positions = [{ key: positionKey(chess.fen()), fen: chess.fen() }];
      const moves = [];
      for (const san of sans) {
        let mv;
        try {
          mv = chess.move(san);
        } catch (e) {
          break;
        }
        moves.push(mv);
        positions.push({ key: positionKey(chess.fen()), fen: chess.fen() });
      }
      let opening = null;
      let openingPly = 0;
      let lastBookPly = 0;
      let leftBookPly = null; // 1-based ply of the move that left the book (null = still in book)
      for (let i = 0; i < positions.length; i++) {
        const key = positions[i].key;
        if (this.has(key)) {
          // Reaching a book position again (a transposition) puts us back in theory.
          leftBookPly = null;
          lastBookPly = i;
          const named = this.namedAt(key);
          if (named) {
            opening = named;
            openingPly = i;
          }
        } else if (leftBookPly === null) {
          leftBookPly = i;
        }
      }
      return { opening, openingPly, lastBookPly, leftBookPly, positions, moves, legalPlies: moves.length };
    }

    /** Lines a player of `color` would study (lines whose defining move is theirs). */
    linesFor(color) {
      return this.lines.filter((l) => l.side === color);
    }
  }

  /** "1.e4" for ply 1, "1...e5" for ply 2 (plies are 1-based). */
  function moveLabel(ply, san) {
    const n = Math.ceil(ply / 2);
    return ply % 2 === 1 ? `${n}.${san}` : `${n}...${san}`;
  }

  CC.hashString = hashString;
  CC.positionKey = positionKey;
  CC.moveLabel = moveLabel;
  CC.OpeningBook = OpeningBook;
  let shared = null;
  CC.getBook = function () {
    if (!shared) shared = new OpeningBook(CC.OPENINGS, CC.OPENING_DB);
    return shared;
  };
})(globalThis);
