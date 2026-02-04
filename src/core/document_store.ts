/**
 * The "Brain" - Yjs Document Layer
 * Provides CRDT-based conflict-free collaborative editing
 * with IndexedDB persistence for offline-first capability.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

// --- Card Schema ---
export interface CardData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

// --- Document State ---
class DocumentStore {
  private doc: Y.Doc;
  private persistence: IndexeddbPersistence | null = null;
  private cardsMap: Y.Map<CardData>;
  private isInitialized: boolean = false;
  private changeListeners: Set<(cards: Map<string, CardData>) => void> = new Set();

  constructor() {
    this.doc = new Y.Doc();
    this.cardsMap = this.doc.getMap('cards');
  }

  /**
   * Initialize the document store with IndexedDB persistence
   */
  async init(boardId: string = 'default-board'): Promise<void> {
    if (this.isInitialized) return;

    // Create IndexedDB persistence
    this.persistence = new IndexeddbPersistence(boardId, this.doc);

    // Wait for sync to complete
    await new Promise<void>((resolve) => {
      this.persistence!.once('synced', () => {
        console.log(`[DocumentStore] Synced with IndexedDB: ${boardId}`);
        resolve();
      });
    });

    // Listen for changes
    this.cardsMap.observe(() => {
      this.notifyListeners();
    });

    this.isInitialized = true;
    console.log(`[DocumentStore] Initialized with ${this.cardsMap.size} cards`);
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
   * Get all cards
   */
  getAllCards(): Map<string, CardData> {
    const cards = new Map<string, CardData>();
    this.cardsMap.forEach((card, id) => {
      cards.set(id, card);
    });
    return cards;
  }

  /**
   * Get a single card
   */
  getCard(id: string): CardData | undefined {
    return this.cardsMap.get(id);
  }

  /**
   * Subscribe to card changes
   */
  subscribe(listener: (cards: Map<string, CardData>) => void): () => void {
    this.changeListeners.add(listener);
    // Immediately notify with current state
    listener(this.getAllCards());
    
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    const cards = this.getAllCards();
    for (const listener of this.changeListeners) {
      listener(cards);
    }
  }

  /**
   * Get the raw Yjs document (for debugging/advanced use)
   */
  getDoc(): Y.Doc {
    return this.doc;
  }

  /**
   * Destroy the document store
   */
  destroy(): void {
    if (this.persistence) {
      this.persistence.destroy();
      this.persistence = null;
    }
    this.doc.destroy();
    this.changeListeners.clear();
    this.isInitialized = false;
  }
}

// Export singleton instance
export const documentStore = new DocumentStore();
