import { useEffect, useState, useRef } from 'react';
import { canvasEngine } from '../core/canvas_engine';
import { documentStore } from '../core/document_store';


interface EditOverlayProps {
  cardId: string;
  onClose: () => void;
}

export function EditOverlay({ cardId, onClose }: EditOverlayProps) {
  const [bounds, setBounds] = useState<{ x: number, y: number, width: number, height: number } | null>(null);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Initial fetch
    const cardData = documentStore.getCard(cardId);
    if (cardData) {
      setText(cardData.text || '');
    }

    const updateBounds = () => {
        const b = canvasEngine.getCardScreenBounds(cardId);
        if (b) setBounds(b);
    };

    updateBounds();



    // We can hook into the canvas engine's ticker or add a listener if available.
    // Since we don't have a direct "onPan" event easily exposed without modifying core,
    // we'll rely on a simple polling check or global event listener for now.
    // actually, simpler: just close if the user scrolls or drags on the canvas (which they can't easily do *through* the overlay, 
    // but they might use shortcuts).
    
    // Better approach: If the user presses Space (pan mode), we close.
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space') {
            handleBlur();
        }
    };
    
    window.addEventListener('keydown', handleGlobalKeyDown);
    
    // Update bounds on window resize
    window.addEventListener('resize', updateBounds);
    window.addEventListener('wheel', handleBlur); // Close on zoom

    // Focus
    if (textareaRef.current) {
        textareaRef.current.focus();
        // Set cursor to end
        const len = (cardData?.text || '').length;
        textareaRef.current.setSelectionRange(len, len);
    }

    return () => {
        window.removeEventListener('keydown', handleGlobalKeyDown);
        window.removeEventListener('resize', updateBounds);
        window.removeEventListener('wheel', handleBlur);
    };
  }, [cardId]);

  const handleBlur = () => {
    // Save and Close
    // We check if ref exists because this might be called multiple times due to event listeners
    if (textareaRef.current) {
        documentStore.updateCard(cardId, { text: textareaRef.current.value });
        onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop propagation so we don't trigger global shortcuts
    e.stopPropagation();

    if (e.key === 'Escape') {
      handleBlur(); 
    }
    // Command+Enter to submit/close
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        handleBlur();
    }
  };

  if (!bounds) return null;

  // Calculate font size based on zoom level (bounds.width / original width 200)
  const scale = bounds.width / 200;

  return (
    <div 
      className="fixed z-50"
      style={{
        left: bounds.x,
        top: bounds.y,
        width: bounds.width,
        height: bounds.height,
        pointerEvents: 'none', // Allow clicks to pass through to canvas? No, we need to type.
                               // But we clearly want it to capture input.
      }}
    >
      <textarea
        ref={textareaRef}
        defaultValue={text}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-full h-full resize-none bg-transparent outline-none font-sans"
        style={{
          pointerEvents: 'auto',
          fontSize: `${16 * scale}px`, 
          lineHeight: '1.2', 
          color: '#1f2937',
          padding: `${10 * scale}px`, // Match the text.x = 10 and text.y = 10 in CanvasEngine
          fontFamily: 'Inter, sans-serif',
        }}
        placeholder="Type something..."
      />
    </div>
  );
}
