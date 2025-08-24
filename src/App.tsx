import { useState, useRef, useEffect, useCallback } from "react";
import AnsiToHtml from "ansi-to-html";
import "./index.css";

const ansiConverter = new AnsiToHtml({
  fg: '#00ff00',
  bg: '#000000',
  newline: false,
  escapeXML: false,
  stream: false
});

interface TerminalEntry {
  type: 'command' | 'output' | 'error';
  content: string;
}

interface TerminalSession {
  id: string;
  name: string;
  history: TerminalEntry[];
}

const STORAGE_KEY = 'terminal-sessions';
const ACTIVE_TAB_KEY = 'active-terminal-tab';

export function App() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [currentCommand, setCurrentCommand] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Load sessions from localStorage on mount
  useEffect(() => {
    const savedSessions = localStorage.getItem(STORAGE_KEY);
    const savedActiveTab = localStorage.getItem(ACTIVE_TAB_KEY);
    
    if (savedSessions) {
      const parsedSessions = JSON.parse(savedSessions);
      setSessions(parsedSessions);
      
      if (savedActiveTab && parsedSessions.find((s: TerminalSession) => s.id === savedActiveTab)) {
        setActiveSessionId(savedActiveTab);
      } else if (parsedSessions.length > 0) {
        setActiveSessionId(parsedSessions[0].id);
      }
    } else {
      // Create initial session
      const initialSession: TerminalSession = {
        id: '1',
        name: 'Terminal 1',
        history: []
      };
      setSessions([initialSession]);
      setActiveSessionId('1');
    }
  }, []);

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    if (sessions.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }
  }, [sessions]);

  // Save active tab whenever it changes
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem(ACTIVE_TAB_KEY, activeSessionId);
    }
  }, [activeSessionId]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [activeSession?.history]);

  // Auto-focus input
  useEffect(() => {
    if (inputRef.current && !isLoading) {
      inputRef.current.focus();
    }
  }, [isLoading, activeSessionId]);

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, show: false }));
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const updateSessionHistory = useCallback((sessionId: string, newEntry: TerminalEntry) => {
    setSessions(prev => prev.map(session => 
      session.id === sessionId 
        ? { ...session, history: [...session.history, newEntry] }
        : session
    ));
  }, []);

  const clearTerminal = useCallback(() => {
    setSessions(prev => prev.map(session => 
      session.id === activeSessionId 
        ? { ...session, history: [] }
        : session
    ));
  }, [activeSessionId]);

  const cancelCommand = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    updateSessionHistory(activeSessionId, { type: 'error', content: '^C' });
    setIsLoading(false);
    setCurrentCommand("");
  };

  const executeCommand = async (command: string) => {
    if (!command.trim() || !activeSessionId) return;

    // Handle clear command locally
    if (command.trim() === 'clear') {
      clearTerminal();
      setCurrentCommand("");
      return;
    }

    // Add to command history
    setCommandHistory(prev => {
      const newHistory = [command, ...prev.filter(cmd => cmd !== command)].slice(0, 50);
      return newHistory;
    });
    setHistoryIndex(-1);

    updateSessionHistory(activeSessionId, { type: 'command', content: `$ ${command}` });
    setCurrentCommand("");
    setIsLoading(true);

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (result.error) {
        updateSessionHistory(activeSessionId, { type: 'error', content: result.error });
      } else if (result.stdout || result.stderr) {
        if (result.stdout) {
          updateSessionHistory(activeSessionId, { type: 'output', content: result.stdout });
        }
        if (result.stderr) {
          updateSessionHistory(activeSessionId, { type: 'error', content: result.stderr });
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Command was cancelled, message already added by cancelCommand
        return;
      }
      updateSessionHistory(activeSessionId, { 
        type: 'error', 
        content: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}` 
      });
    }

    setIsLoading(false);
    abortControllerRef.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl+V - Paste
    if (e.ctrlKey && e.key === 'v') {
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        setCurrentCommand(prev => {
          const input = inputRef.current;
          if (input) {
            const start = input.selectionStart || 0;
            const end = input.selectionEnd || 0;
            const newValue = prev.slice(0, start) + text + prev.slice(end);
            // Set cursor position after paste
            setTimeout(() => {
              input.setSelectionRange(start + text.length, start + text.length);
            }, 0);
            return newValue;
          }
          return prev + text;
        });
      }).catch(() => {
        // Fallback for browsers that don't support clipboard API
        console.warn('Paste not supported or permission denied');
      });
      return;
    }

    // Ctrl+C - Handle copy vs cancel command
    if (e.ctrlKey && e.key === 'c') {
      // Check if there's selected text in the terminal
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        // Don't prevent default - let browser handle copy
        return;
      }
      
      e.preventDefault();
      if (isLoading) {
        cancelCommand();
      } else {
        // If no command running, add ^C to terminal and clear input
        updateSessionHistory(activeSessionId, { type: 'command', content: `$ ${currentCommand}^C` });
        setCurrentCommand("");
      }
      return;
    }

    // Ctrl+L - Clear terminal
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      clearTerminal();
      return;
    }

    // Enter - Execute command
    if (e.key === 'Enter' && !isLoading) {
      executeCommand(currentCommand);
      return;
    }

    // Arrow Up - Previous command in history
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = Math.min(historyIndex + 1, commandHistory.length - 1);
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[newIndex] || "");
      }
      return;
    }

    // Arrow Down - Next command in history
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[newIndex] || "");
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentCommand("");
      }
      return;
    }

    // Reset history index when user types
    if (historyIndex !== -1 && e.key.length === 1) {
      setHistoryIndex(-1);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      show: true
    });
  };

  const handleCopy = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      navigator.clipboard.writeText(selection.toString());
    }
    setContextMenu(prev => ({ ...prev, show: false }));
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setCurrentCommand(prev => {
        const input = inputRef.current;
        if (input) {
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          const newValue = prev.slice(0, start) + text + prev.slice(end);
          setTimeout(() => {
            input.setSelectionRange(start + text.length, start + text.length);
            input.focus();
          }, 0);
          return newValue;
        }
        return prev + text;
      });
    } catch (error) {
      console.warn('Paste failed:', error);
    }
    setContextMenu(prev => ({ ...prev, show: false }));
  };

  const createNewTab = () => {
    const newId = Date.now().toString();
    const newSession: TerminalSession = {
      id: newId,
      name: `Terminal ${sessions.length + 1}`,
      history: []
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
  };

  const closeTab = (sessionId: string) => {
    if (sessions.length === 1) return; // Don't close last tab
    
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    
    if (sessionId === activeSessionId) {
      const remainingSessions = sessions.filter(s => s.id !== sessionId);
      setActiveSessionId(remainingSessions[0]?.id || '');
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-green-400 flex flex-col font-mono overflow-hidden" onContextMenu={handleContextMenu}>
      {/* Tab bar */}
      <div className="bg-gray-900 border-b border-gray-700 flex items-center px-2 py-1">
        {sessions.map(session => (
          <div
            key={session.id}
            className={`flex items-center px-3 py-1 mr-1 rounded-t cursor-pointer ${
              session.id === activeSessionId 
                ? 'bg-black text-green-400' 
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
            }`}
            onClick={() => setActiveSessionId(session.id)}
          >
            <span className="text-sm">{session.name}</span>
            {sessions.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(session.id);
                }}
                className="ml-2 text-gray-500 hover:text-red-400"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          onClick={createNewTab}
          className="ml-2 px-2 py-1 text-gray-400 hover:text-green-400"
          title="New tab"
        >
          +
        </button>
      </div>

      {/* Terminal content */}
      <div className="flex-1 flex flex-col p-4 min-h-0">
        <div 
          ref={terminalRef}
          className="flex-1 overflow-y-auto mb-2 min-h-0 select-text"
          onClick={() => inputRef.current?.focus()}
        >
          {activeSession?.history.map((entry, index) => {
            if (entry.type === 'command') {
              return (
                <div key={index} className="whitespace-pre-wrap text-yellow-400 select-text">
                  {entry.content}
                </div>
              );
            } else {
              // Convert ANSI codes to HTML for output and errors
              const htmlContent = ansiConverter.toHtml(entry.content);
              return (
                <div 
                  key={index} 
                  className={`whitespace-pre-wrap select-text ${entry.type === 'error' ? 'text-red-400' : ''}`}
                  dangerouslySetInnerHTML={{ __html: htmlContent }}
                />
              );
            }
          })}
          {isLoading && <div className="text-blue-400 animate-pulse">Executing command...</div>}
        </div>
        
        {/* Input line */}
        <div className="flex items-center">
          <span className="text-yellow-400 mr-2">$</span>
          <input
            ref={inputRef}
            value={currentCommand}
            onChange={(e) => setCurrentCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            className="flex-1 bg-transparent text-green-400 outline-none"
            style={{ caretColor: 'green' }}
          />
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
          className="fixed bg-gray-800 border border-gray-600 rounded shadow-lg z-50 py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopy}
            className="w-full px-3 py-1 text-left text-sm text-green-400 hover:bg-gray-700 flex items-center gap-2"
          >
            <span>Copy</span>
            <span className="text-xs text-gray-500">Ctrl+C</span>
          </button>
          <button
            onClick={handlePaste}
            className="w-full px-3 py-1 text-left text-sm text-green-400 hover:bg-gray-700 flex items-center gap-2"
          >
            <span>Paste</span>
            <span className="text-xs text-gray-500">Ctrl+V</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
