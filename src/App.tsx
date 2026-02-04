import { useEffect, useRef, useState, useCallback } from 'react';
import './index.css';
import { canvasEngine } from './core/canvas_engine';
import { interactionManager, InteractionMode } from './core/interaction_manager';
import { documentStore } from './core/document_store';
import type { CardData } from './core/document_store';
import { ZenMode } from './components/ZenMode';
import { GodBar } from './components/GodBar';
import { Toolbar } from './components/Toolbar';
import { EditOverlay } from './components/EditOverlay';

function App() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);
  const [isGodBarOpen, setIsGodBarOpen] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Handle Cmd+K shortcut
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setIsGodBarOpen(prev => !prev);
    }
    if (e.key === 'Escape') {
      setIsGodBarOpen(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  useEffect(() => {
    // Wire up edit start
    interactionManager.setOnEditStart((cardId) => {
      setEditingCardId(cardId);
    });

    const container = canvasContainerRef.current;
    if (!container || isInitialized.current) return;
    // ... initialization code


    isInitialized.current = true;

    // Initialize both the canvas engine and document store
    const initApp = async () => {
      // Initialize document store first (loads persisted data)
      await documentStore.init('master-whiteboard');

      // Initialize canvas engine
      await canvasEngine.init(container);
      
      // Inject dependency
      interactionManager.setEngine(canvasEngine);

      // Wire up persistence callback
      canvasEngine.setOnPositionChange((cardId, x, y) => {
        documentStore.updateCardPosition(cardId, x, y);
      });

      // Get existing cards from store
      const existingCards = documentStore.getAllCards();

      if (existingCards.size === 0) {
        // Create initial demo cards
        console.log('[App] Creating initial demo cards...');
        const colors = [0xFFE066, 0x66D9FF, 0xFF6B9D, 0x9DFF6B, 0xC4A7FF];

        for (let i = 0; i < 25; i++) {
          const x = 100 + (i % 5) * 250;
          const y = 100 + Math.floor(i / 5) * 200;
          const color = colors[i % colors.length];

          // Create in document store (persisted)
          const cardData = documentStore.createCard({
            x,
            y,
            width: 200,
            height: 150,
            color,
            text: '',
          });

          // Create in canvas engine (visual)
          canvasEngine.createCard(cardData.id, cardData.x, cardData.y, cardData.color, cardData.text);
        }
      } else {
        // Load existing cards from store
        console.log(`[App] Loading ${existingCards.size} persisted cards...`);
        for (const [cardId, cardData] of existingCards) {
          canvasEngine.createCard(cardId, cardData.x, cardData.y, cardData.color, cardData.text);
        }
      }

      // Subscribe to document changes (for real-time sync)
      documentStore.subscribe((cards: Map<string, CardData>) => {
        for (const [cardId, cardData] of cards) {
          canvasEngine.updateCardPosition(cardId, cardData.x, cardData.y);
          canvasEngine.updateCardText(cardId, cardData.text);
        }
      });

      console.log('[App] Whiteboard initialized with Local-First persistence!');
    };

    initApp().catch(console.error);

    return () => {
      canvasEngine.destroy();
      documentStore.destroy();
      isInitialized.current = false;
    };
  }, []);

  return (
    <div className="app-container">
      {/* The Pixi.js canvas will be injected here */}
      <div ref={canvasContainerRef} className="canvas-container" />

      {/* Zen Mode UI Overlay - auto-hides after inactivity */}
      <ZenMode fadeDelay={3000}>
        <Toolbar />
        <div className="zen-overlay" style={{ animation: 'none', opacity: 1 }}>
          <div className="zen-hint">
            <span className="hint-key">⌘K</span> command palette
            <span className="hint-separator">·</span>
            <span className="hint-key">Scroll</span> to zoom
            <span className="hint-separator">·</span>
            <span className="hint-key">Drag</span> canvas to pan
            <span className="hint-separator">·</span>
            <span className="hint-badge">💾 Local-First</span>
          </div>
        </div>
      </ZenMode>

      {/* God Bar (Command Palette) */}
      <GodBar 
        isOpen={isGodBarOpen} 
        onClose={() => setIsGodBarOpen(false)} 
      />

      {/* Edit Overlay */}
      {editingCardId && (
        <EditOverlay 
          cardId={editingCardId} 
          onClose={() => {
            setEditingCardId(null);
            interactionManager.setMode(InteractionMode.IDLE);
          }} 
        />
      )}
    </div>
  );
}

export default App;
