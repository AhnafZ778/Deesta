/**
 * The "Brain" - Yjs Document Layer
 * Provides CRDT-based conflict-free collaborative editing
 * with IndexedDB persistence for offline-first capability.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebrtcProvider } from 'y-webrtc';

// --- Card Schema ---
export interface CardData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  text: string;
  imageUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConnectionData {
  id: string;
  fromId: string;
  toId: string;
}

export interface StrokeData {
  id: string;
  points: number[][]; // [x, y, pressure]
  color: number;
  width: number;
}

// Combined Snapshot
export interface BoardData {
  cards: Map<string, CardData>;
  connections: Map<string, ConnectionData>;
  strokes: Map<string, StrokeData>;
}

// --- Document State ---
class DocumentStore {
  private doc: Y.Doc;
  private persistence: IndexeddbPersistence | null = null;
  private provider: WebrtcProvider | null = null;
  private cardsMap: Y.Map<CardData>;
  private connectionsMap: Y.Map<ConnectionData>;
  private strokesMap: Y.Map<StrokeData>;
  private isInitialized: boolean = false;
  private changeListeners: Set<(data: BoardData) => void> = new Set();

  constructor() {
    this.doc = new Y.Doc();
    this.cardsMap = this.doc.getMap('cards');
    this.connectionsMap = this.doc.getMap('connections');
    this.strokesMap = this.doc.getMap('strokes');
  }

  /**
   * Initialize the document store with IndexedDB persistence
   */
  async init(boardId: string = 'default-board'): Promise<void> {
    if (this.isInitialized) return;

    // Create IndexedDB persistence
    this.persistence = new IndexeddbPersistence(boardId, this.doc);
    
    // Connect to WebRTC
    // In a real app, you might want multiple signaling servers for reliability
    // boardId acts as the "room" name
    this.provider = new WebrtcProvider(boardId, this.doc, {
        signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com', 'wss://y-webrtc-signaling-us.herokuapp.com'],
    });

    this.provider.on('synced', (synced: { synced: boolean }) => {
        console.log('[DocumentStore] WebRTC synced:', synced);
    });

    // Wait for sync to complete
    await new Promise<void>((resolve) => {
      this.persistence!.once('synced', () => {
        console.log(`[DocumentStore] Synced with IndexedDB: ${boardId}`);
        resolve();
      });
    });

    // Listen for changes
    const notify = () => this.notifyListeners();
    this.cardsMap.observe(notify);
    this.connectionsMap.observe(notify);
    this.strokesMap.observe(notify);

    this.isInitialized = true;
    console.log(`[DocumentStore] Initialized with ${this.cardsMap.size} cards, ${this.connectionsMap.size} connections, ${this.strokesMap.size} strokes`);
  }

  /**
   * Create a new card
   */
  createCard(data: Omit<CardData, 'id' | 'createdAt' | 'updatedAt'>): CardData {
    const id = crypto.randomUUID();
    const now = Date.now();
    const card: CardData = {
      ...data,
      id,
      createdAt: now,
      updatedAt: now,
    };

    this.doc.transact(() => {
      this.cardsMap.set(id, card);
    });

    return card;
  }

  /**
   * Update a card's position
   */
  updateCardPosition(id: string, x: number, y: number): void {
    const card = this.cardsMap.get(id);
    if (!card) return;

    this.doc.transact(() => {
      this.cardsMap.set(id, {
        ...card,
        x,
        y,
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * Update a card's properties
   */
  updateCard(id: string, updates: Partial<CardData>): void {
    const card = this.cardsMap.get(id);
    if (!card) return;

    this.doc.transact(() => {
      this.cardsMap.set(id, {
        ...card,
        ...updates,
        updatedAt: Date.now(),
      });
    });
  }

  /**
   * Delete a card
   */
  deleteCard(id: string): void {
    this.doc.transact(() => {
      this.cardsMap.delete(id);
    });
  }

  /**
   * Get all data
   */
  getSnapshot(): BoardData {
    const cards = new Map<string, CardData>();
    this.cardsMap.forEach((card, id) => cards.set(id, card));

    const connections = new Map<string, ConnectionData>();
    this.connectionsMap.forEach((conn, id) => connections.set(id, conn));

    const strokes = new Map<string, StrokeData>();
    this.strokesMap.forEach((stroke, id) => strokes.set(id, stroke));

    return { cards, connections, strokes };
  }

  /**
   * Helper for old code calling receive cards
   */
  getAllCards(): Map<string, CardData> {
      return this.getSnapshot().cards;
  }

  /**
   * Connection CRUD
   */
  createConnection(fromId: string, toId: string): void {
      const id = `${fromId}-${toId}`;
      if (this.connectionsMap.has(id)) return;
      this.doc.transact(() => {
          this.connectionsMap.set(id, { id, fromId, toId });
      });
  }

  deleteConnection(id: string): void {
      this.doc.transact(() => {
          this.connectionsMap.delete(id);
      });
  }

  /**
   * Stroke CRUD
   */
  addStroke(stroke: StrokeData): void {
      this.doc.transact(() => {
          this.strokesMap.set(stroke.id, stroke);
      });
  }

  deleteStroke(id: string): void {
      this.doc.transact(() => {
          this.strokesMap.delete(id);
      });
  }

  /**
   * Get a single card
   */
  getCard(id: string): CardData | undefined {
    return this.cardsMap.get(id);
  }

  /**
   * Subscribe to document changes
   */
  subscribe(listener: (data: BoardData) => void): () => void {
    this.changeListeners.add(listener);
    // Immediately notify with current state
    listener(this.getSnapshot());
    
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const data = this.getSnapshot();
    for (const listener of this.changeListeners) {
      listener(data);
    }
  }

  /**
   * Get the raw Yjs document (for debugging/advanced use)
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  updateAwareness(state: { x: number; y: number; color: number; name: string }): void {
      if (this.provider) {
          this.provider.awareness.setLocalState(state);
      }
  }
  
  getAwareness(): any {
      return this.provider ? this.provider.awareness : null;
  }

  /**
   * Destroy the document store
   */
  destroy(): void {
    if (this.persistence) {
      this.persistence.destroy();
      this.persistence = null;
    }
    if (this.provider) {
        this.provider.destroy();
        this.provider = null;
    }
    this.doc.destroy();
    this.changeListeners.clear();
    this.isInitialized = false;
  }
}

// Export singleton instance
export const documentStore = new DocumentStore();
