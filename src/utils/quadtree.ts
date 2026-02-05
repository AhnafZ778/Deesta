
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class Quadtree<T extends { id: string }> {
  private bounds: Rect;
  private capacity: number;
  private maxLevel: number;
  private level: number;
  private objects: { item: T; bounds: Rect }[];
  private nodes: Quadtree<T>[];

  constructor(bounds: Rect, capacity: number = 10, maxLevel: number = 5, level: number = 0) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.maxLevel = maxLevel;
    this.level = level;
    this.objects = [];
    this.nodes = [];
  }

  clear(): void {
    this.objects = [];
    for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].clear();
    }
    this.nodes = [];
  }

  insert(item: T, itemBounds: Rect): void {
    if (this.nodes.length) {
      const index = this.getIndex(itemBounds);
      if (index !== -1) {
        this.nodes[index].insert(item, itemBounds);
        return;
      }
    }

    this.objects.push({ item, bounds: itemBounds });

    if (this.objects.length > this.capacity && this.level < this.maxLevel) {
      if (!this.nodes.length) {
        this.split();
      }

      let i = 0;
      while (i < this.objects.length) {
        const obj = this.objects[i];
        const index = this.getIndex(obj.bounds);
        if (index !== -1) {
          this.objects.splice(i, 1);
          this.nodes[index].insert(obj.item, obj.bounds);
        } else {
          i++;
        }
      }
    }
  }

  retrieve(returnObjects: T[], requestBounds: Rect): T[] {
    const index = this.getIndex(requestBounds);
    if (index !== -1 && this.nodes.length) {
      this.nodes[index].retrieve(returnObjects, requestBounds);
    } else if (this.nodes.length) {
        // If request overlaps multiple nodes, we might need to check all overlapping nodes
        // But strict getIndex returns -1 if not fitting purely in one quadrant.
        // So if -1, we must search ALL nodes? Or strict intersection?
        // Standard quadtree usually returns all potential collisions from all nodes that intersect the requestBounds.
        // My getIndex might be too simple.
        // Let's change the strategy: check ALL nodes that intersect the rect.
        for(let i=0; i<this.nodes.length; i++) {
            // Simple overlap check with node bounds
            if (this.intersects(this.nodes[i].bounds, requestBounds)) {
                this.nodes[i].retrieve(returnObjects, requestBounds);
            }
        }
    }

    // Add objects from this level
    for(const obj of this.objects) {
        // Optional: Exact check? Usually return candidates.
        // Let's return only intersecting candidates to be slightly more precise, or valid candidates.
        // To be safe and fast, just return everything in the bucket that COULD touch.
        returnObjects.push(obj.item);
    }

    return returnObjects;
  }
  
  // Helper to get ALL items (for debugging or broad phases)
  getAll(): T[] {
      let items: T[] = this.objects.map(o => o.item);
      for (const node of this.nodes) {
          items = items.concat(node.getAll());
      }
      return items;
  }
  
  remove(itemId: string): void {
      // If we know the bounds, we can traverse efficiently.
      // If not, we might have to search everything?
      // Assuming we pass bounds for efficiency, or we just rebuild if dynamic.
      // For now, simple implementation: recursively find and remove.
      
      this.removeById(itemId);
  }
  
  private removeById(id: string): boolean {
      const idx = this.objects.findIndex(o => o.item.id === id);
      if (idx !== -1) {
          this.objects.splice(idx, 1);
          return true;
      }
      for(const node of this.nodes) {
          if (node.removeById(id)) return true;
      }
      return false;
  }

  private getIndex(rect: Rect): number {
    const verticalMidpoint = this.bounds.x + (this.bounds.width / 2);
    const horizontalMidpoint = this.bounds.y + (this.bounds.height / 2);

    const topQuadrant = (rect.y < horizontalMidpoint && rect.y + rect.height < horizontalMidpoint);
    const bottomQuadrant = (rect.y > horizontalMidpoint);
    
    // This strict fitting means items on the line belong to THIS node, not children.
    
    if (rect.x < verticalMidpoint && rect.x + rect.width < verticalMidpoint) {
      if (topQuadrant) return 1; // NW
      if (bottomQuadrant) return 2; // SW
    } else if (rect.x > verticalMidpoint) {
      if (topQuadrant) return 0; // NE
      if (bottomQuadrant) return 3; // SE
    }

    return -1;
  }

  private split(): void {
    const subWidth = this.bounds.width / 2;
    const subHeight = this.bounds.height / 2;
    const x = this.bounds.x;
    const y = this.bounds.y;

    this.nodes[0] = new Quadtree({ x: x + subWidth, y: y, width: subWidth, height: subHeight }, this.capacity, this.maxLevel, this.level + 1);
    this.nodes[1] = new Quadtree({ x: x, y: y, width: subWidth, height: subHeight }, this.capacity, this.maxLevel, this.level + 1);
    this.nodes[2] = new Quadtree({ x: x, y: y + subHeight, width: subWidth, height: subHeight }, this.capacity, this.maxLevel, this.level + 1);
    this.nodes[3] = new Quadtree({ x: x + subWidth, y: y + subHeight, width: subWidth, height: subHeight }, this.capacity, this.maxLevel, this.level + 1);
  }
  
  private intersects(a: Rect, b: Rect): boolean {
      return a.x < b.x + b.width &&
             a.x + a.width > b.x &&
             a.y < b.y + b.height &&
             a.y + a.height > b.y;
  }
}
