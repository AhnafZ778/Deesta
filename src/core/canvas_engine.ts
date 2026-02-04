/**
 * The "Gravity" Canvas Engine
 * This module creates a WebGPU-accelerated Pixi.js v8 application
 * with custom Verlet physics for smooth, mass-based interactions.
 */

import { Application, Container, Graphics, FederatedPointerEvent, Text, TextStyle } from 'pixi.js';
import { interactionManager, InteractionMode } from './interaction_manager';


// --- Physics Configuration (The "Muse" Feel) ---
const PHYSICS_CONFIG = {
  mass: 1.5,
  friction: 0.92,
  spring: 0.1,
  staticFrictionThreshold: 0.05,
  minVelocity: 0.01,
};

// --- State for Verlet Physics ---
interface PhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  isDragging: boolean;
  cardId: string;
}

// The canvas viewport state
interface ViewportState {
  x: number;
  y: number;
  scale: number;
  vx: number;
  vy: number;
  isDragging: boolean;
  lastPointerX: number;
  lastPointerY: number;
}

// Drawing Stroke State
interface StrokeState {
  points: number[][]; // [x, y, pressure]
  graphics: Graphics;
}

// Callback for position changes (for persistence)
type PositionChangeCallback = (cardId: string, x: number, y: number) => void;

export class CanvasEngine {
  private app: Application;
  private worldContainer: Container;
  private viewport: ViewportState;
  private isInitialized: boolean = false;
  private cards: Map<string, { graphics: Graphics; state: PhysicsState }> = new Map();
  private strokes: StrokeState[] = []; // Track all strokes
  private onPositionChange: PositionChangeCallback | null = null;
  
  // Drag offset for current operation
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  
  // Current drawing stroke
  private currentStroke: StrokeState | null = null;

  constructor() {
    this.app = new Application();
    this.worldContainer = new Container();
    this.viewport = {
      x: 0, y: 0, scale: 1, vx: 0, vy: 0,
      isDragging: false, lastPointerX: 0, lastPointerY: 0,
    };
    (window as any).canvasEngine = this;
  }

  async init(container: HTMLElement): Promise<void> {
    if (this.isInitialized) return;

    await this.app.init({
      preference: 'webgl',
      resizeTo: container,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(this.app.canvas);
    this.app.stage.addChild(this.worldContainer);
    this.setupInteraction();
    this.app.ticker.add(this.physicsTick.bind(this));
    this.isInitialized = true;
    console.log(`[CanvasEngine] Initialized with renderer: ${this.app.renderer.type === 1 ? 'WebGL' : 'WebGPU'}`);
  }

  private setupInteraction(): void {
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;

    // Pan / Background Click
    stage.on('pointerdown', (e: FederatedPointerEvent) => {
      interactionManager.handleCanvasDown(e);
    });

    // Delegated Global Move
    stage.on('globalpointermove', (e: FederatedPointerEvent) => {
       const mode = interactionManager.getMode();

       // Eraser
       if (mode === InteractionMode.ERASING && e.buttons === 1) { // Check for left click drag
           this.eraseAt(e.globalX, e.globalY);
           return;
       }

       // Drawing
       if (this.currentStroke) {
         this.continueStroke(e);
         return;
       }

       // Viewport Panning
      if (this.viewport.isDragging) {
        const dx = e.globalX - this.viewport.lastPointerX;
        const dy = e.globalY - this.viewport.lastPointerY;
        this.viewport.vx = dx;
        this.viewport.vy = dy;
        this.viewport.x += dx;
        this.viewport.y += dy;
        this.viewport.lastPointerX = e.globalX;
        this.viewport.lastPointerY = e.globalY;
      }
      
      // Card Dragging Logic
      for (const [_cardId, { state, graphics }] of this.cards) {
         if (state.isDragging) {
            const localPos = this.worldContainer.toLocal(e.global);
            const newX = localPos.x - this.dragOffset.x;
            const newY = localPos.y - this.dragOffset.y;

            // Calculate throw velocity
            state.vx = (newX - state.x) / PHYSICS_CONFIG.mass;
            state.vy = (newY - state.y) / PHYSICS_CONFIG.mass;

            state.x = newX;
            state.y = newY;
            state.targetX = newX;
            state.targetY = newY;
            
            graphics.x = state.x;
            graphics.y = state.y;
         }
       }
    });

    // Pointer Up
    const onUp = (e: FederatedPointerEvent) => {
      // End Drawing
      if (this.currentStroke) {
        this.endStroke(e);
      }
      
      // End Panning
      this.viewport.isDragging = false;
      
      // End Card Dragging
      for (const [cardId, { state, graphics }] of this.cards) {
        if (state.isDragging) {
          state.isDragging = false;
          graphics.cursor = 'grab';
          if (this.onPositionChange) {
            this.onPositionChange(cardId, state.x, state.y);
          }
        }
      }
    };

    stage.on('pointerup', onUp);
    stage.on('pointerupoutside', onUp);

    // Zoom
    this.app.canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const oldScale = this.viewport.scale;
      const newScale = Math.max(0.1, Math.min(5, oldScale * zoomFactor));
      const mouseX = e.offsetX;
      const mouseY = e.offsetY;
      this.viewport.x = mouseX - (mouseX - this.viewport.x) * (newScale / oldScale);
      this.viewport.y = mouseY - (mouseY - this.viewport.y) * (newScale / oldScale);
      this.viewport.scale = newScale;
    }, { passive: false });
  }

  /**
   * Start a new drawing stroke
   */
  startStroke(e: FederatedPointerEvent): void {
    const localPos = this.worldContainer.toLocal(e.global);
    const graphics = new Graphics();
    
    // Add strokes to world container
    // Optimization: In real app, we might want a separate InkContainer
    this.worldContainer.addChild(graphics);

    this.currentStroke = {
      points: [[localPos.x, localPos.y, e.pressure || 0.5]],
      graphics,
    };
    
    // Track the new stroke
    this.strokes.push(this.currentStroke);
    
    // Initial render
    this.renderStroke(this.currentStroke);
  }

  /**
   * Continue current stroke
   */
  continueStroke(e: FederatedPointerEvent): void {
    if (!this.currentStroke) return;

    const nativeEvent = e.nativeEvent as PointerEvent;
    
    // Use coalesced events if available for higher precision
    if (nativeEvent && typeof nativeEvent.getCoalescedEvents === 'function') {
        const coalesced = nativeEvent.getCoalescedEvents();
        for (const p of coalesced) {
            // Transform global screen coordinates to local world coordinates
            const localPos = this.worldContainer.toLocal({ x: p.clientX, y: p.clientY });
            this.currentStroke.points.push([localPos.x, localPos.y, p.pressure || 0.5]);
        }
    } else {
        // Fallback
        const localPos = this.worldContainer.toLocal(e.global);
        this.currentStroke.points.push([localPos.x, localPos.y, e.pressure || 0.5]);
    }
    
    this.renderStroke(this.currentStroke);
  }

  /**
   * End current stroke
   */
  endStroke(_e: FederatedPointerEvent): void {
    if (!this.currentStroke) return;
    
    // Ensure at least 2 points for visibility
    if (this.currentStroke.points.length < 2) {
       const p = this.currentStroke.points[0];
       // create a tiny dot
       this.currentStroke.points.push([p[0]+0.1, p[1]+0.1, p[2]]);
    }
    this.renderStroke(this.currentStroke);
    this.currentStroke = null;
  }

  /**
   * Render the stroke using perfect-freehand
   */
  private renderStroke(stroke: StrokeState): void {
    const { points, graphics } = stroke;
    
    // Clear previous render
    graphics.clear();
    
    if (points.length < 2) {
        if (points.length === 1) {
            // Draw a single dot
            const p = points[0];
            const size = (p[2] || 0.5) * 8;
            graphics.circle(p[0], p[1], size / 2);
            graphics.fill(0xFFFFFF);
        }
        return;
    }

    // Draw segments with variable width
    // This avoids the "loop fill" artifact of polygon rendering
    // while preserving pressure sensitivity.
    
    // We can use a simple smoothing (Chaikin) or just draw raw segments if density is high.
    // Given we have coalesced events, density should be decent.
    
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        const pressure = (p1[2] + p2[2]) / 2 || 0.5;
        const size = Math.max(2, pressure * 16); // Base size 16, min size 2
        
        graphics.moveTo(p1[0], p1[1]);
        graphics.lineTo(p2[0], p2[1]);
        graphics.stroke({ 
            width: size, 
            color: 0xFFFFFF, 
            alpha: 1, 
            cap: 'round', 
            join: 'round' 
        });
    }
  }

  private physicsTick(): void {
    // Viewport Inertia
    if (!this.viewport.isDragging) {
      this.viewport.vx *= PHYSICS_CONFIG.friction;
      this.viewport.vy *= PHYSICS_CONFIG.friction;
      this.viewport.x += this.viewport.vx;
      this.viewport.y += this.viewport.vy;
      if (Math.abs(this.viewport.vx) < PHYSICS_CONFIG.minVelocity) this.viewport.vx = 0;
      if (Math.abs(this.viewport.vy) < PHYSICS_CONFIG.minVelocity) this.viewport.vy = 0;
    }

    this.worldContainer.x = this.viewport.x;
    this.worldContainer.y = this.viewport.y;
    this.worldContainer.scale.set(this.viewport.scale);

    // Card Physics
    for (const [_cardId, { graphics, state }] of this.cards) {
      if (!state.isDragging) {
        const dx = state.targetX - state.x;
        const dy = state.targetY - state.y;
        const ax = (dx * PHYSICS_CONFIG.spring) / PHYSICS_CONFIG.mass;
        const ay = (dy * PHYSICS_CONFIG.spring) / PHYSICS_CONFIG.mass;

        state.vx += ax;
        state.vy += ay;
        state.vx *= PHYSICS_CONFIG.friction;
        state.vy *= PHYSICS_CONFIG.friction;
        state.x += state.vx;
        state.y += state.vy;

        graphics.x = state.x;
        graphics.y = state.y;
      }
    }
  }

  updateSelectionVisuals(selectedIds: Set<string>): void {
    for (const [cardId, { graphics }] of this.cards) {
      if (selectedIds.has(cardId)) {
        graphics.stroke({ color: 0x6366F1, width: 3, alpha: 1, alignment: 1 });
        graphics.tint = 0xFFFFFF;
        this.renderHandles(graphics);
      } else {
        graphics.stroke({ color: 0x000000, width: 1, alpha: 0.1, alignment: 0 });
        const anyGraphics = graphics as any;
        if (anyGraphics._handles) {
            anyGraphics._handles.destroy();
            anyGraphics._handles = undefined;
        }
      }
    }
  }

  private renderHandles(cardGraphics: Graphics): void {
      const anyGraphics = cardGraphics as any;
      if (anyGraphics._handles) {
          anyGraphics._handles.destroy();
      }

      const handlesContainer = new Container();
      const bounds = { width: 200, height: 150 }; 
      const handleSize = 10;
      const halfHandle = handleSize / 2;
      const color = 0xFFFFFF;
      const stroke = 0x6366F1;

      const createHandle = (x: number, y: number, cursor: string) => {
          const handle = new Graphics();
          handle.rect(0, 0, handleSize, handleSize);
          handle.fill(color);
          handle.stroke({ color: stroke, width: 1 });
          handle.x = x - halfHandle;
          handle.y = y - halfHandle;
          handle.cursor = cursor;
          handle.eventMode = 'static';
          handlesContainer.addChild(handle);
          return handle;
      };

      createHandle(0, 0, 'nw-resize');
      createHandle(bounds.width, 0, 'ne-resize');
      createHandle(bounds.width, bounds.height, 'se-resize');
      createHandle(0, bounds.height, 'sw-resize');
      createHandle(bounds.width / 2, 0, 'n-resize');
      createHandle(bounds.width, bounds.height / 2, 'e-resize');
      createHandle(bounds.width / 2, bounds.height, 's-resize');
      createHandle(0, bounds.height / 2, 'w-resize');

      cardGraphics.addChild(handlesContainer);
      anyGraphics._handles = handlesContainer;
  }

  setCursor(cursor: string): void {
    this.app.canvas.style.cursor = cursor;
  }

  startPan(e: FederatedPointerEvent): void {
    this.viewport.isDragging = true;
    this.viewport.vx = 0;
    this.viewport.vy = 0;
    this.viewport.lastPointerX = e.globalX;
    this.viewport.lastPointerY = e.globalY;
  }

  startDrag(e: FederatedPointerEvent, cardId: string): void {
    const card = this.cards.get(cardId);
    if (!card) return;

    const state = card.state;
    state.isDragging = true;
    state.vx = 0;
    state.vy = 0;
    card.graphics.cursor = 'grabbing';

    const localPos = this.worldContainer.toLocal(e.global);
    this.dragOffset.x = localPos.x - state.x;
    this.dragOffset.y = localPos.y - state.y;
  }

  setOnPositionChange(callback: PositionChangeCallback): void {
    this.onPositionChange = callback;
  }

  createCard(cardId: string, x: number, y: number, color: number = 0xFFE066, textContent: string = ''): Graphics {
    if (this.cards.has(cardId)) return this.cards.get(cardId)!.graphics;

    const graphics = new Graphics();
    graphics.roundRect(0, 0, 200, 150, 12);
    graphics.fill(color);
    graphics.stroke({ color: 0x000000, width: 1, alpha: 0.1 });
    graphics.x = x;
    graphics.y = y;
    graphics.eventMode = 'static';
    graphics.cursor = 'grab';

    const style = new TextStyle({
      fontFamily: 'Inter, sans-serif',
      fontSize: 16,
      fill: '#1f2937',
      wordWrap: true,
      wordWrapWidth: 180, // 200 - 2*10 padding
      lineHeight: 19.2, // 16 * 1.2
      breakWords: true, 
    });

    const text = new Text({ text: textContent, style });
    text.x = 10;
    text.y = 10;
    (graphics as any)._textNode = text;
    
    graphics.addChild(text);

    const state: PhysicsState = {
      x, y, vx: 0, vy: 0, targetX: x, targetY: y, isDragging: false, cardId,
    };

    this.cards.set(cardId, { graphics, state });

    graphics.on('pointerdown', (e: FederatedPointerEvent) => {
        interactionManager.handleCardDown(e, cardId);
    });

    this.worldContainer.addChild(graphics);
    return graphics;
  }

  updateCardPosition(cardId: string, x: number, y: number): void {
    const card = this.cards.get(cardId);
    if (card && !card.state.isDragging) {
      card.state.targetX = x;
      card.state.targetY = y;
    }
  }

  updateCardText(cardId: string, text: string): void {
    const card = this.cards.get(cardId);
    if (card) {
      const textNode = (card.graphics as any)._textNode as Text;
      if (textNode) {
        textNode.text = text;
      }
    }
  }

  getCardScreenBounds(cardId: string): { x: number, y: number, width: number, height: number } | null {
    const card = this.cards.get(cardId);
    if (!card) return null;
    
    // Get global (screen) position of the card container
    const globalPos = this.worldContainer.toGlobal({ x: card.state.x, y: card.state.y });
    const scale = this.worldContainer.scale.x; 

    // Assuming fixed card size logic for now, or read from graphics bounds?
    // Using the fixed 200x150 size scaled by viewport
    return {
      x: globalPos.x,
      y: globalPos.y,
      width: 200 * scale,
      height: 150 * scale,
    };
  }

  removeCard(cardId: string): void {
    const card = this.cards.get(cardId);
    if (card) {
      this.worldContainer.removeChild(card.graphics);
      card.graphics.destroy();
      this.cards.delete(cardId);
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
    this.cards.clear();
    this.strokes = [];
    this.onPositionChange = null;
    this.isInitialized = false;
  }

  eraseAt(x: number, y: number): void {
      const localPos = this.worldContainer.toLocal({ x, y });
      const radius = 10; // Eraser radius

      // Iterate backwards to erase top-most strokes first
      for (let i = this.strokes.length - 1; i >= 0; i--) {
          const stroke = this.strokes[i];
          const points = stroke.points;
          let hit = false;
          
          // Simple proximity check against points
          // A better approach is segment-point distance
          for (let j = 0; j < points.length - 1; j++) {
             const p1 = points[j];
             const p2 = points[j + 1];
             if (this.distToSegment(localPos.x, localPos.y, p1[0], p1[1], p2[0], p2[1]) < radius) {
                 hit = true;
                 break;
             }
          }

          if (hit) {
              // Remove stroke
              this.worldContainer.removeChild(stroke.graphics);
              stroke.graphics.destroy();
              this.strokes.splice(i, 1);
              // Break? or continue erasing "through" layers? Let's erase through.
          }
      }
  }

  private distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
      const l2 = (x1 - x2) ** 2 + (y1 - y2) ** 2;
      if (l2 === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
      let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.sqrt((px - (x1 + t * (x2 - x1))) ** 2 + (py - (y1 + t * (y2 - y1))) ** 2);
  }
}

export const canvasEngine = new CanvasEngine();
export { PHYSICS_CONFIG };
