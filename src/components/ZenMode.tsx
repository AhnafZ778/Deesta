import { useEffect, useRef, useState, useCallback } from 'react';

interface ZenModeProps {
  children: React.ReactNode;
  /** Delay in ms before UI fades out (default: 2000) */
  fadeDelay?: number;
}

/**
 * Zen Mode - Auto-hiding UI wrapper
 * The UI appears on any interaction and fades out after inactivity.
 */
export function ZenMode({ children, fadeDelay = 2000 }: ZenModeProps) {
  const [isVisible, setIsVisible] = useState(true);
  const timeoutRef = useRef<number | null>(null);

  const showUI = useCallback(() => {
    setIsVisible(true);
    
    // Clear existing timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    
    // Set new timeout to hide
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(false);
    }, fadeDelay);
  }, [fadeDelay]);

  useEffect(() => {
    // Show UI on any interaction
    const handleInteraction = () => showUI();

    // Events that show the UI
    window.addEventListener('mousemove', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('pointerdown', handleInteraction);
    window.addEventListener('wheel', handleInteraction);

    // Initial hide timeout
    showUI();

    return () => {
      window.removeEventListener('mousemove', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('pointerdown', handleInteraction);
      window.removeEventListener('wheel', handleInteraction);
      
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [showUI]);

  return (
    <div 
      className={`zen-mode-container ${isVisible ? 'zen-visible' : 'zen-hidden'}`}
      data-zen-visible={isVisible}
    >
      {children}
    </div>
  );
}

export default ZenMode;
