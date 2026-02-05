/**
 * The "Gravity" Canvas Engine
 * This module creates a WebGPU-accelerated Pixi.js v8 application
 * with custom Verlet physics for smooth, mass-based interactions.
 */

import { Application, Container, Graphics, FederatedPointerEvent, Text, TextStyle, Sprite } from 'pixi.js';
import { interactionManager, InteractionMode } from './interaction_manager';
import { Quadtree, type Rect } from '../utils/quadtree';
import { GridSystem } from './grid_system';


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
  dragOffsetX: number;
  dragOffsetY: number;
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

// Connection State
interface Connection {
  id: string;
  fromId: string;
  toId: string;
}

// Callback for position changes (for persistence)
type PositionChangeCallback = (cardId: string, x: number, y: number) => void;
type ConnectionCreatedCallback = (fromId: string, toId: string) => void;
type StrokeFinishedCallback = (id: string, points: number[][]) => void;
type StrokeDeletedCallback = (id: string) => void;

export class CanvasEngine {
  private app: Application;
  private worldContainer: Container;
  private viewport: ViewportState;
  private isInitialized: boolean = false;
  private cards: Map<string, { graphics: Graphics; state: PhysicsState }> = new Map();
  private connections: Map<string, Connection> = new Map();
  private strokes: StrokeState[] = []; // Track all strokes
  private selectionGraphics: Graphics = new Graphics(); 
  private connectionsGraphics: Graphics = new Graphics();
  private cursorContainer: Container = new Container();
  private remoteCursors: Map<number, Graphics> = new Map();
  
  // Spatial Index
  private strokeQuadtree: Quadtree<any>;
  private cardQuadtree: Quadtree<any>;
  
  private gridSystem: GridSystem;
  
  // Callbacks
  private onPositionChange: PositionChangeCallback | null = null;
  private onConnectionCreated: ConnectionCreatedCallback | null = null;
  private onStrokeFinished: StrokeFinishedCallback | null = null;
  private onStrokeDeleted: StrokeDeletedCallback | null = null;
  private onCursorMove: ((x: number, y: number) => void) | null = null;
  private onRequestCreateCard: ((x: number, y: number, imageUrl?: string) => void) | null = null;
  
  // Current drawing stroke
  private currentStroke: StrokeState | null = null;

  getWorldContainer(): Container {
    return this.worldContainer;
  }

  constructor() {
    this.app = new Application();
    this.worldContainer = new Container();
    this.viewport = {
      x: 0, y: 0, scale: 1, vx: 0, vy: 0,
      isDragging: false, lastPointerX: 0, lastPointerY: 0,
    };
    
    const worldBounds = { x: -50000, y: -50000, width: 100000, height: 100000 };
    this.strokeQuadtree = new Quadtree(worldBounds);
    this.cardQuadtree = new Quadtree(worldBounds);
    
    this.gridSystem = new GridSystem();
    
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
    this.selectionGraphics = new Graphics();
    this.connectionsGraphics = new Graphics();
    this.worldContainer.addChild(this.connectionsGraphics);
    this.worldContainer.addChild(this.selectionGraphics);
    this.worldContainer.addChild(this.cursorContainer);
    
    this.app.stage.addChild(this.gridSystem.getContainer());
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

    // Native Drag & Drop for Images
    const canvas = this.app.canvas;
    canvas.addEventListener('dragover', (e) => {
        e.preventDefault(); // allow dropping
    });
    
    canvas.addEventListener('drop', (e) => {
        e.preventDefault();
        
        if (e.dataTransfer && e.dataTransfer.files) {
            const files = Array.from(e.dataTransfer.files);
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            
            imageFiles.forEach(file => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const dataUrl = event.target?.result as string;
                    if (dataUrl) {
                        // Create card at drop position?
                        // e.clientX is screen pos.
                        const rect = canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        
                        const localPos = this.worldContainer.toLocal({ x, y });
                        
                        // We need to trigger connection event or direct store call?
                        // Current architecture: CanvasEngine just calls callbacks.
                        // But createCard doesn't trigger "cardCreated" callback yet...
                        // We usually create via App -> DocumentStore -> CanvasEngine.
                        // BUT, here the event starts in CanvasEngine (UI).
                        
                        // We should expose a callback "onRequestCreateCard"?
                        // Or just modify App.tsx to handle the drop on container?
                        
                        // Easier: Dispatch a custom event or callback.
                        if (this.onRequestCreateCard) {
                            this.onRequestCreateCard(localPos.x, localPos.y, dataUrl);
                        }
                    }
                };
                reader.readAsDataURL(file);
            });
        }
    });

    // Delegated Global Move
    stage.on('globalpointermove', (e: FederatedPointerEvent) => {
       interactionManager.handleGlobalMove(e);

       const mode = interactionManager.getMode();

       // Eraser
       if (mode === InteractionMode.ERASING && e.buttons === 1) { // Check for left click drag
           this.eraseAt(e.globalX, e.globalY);
           return;
       }

       // Broadcast cursor position (World Coordinates)
       if (this.onCursorMove) {
           const localPos = this.worldContainer.toLocal(e.global);
           this.onCursorMove(localPos.x, localPos.y);
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
      const localMousePos = this.worldContainer.toLocal(e.global);
      
      for (const [_cardId, { state, graphics }] of this.cards) {
         if (state.isDragging) {
            const newX = localMousePos.x - state.dragOffsetX;
            const newY = localMousePos.y - state.dragOffsetY;

            // Calculate throw velocity
            state.vx = (newX - state.x) / PHYSICS_CONFIG.mass;
            state.vy = (newY - state.y) / PHYSICS_CONFIG.mass;

            state.x = newX;
            state.y = newY;
            
            // Snap to Grid (50px)
            const gridSize = 50;
            state.targetX = Math.round(newX / gridSize) * gridSize;
            state.targetY = Math.round(newY / gridSize) * gridSize;
            
            graphics.x = state.x;
            graphics.y = state.y;
         }
       }
    });

    // Pointer Up
    const onUp = (e: FederatedPointerEvent) => {
      interactionManager.handleGlobalUp(e);

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
    
    // Assign an ID locally immediately
    const strokeId = crypto.randomUUID();
    (this.currentStroke as any).id = strokeId;
    
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
    
    if (this.onStrokeFinished) {
        this.onStrokeFinished((this.currentStroke as any).id, this.currentStroke.points);
    }
    
    // Index the stroke
    const bounds = this.getStrokeBounds(this.currentStroke);
    this.strokeQuadtree.insert({ id: (this.currentStroke as any).id, stroke: this.currentStroke }, bounds);

    this.currentStroke = null;
  }
  
  private getStrokeBounds(stroke: StrokeState): Rect {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    // Add some padding for width
    const padding = 20; 
    for (const p of stroke.points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
    }
    return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
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
    
    this.gridSystem.update(
        this.viewport.x, 
        this.viewport.y, 
        this.viewport.scale, 
        this.app.screen.width, 
        this.app.screen.height
    );

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
    this.renderConnections();
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

  startDrag(e: FederatedPointerEvent, cardId: string, selectedIds?: Set<string>): void {
    const targets = new Set<string>();
    
    // If the clicked card is part of the selection, drag all selected cards
    if (selectedIds && selectedIds.has(cardId)) {
        selectedIds.forEach(id => targets.add(id));
    } else {
        // Otherwise only drag the clicked card
        targets.add(cardId);
    }

    const localPos = this.worldContainer.toLocal(e.global);

    for (const id of targets) {
        const card = this.cards.get(id);
        if (card) {
            const state = card.state;
            state.isDragging = true;
            state.vx = 0;
            state.vy = 0;
            card.graphics.cursor = 'grabbing';
            // Calculate offset for each card relative to the SINGLE mouse pointer
            state.dragOffsetX = localPos.x - state.x;
            state.dragOffsetY = localPos.y - state.y;
        }
    }
  }

  setOnPositionChange(callback: PositionChangeCallback): void {
    this.onPositionChange = callback;
  }
  
  setPersistenceCallbacks(callbacks: {
      onConnectionCreated: ConnectionCreatedCallback;
      onStrokeFinished: StrokeFinishedCallback;
      onStrokeDeleted: StrokeDeletedCallback;
  }): void {
      this.onConnectionCreated = callbacks.onConnectionCreated;
      this.onStrokeFinished = callbacks.onStrokeFinished;
      this.onStrokeDeleted = callbacks.onStrokeDeleted;
  }
  
  setOnCursorMove(callback: (x: number, y: number) => void): void {
      this.onCursorMove = callback;
  }

  setOnRequestCreateCard(callback: (x: number, y: number, imageUrl?: string) => void): void {
      this.onRequestCreateCard = callback;
  }

  /**
   * Hydrate from persistence
   */
  hydrate(cards: any[], connections: any[], strokes: any[]): void {
      // 1. Cards
      const incomingCardIds = new Set(cards.map(c => c.id));
      for (const id of this.cards.keys()) {
          if (!incomingCardIds.has(id)) this.removeCard(id);
      }
      for (const c of cards) {
           const existing = this.cards.get(c.id);
           if (!existing) {
               this.createCard(c.id, c.x, c.y, c.color, c.text, c.imageUrl);
           } else {
               if (!existing.state.isDragging) {
                   this.updateCardPosition(c.id, c.x, c.y);
               }
               this.updateCardText(c.id, c.text);
           }
      }

      // 2. Connections
      const incomingConnIds = new Set(connections.map(c => c.id));
      for (const id of this.connections.keys()) {
          if (!incomingConnIds.has(id)) this.connections.delete(id);
      }
      for (const c of connections) {
          if (!this.connections.has(c.id)) {
              this.connections.set(c.id, { id: c.id, fromId: c.fromId, toId: c.toId });
          }
      }

      // 3. Strokes
      const incomingStrokeIds = new Set(strokes.map(s => s.id));
      for (let i = this.strokes.length - 1; i >= 0; i--) {
          const s = this.strokes[i] as any;
          if (s.id && !incomingStrokeIds.has(s.id)) {
              this.worldContainer.removeChild(s.graphics);
              s.graphics.destroy();
              this.strokes.splice(i, 1);
          }
      }
      const existingStrokeIds = new Set(this.strokes.map(s => (s as any).id));
      for (const s of strokes) {
          if (!existingStrokeIds.has(s.id)) {
              const graphics = new Graphics();
              this.worldContainer.addChild(graphics);
              const strokeState: StrokeState = { points: s.points, graphics };
              (strokeState as any).id = s.id;
              this.renderStroke(strokeState);
              this.strokes.push(strokeState);
          }
      }
  }

  createCard(cardId: string, x: number, y: number, color: number = 0xFFE066, textContent: string = '', imageUrl?: string): Graphics {
    if (this.cards.has(cardId)) return this.cards.get(cardId)!.graphics;

    const graphics = new Graphics();
    graphics.roundRect(0, 0, 200, 150, 12);
    graphics.fill(color);
    graphics.stroke({ color: 0x000000, width: 1, alpha: 0.1 });
    graphics.x = x;
    graphics.y = y;
    graphics.eventMode = 'static';
    graphics.cursor = 'grab';

    // Image Handling
    if (imageUrl) {
        // Create a mask for rounded corners
        const mask = new Graphics();
        mask.roundRect(0, 0, 200, 150, 12);
        mask.fill(0xFFFFFF);
        graphics.addChild(mask);

        // Load texture
        const sprite = Sprite.from(imageUrl);
        sprite.mask = mask;
        
        // Wait for texture to load to correct aspect ratio
        if (sprite.texture.label === 'EMPTY') { // Check if not immediately available
             sprite.texture.source.on('update', () => {
                 this.fitSprite(sprite, 200, 150);
             });
        } else {
            this.fitSprite(sprite, 200, 150);
        }
        graphics.addChild(sprite);
    }

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
      x, y, vx: 0, vy: 0, targetX: x, targetY: y, 
      isDragging: false, 
      dragOffsetX: 0, 
      dragOffsetY: 0,
      cardId,
    };

    this.cards.set(cardId, { graphics, state });

    graphics.on('pointerdown', (e: FederatedPointerEvent) => {
        interactionManager.handleCardDown(e, cardId);
    });

    graphics.on('pointerup', (e: FederatedPointerEvent) => {
        interactionManager.handleCardUp(e, cardId);
    });

    this.worldContainer.addChild(graphics);
    
    // Index Card
    this.cardQuadtree.insert(
        { id: cardId }, 
        { x, y, width: 200, height: 150 }
    );
    
    return graphics;
  }

  private fitSprite(sprite: Sprite, width: number, height: number): void {
      const texture = sprite.texture;
      if (!texture) return;
      
      const ratio = texture.width / texture.height;
      const targetRatio = width / height;
      
      // "Cover" behavior
      if (ratio > targetRatio) {
          sprite.height = height;
          sprite.width = height * ratio;
      } else {
          sprite.width = width;
          sprite.height = width / ratio;
      }
      
      // Center it
      sprite.x = (width - sprite.width) / 2;
      sprite.y = (height - sprite.height) / 2;
  }

  updateCardPosition(cardId: string, x: number, y: number): void {
    const card = this.cards.get(cardId);
    if (card && !card.state.isDragging) {
      card.state.targetX = x;
      card.state.targetY = y;
      
      // Update Index
      this.cardQuadtree.remove(cardId);
      this.cardQuadtree.insert({ id: cardId }, { x, y, width: 200, height: 150 });
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
      const radius = 20; 
      
      const searchBounds = { 
          x: localPos.x - radius, 
          y: localPos.y - radius, 
          width: radius * 2, 
          height: radius * 2 
      };

      const candidates: { id: string, stroke: StrokeState }[] = [];
      this.strokeQuadtree.retrieve(candidates, searchBounds);
      
      // We want to remove top-most first, which usually means last drawn.
      // Candidates from quadtree might not be ordered.
      // But we can just process all hits. If we want "erase one by one", that's different.
      // Current behavior implies erasing everything under cursor.
      
      const hits: string[] = [];

      for (const item of candidates) {
          const stroke = item.stroke;
          const points = stroke.points;
          let hit = false;
          
          for (let j = 0; j < points.length - 1; j++) {
             const p1 = points[j];
             const p2 = points[j + 1];
             const dist = this.distToSegment(localPos.x, localPos.y, p1[0], p1[1], p2[0], p2[1]);
             if (dist < radius) {
                 hit = true;
                 break;
             }
          }
          
          if (hit) {
              const strokeId = (stroke as any).id;
              if (strokeId && !hits.includes(strokeId)) {
                  hits.push(strokeId);
              }
          }
      }
      
      for(const id of hits) {
          if (this.onStrokeDeleted) {
               this.onStrokeDeleted(id);
          }
          
          // Remove from Quadtree
          this.strokeQuadtree.remove(id);
          
          // Remove from local array and scene
          const idx = this.strokes.findIndex(s => (s as any).id === id);
          if (idx !== -1) {
              const s = this.strokes[idx];
              this.worldContainer.removeChild(s.graphics);
              s.graphics.destroy();
              this.strokes.splice(idx, 1);
          }
      }
  }

  updateSelectionBox(x: number, y: number, width: number, height: number): void {
      this.selectionGraphics.clear();
      this.selectionGraphics.rect(x, y, width, height);
      this.selectionGraphics.fill({ color: 0x6366F1, alpha: 0.1 }); // Blue transparent
      this.selectionGraphics.stroke({ color: 0x6366F1, width: 1 });
  }

  clearSelectionBox(): void {
      this.selectionGraphics.clear();
  }

  getCardsInRect(x: number, y: number, width: number, height: number): string[] {
      const found: string[] = [];
      // Normalize rect
      const rx = width < 0 ? x + width : x;
      const ry = height < 0 ? y + height : y;
      const rw = Math.abs(width);
      const rh = Math.abs(height);
      
      const candidates: { id: string }[] = [];
      this.cardQuadtree.retrieve(candidates, { x: rx, y: ry, width: rw, height: rh });

      for (const { id } of candidates) {
          const card = this.cards.get(id);
          if (card) {
               // Simple AABB collision
              // Card size is fixed 200x150 for now
              const cw = 200;
              const ch = 150;
              const state = card.state;
              
              if (state.x < rx + rw &&
                  state.x + cw > rx &&
                  state.y < ry + rh &&
                  state.y + ch > ry) {
                  found.push(id);
              }
          }
      }
      return found;
  }

  createConnection(fromId: string, toId: string): void {
      const id = `${fromId}-${toId}`;
      if (this.connections.has(id)) return;
      this.connections.set(id, { id, fromId, toId });
      
      if (this.onConnectionCreated) {
          this.onConnectionCreated(fromId, toId);
      }
  }

  private renderConnections(): void {
      this.connectionsGraphics.clear();
      for (const connection of this.connections.values()) {
          const fromCard = this.cards.get(connection.fromId);
          const toCard = this.cards.get(connection.toId);
          if (fromCard && toCard) {
              const startX = fromCard.state.x + 100;
              const startY = fromCard.state.y + 75;
              const endX = toCard.state.x + 100; // Center
              const endY = toCard.state.y + 75;
              
              this.connectionsGraphics.moveTo(startX, startY);
              this.connectionsGraphics.lineTo(endX, endY);
              this.connectionsGraphics.stroke({ color: 0x9CA3AF, width: 2, alpha: 0.6 });
              
              // Arrowhead
              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;
              const angle = Math.atan2(endY - startY, endX - startX);
              const headlen = 10;
              
              this.connectionsGraphics.moveTo(midX, midY);
              this.connectionsGraphics.lineTo(midX - headlen * Math.cos(angle - Math.PI / 6), midY - headlen * Math.sin(angle - Math.PI / 6));
              this.connectionsGraphics.moveTo(midX, midY);
              this.connectionsGraphics.lineTo(midX - headlen * Math.cos(angle + Math.PI / 6), midY - headlen * Math.sin(angle + Math.PI / 6));
              this.connectionsGraphics.stroke({ color: 0x9CA3AF, width: 2, alpha: 0.6 });
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

  setupAwareness(awareness: any): void {
      if (!awareness) return;
      
      awareness.on('change', (changes: any) => {
          const states = awareness.getStates();
          
          // Remove disconnected users
          changes.removed.forEach((clientId: number) => {
              const cursor = this.remoteCursors.get(clientId);
              if (cursor) {
                  this.cursorContainer.removeChild(cursor);
                  cursor.destroy();
                  this.remoteCursors.delete(clientId);
              }
          });

          // Update added/updated users
          states.forEach((state: any, clientId: number) => {
              if (clientId === awareness.clientID) return; // Don't render self
              
              let cursor = this.remoteCursors.get(clientId);
              if (!cursor) {
                  cursor = new Graphics();
                  // Simple cursor shape
                  cursor.circle(0, 0, 5);
                  cursor.fill(state.color || 0xFF0000);
                  
                  // Label
                  const text = new Text({ text: state.name || 'User', style: { fontSize: 12, fill: state.color || 0xFF0000 } });
                  text.y = 10;
                  cursor.addChild(text);
                  
                  this.cursorContainer.addChild(cursor);
                  this.remoteCursors.set(clientId, cursor);
              }
              
              if (state.x != null && state.y != null) {
                  cursor.x = state.x;
                  cursor.y = state.y;
                  
                  // Update color/name if changed
                  cursor.tint = state.color || 0xFF0000;
              }
          });
      });
  }
}

export const canvasEngine = new CanvasEngine();
export { PHYSICS_CONFIG };
