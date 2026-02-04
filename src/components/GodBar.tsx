import { useEffect, useRef, useState, useCallback } from 'react';
import { documentStore } from '../core/document_store';
import { canvasEngine } from '../core/canvas_engine';

interface Command {
  id: string;
  name: string;
  shortcut?: string;
  icon?: string;
  action: () => void;
}

interface GodBarProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * God Bar - Cmd+K Command Palette
 * The ultimate power-user interface for quick actions.
 */
export function GodBar({ isOpen, onClose }: GodBarProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Available commands
  const commands: Command[] = [
    {
      id: 'new-card',
      name: 'Create New Card',
      shortcut: 'N',
      icon: '➕',
      action: () => {
        const colors = [0xFFE066, 0x66D9FF, 0xFF6B9D, 0x9DFF6B, 0xC4A7FF];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const x = 200 + Math.random() * 400;
        const y = 200 + Math.random() * 300;
        
        const card = documentStore.createCard({
          x, y,
          width: 200,
          height: 150,
          color,
          text: '',
        });
        canvasEngine.createCard(card.id, card.x, card.y, card.color);
        onClose();
      },
    },
    {
      id: 'clear-board',
      name: 'Clear All Cards',
      shortcut: '⌫',
      icon: '🗑️',
      action: () => {
        const allCards = documentStore.getAllCards();
        for (const [cardId] of allCards) {
          documentStore.deleteCard(cardId);
          canvasEngine.removeCard(cardId);
        }
        onClose();
      },
    },
    {
      id: 'reset-view',
      name: 'Reset View',
      shortcut: '0',
      icon: '🔄',
      action: () => {
        // Reset viewport to origin (this would need a method on canvasEngine)
        onClose();
      },
    },
    {
      id: 'export-json',
      name: 'Export as JSON',
      shortcut: 'E',
      icon: '📤',
      action: () => {
        const cards = Array.from(documentStore.getAllCards().values());
        const json = JSON.stringify(cards, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whiteboard-export.json';
        a.click();
        URL.revokeObjectURL(url);
        onClose();
      },
    },
    {
      id: 'toggle-theme',
      name: 'Toggle Theme',
      shortcut: 'T',
      icon: '🌓',
      action: () => {
        document.body.classList.toggle('light-mode');
        onClose();
      },
    },
  ];

  // Filter commands by query
  const filteredCommands = commands.filter(cmd =>
    cmd.name.toLowerCase().includes(query.toLowerCase())
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
      }
    }
  }, [filteredCommands, selectedIndex, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  return (
    <div className="godbar-overlay" onClick={onClose}>
      <div className="godbar-container" onClick={e => e.stopPropagation()}>
        <div className="godbar-input-wrapper">
          <span className="godbar-icon">⌘</span>
          <input
            ref={inputRef}
            type="text"
            className="godbar-input"
            placeholder="Type a command..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        
        <div className="godbar-commands">
          {filteredCommands.map((cmd, index) => (
            <button
              key={cmd.id}
              className={`godbar-command ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => cmd.action()}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="command-icon">{cmd.icon}</span>
              <span className="command-name">{cmd.name}</span>
              {cmd.shortcut && (
                <span className="command-shortcut">{cmd.shortcut}</span>
              )}
            </button>
          ))}
          
          {filteredCommands.length === 0 && (
            <div className="godbar-empty">
              No commands found for "{query}"
            </div>
          )}
        </div>
        
        <div className="godbar-footer">
          <span className="footer-hint">
            <span className="key">↑↓</span> navigate
          </span>
          <span className="footer-hint">
            <span className="key">↵</span> select
          </span>
          <span className="footer-hint">
            <span className="key">esc</span> close
          </span>
        </div>
      </div>
    </div>
  );
}

export default GodBar;
