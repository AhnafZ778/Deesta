import { useEffect, useState } from 'react';
import { interactionManager, InteractionMode } from '../core/interaction_manager';
import { canvasEngine } from '../core/canvas_engine';

export function Toolbar() {
  const [mode, setMode] = useState<InteractionMode>(InteractionMode.IDLE);

  useEffect(() => {
    // Subscribe to state changes instead of polling
    const unsubscribe = interactionManager.subscribe((newMode) => {
      setMode(newMode);
    });
    return unsubscribe;
  }, []);

  const setTool = (m: InteractionMode, cursor: string) => {
    interactionManager.setMode(m);
    canvasEngine.setCursor(cursor); // We can still call this safely now that we fixed the cycle? Yes.
    // Or we can rely on InteractionManager if we updated it to invoke engine.setCursor.
  };

  return (
    <div className="toolbar-dock">
      
      <ToolButton 
        active={mode === InteractionMode.IDLE || mode === InteractionMode.SELECTING}
        onClick={() => setTool(InteractionMode.IDLE, 'default')}
        label="Select (V)"
        icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>}
      />
      
      <div className="toolbar-divider" />

      <ToolButton 
        active={mode === InteractionMode.PANNING}
        onClick={() => setTool(InteractionMode.PANNING, 'grab')}
        label="Pan (Space)"
        icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a.9.9 0 0 1 0-1.27l2.49-2.48a.9.9 0 0 1 1.26 0l2.14 2.14"/></svg>}
      />

      <ToolButton 
        active={mode === InteractionMode.DRAWING}
        onClick={() => setTool(InteractionMode.DRAWING, 'crosshair')}
        label="Pen (P)"
        icon={<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>}
      />
    </div>
  );
}

function ToolButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`tool-button ${active ? 'active' : ''}`}
    >
      {active && <span className="tool-button-indicator" />}
      {icon}
    </button>
  );
}
