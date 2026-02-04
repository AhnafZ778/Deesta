/**
 * Interaction Manager (The "Hands")
 * Central state machine that handles all user input and allows
 * switching between different tools (Select, Pan, Pen, etc.)
 */

import { FederatedPointerEvent } from 'pixi.js';
// Use type-only import to avoid runtime circular dependency
import type { CanvasEngine } from './canvas_engine';

export const InteractionMode = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING: 'dragging',
  SELECTING: 'selecting',
  DRAWING: 'drawing',
  ERASING: 'erasing',
  EDITING: 'editing',
} as const;

export type InteractionMode = typeof InteractionMode[keyof typeof InteractionMode];

export class InteractionManager {
  private mode: InteractionMode = InteractionMode.IDLE;
  private isSpacePressed: boolean = false;
  private engine: CanvasEngine | null = null;
  
  // Selection state
  private selectedCardIds: Set<string> = new Set();

  // Double Click Detection
  private lastClickTime: number = 0;
  private lastClickedCardId: string | null = null;
  private onEditStart: ((cardId: string) => void) | null = null;
  
  // State Subscriptions
  private listeners: Set<(mode: InteractionMode) => void> = new Set();
  
  constructor() {
    this.setupGlobalListeners();
    (window as any).interactionManager = this;
  }

  setEngine(engine: CanvasEngine) {
    this.engine = engine;
  }

  /**
   * Subscribe to mode changes
   */
  subscribe(listener: (mode: InteractionMode) => void): () => void {
    this.listeners.add(listener);
    // Initial call
    listener(this.mode);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.mode);
    }
  }

  /**
   * Setup global keyboard listeners (Spacebar for panning, etc.)
   */
  private setupGlobalListeners(): void {
    window.addEventListener('keydown', (e) => {
      // Ignore shortcuts if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      if (e.code === 'Space' && !this.isSpacePressed) {
        this.isSpacePressed = true;
        this.setMode(InteractionMode.PANNING);
        this.engine?.setCursor('grab');
      }
      
      // Tool Switching Shortcuts
      if (!this.isSpacePressed) {
        switch(e.key.toLowerCase()) {
          case 'p':
            this.setMode(InteractionMode.DRAWING);
            this.engine?.setCursor('crosshair');
            break;
          case 'v':
            this.setMode(InteractionMode.IDLE);
            this.engine?.setCursor('default');
            break;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        if (this.mode === InteractionMode.PANNING) {
          // Return to previous mode or IDLE? For now IDLE
          this.setMode(InteractionMode.IDLE);
          this.engine?.setCursor('default');
        }
      }
    });
  }

  /**
   * Switch interaction mode
   */
  setMode(mode: InteractionMode): void {
    if (this.mode === mode) return;
    console.log(`[InteractionManager] Mode: ${this.mode} -> ${mode}`);
    this.mode = mode;
    this.notifyListeners();
  }

  /**
   * Set callback for edit start
   */
  setOnEditStart(callback: (cardId: string) => void): void {
    this.onEditStart = callback;
  }

  /**
   * Get current mode
   */
  getMode(): InteractionMode {
    return this.mode;
  }

  /**
   * Get selected card IDs
   */
  getSelectedCards(): Set<string> {
    return this.selectedCardIds;
  }

  /**
   * Handle pointer down on the canvas background
   */
  handleCanvasDown(e: FederatedPointerEvent): void {
    if (this.isSpacePressed || e.button === 1) {
      // Middle click or Space+Click -> Start Panning
      this.setMode(InteractionMode.PANNING);
      this.engine?.startPan(e);
      return;
    }

    if (this.mode === InteractionMode.DRAWING) {
      // Start Drawing Stroke
      this.engine?.startStroke(e);
      return;
    }

    if (this.mode === InteractionMode.IDLE) {
      // Click on empty space -> Deselect all
      this.deselectAll();
      // Start rubber band selection (TODO)
      this.setMode(InteractionMode.SELECTING);
    }
  }

  /**
   * Handle pointer down on a card
   */
  handleCardDown(e: FederatedPointerEvent, cardId: string): void {
    e.stopPropagation();

    if (this.isSpacePressed) return; // Ignore if panning

    // Check for Double Click (Start Editing)
    const now = Date.now();
    const delta = now - this.lastClickTime;
    if (this.lastClickedCardId === cardId && (delta < 500)) {
       console.log(`[InteractionManager] Double Click detected! Delta: ${delta}ms`);
       this.setMode(InteractionMode.EDITING);
       if (this.onEditStart) this.onEditStart(cardId);
       return;
    }
    // console.log(`[InteractionManager] Click delta: ${delta}ms`);
    this.lastClickTime = now;
    this.lastClickedCardId = cardId;

    // Select the card
    if (!e.shiftKey) {
      // If not holding shift and card is not already selected, clear others
      if (!this.selectedCardIds.has(cardId)) {
        this.deselectAll();
      }
    }
    this.selectCard(cardId);

    // Start dragging
    this.setMode(InteractionMode.DRAGGING);
    this.engine?.startDrag(e, cardId);
  }

  /**
   * Selection Logic
   */
  selectCard(cardId: string): void {
    this.selectedCardIds.add(cardId);
    this.engine?.updateSelectionVisuals(this.selectedCardIds);
  }

  deselectAll(): void {
    this.selectedCardIds.clear();
    this.engine?.updateSelectionVisuals(this.selectedCardIds);
  }
}

export const interactionManager = new InteractionManager();
