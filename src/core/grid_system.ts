import { Container, Graphics } from 'pixi.js';

export class GridSystem {
  private container: Container;
  private graphics: Graphics;
  private gridSize: number;
  private color: number;
  private alpha: number;

  constructor(gridSize: number = 50, color: number = 0xE5E7EB, alpha: number = 0.5) {
    this.container = new Container();
    this.graphics = new Graphics();
    this.container.addChild(this.graphics);
    this.gridSize = gridSize;
    this.color = color;
    this.alpha = alpha;
    
    // Initial draw
    this.update(0, 0, 1, window.innerWidth, window.innerHeight);
  }

  getContainer(): Container {
    return this.container;
  }

  update(viewX: number, viewY: number, scale: number, screenWidth: number, screenHeight: number): void {
    this.graphics.clear();
    
    // Calculate visible bounds in world coordinates
    // viewX/Y is the world container position. 
    // World coordinates visible:
    // startX = -viewX / scale
    // endX = (-viewX + screenWidth) / scale
    
    const startX = -viewX / scale;
    const startY = -viewY / scale;
    // Add extra buffer to avoid popping
    const endX = startX + (screenWidth / scale);
    const endY = startY + (screenHeight / scale);

    // Snap start to grid
    const effectiveGridSize = this.gridSize;
    const firstLineX = Math.floor(startX / effectiveGridSize) * effectiveGridSize;
    const firstLineY = Math.floor(startY / effectiveGridSize) * effectiveGridSize;

    // Draw lines
    // Fade out if zoomed out too far?
    // For now simple lines.
    
    // Vertical Lines
    for (let x = firstLineX; x < endX; x += effectiveGridSize) {
        this.graphics.moveTo(x, startY);
        this.graphics.lineTo(x, endY);
    }
    
    // Horizontal Lines
    for (let y = firstLineY; y < endY; y += effectiveGridSize) {
        this.graphics.moveTo(startX, y);
        this.graphics.lineTo(endX, y);
    }
    
    this.graphics.stroke({ color: this.color, width: 1 / scale, alpha: this.alpha }); // constant screen thickness 1px
  }
}
