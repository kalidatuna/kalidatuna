/*
 * Opening book index built from CC.OPENINGS.
 *
 * Positions are keyed by piece placement + side to move, so transpositions
 * (reaching a book position by a different move order) are recognized.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const { Chess } = root.ChessJS;

  function positionKey(fen) {
    const parts = fen.split(' ');
    return parts[0] + ' ' + (parts[1] || 'w');
  }

  function slug(name) {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  class OpeningBook {
    constructor(lines) {
      this.lines = [];
      this.byId = new Map();
      this.nodes = new Map(); // key -> { key, endings: [line], edges: Map(san -> edge) }
      const start = new Chess();
      this.startKey = positionKey(start.fen());
      this._node(this.startKey);
      for (const raw of lines) this._addLine(raw);
    }

    _node(key) {
      let n = this.nodes.get(key);
      if (!n) {
        n = { key, endings: [], edges: new Map() };
        this.nodes.set(key, n);
      }
      return n;
    }

    _addLine(raw) {
      const sans = raw.moves.trim().split(/\s+/);
      const chess = new Chess();
      const line = Object.assign({}, raw, {
        id: slug(raw.name),
        sans,
        // The side that "chooses" this opening is the one who made the last move.
        side: sans.length % 2 === 1 ? 'w' : 'b',
        plans: raw.plans || { w: [], b: [] },
        traps: raw.traps || [],
        notes: raw.notes || {}
      });
      if (this.byId.has(line.id)) throw new Error('Duplicate opening id: ' + line.id);
      let key = this.startKey;
      sans.forEach((san, i) => {
        const mv = chess.move(san); // throws on illegal SAN - caught by tests
        const nextKey = positionKey(chess.fen());
        const node = this._node(key);
        let edge = node.edges.get(mv.san);
        if (!edge) {
          edge = { san: mv.san, from: mv.from, to: mv.to, key: nextKey, lines: [], note: null };
          node.edges.set(mv.san, edge);
        }
        edge.lines.push(line);
        if (!edge.note && line.notes[i + 1]) edge.note = line.notes[i + 1];
        this._node(nextKey);
        key = nextKey;
      });
      const end = this._node(key);
      end.endings.push(line);
      line.key = key;
      // The "why" of a line explains the move that reaches its final position.
      const parentEdge = this._edgeInto(line);
      if (parentEdge && !parentEdge.why) parentEdge.why = line.why;
      this.lines.push(line);
      this.byId.set(line.id, line);
    }

    _edgeInto(line) {
      const chess = new Chess();
      let key = this.startKey;
      let edge = null;
      for (const san of line.sans) {
        edge = this.nodes.get(key).edges.get(chess.move(san).san);
        key = edge.key;
      }
      return edge;
    }

    has(key) {
      return this.nodes.has(key);
    }

    /** Named line(s) that end exactly in this position. */
    namedAt(key) {
      const n = this.nodes.get(key);
      return n && n.endings.length ? n.endings[0] : null;
    }

    /** Book continuations from a position, most-travelled first. */
    continuations(key) {
      const n = this.nodes.get(key);
      if (!n) return [];
      const out = [];
      for (const edge of n.edges.values()) {
        const target = this.nodes.get(edge.key);
        const named = target.endings[0] || null;
        out.push({
          san: edge.san,
          from: edge.from,
          to: edge.to,
          note: edge.why || edge.note || null,
          opening: named ? named.name : null,
          // Name the deepest family this move leads into, for "leads to ..." hints.
          leadsTo: [...new Set(edge.lines.map((l) => l.name))].slice(0, 3),
          weight: edge.lines.length
        });
      }
      out.sort((a, b) => b.weight - a.weight);
      return out;
    }

    /** The curated note for a book move from position `key`, if any. */
    noteFor(key, san) {
      const n = this.nodes.get(key);
      const e = n && n.edges.get(san);
      return e ? e.why || e.note || null : null;
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

  CC.positionKey = positionKey;
  CC.moveLabel = moveLabel;
  CC.OpeningBook = OpeningBook;
  let shared = null;
  CC.getBook = function () {
    if (!shared) shared = new OpeningBook(CC.OPENINGS);
    return shared;
  };
})(globalThis);
