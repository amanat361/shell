import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, RotateCcw, Trash2, Share2, FileText, Search, Terminal, Settings, RefreshCw, Plus, Moon, Sun, Download } from "lucide-react";
import "./index.css";

interface OpenCodeSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface OpenCodeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

interface Provider {
  id: string;
  name: string;
  models: string[];
}

interface AppStatus {
  connected: boolean;
  error?: string;
}

interface FileItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

interface SearchResult {
  path: string;
  lines: string[];
  line_number: number;
}

interface Agent {
  id: string;
  name: string;
  description?: string;
}

export function App() {
  const [status, setStatus] = useState<AppStatus>({ connected: false });
  const [sessions, setSessions] = useState<OpenCodeSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [messages, setMessages] = useState<OpenCodeMessage[]>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [activePanel, setActivePanel] = useState<'chat' | 'files' | 'search' | 'shell' | 'settings'>('chat');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [shellCommand, setShellCommand] = useState('');
  const [shellOutput, setShellOutput] = useState('');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Check OpenCode server status
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Load initial data when connected
  useEffect(() => {
    if (status.connected) {
      loadProviders();
      loadSessions();
      loadAgents();
      loadFiles();
      setupEventSource();
    }
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [status.connected]);

  // Load messages when active session changes
  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    }
  }, [activeSessionId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Dark mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      // Cmd/Ctrl + Enter to send message
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && currentMessage.trim()) {
        e.preventDefault();
        sendMessage();
      }
      
      // Cmd/Ctrl + N for new session
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        createNewSession();
      }
      
      // Cmd/Ctrl + K for search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setActivePanel('search');
      }
      
      // Cmd/Ctrl + ` for terminal
      if ((e.metaKey || e.ctrlKey) && e.key === '`') {
        e.preventDefault();
        setActivePanel('shell');
      }
      
      // Cmd/Ctrl + D for dark mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setIsDarkMode(!isDarkMode);
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [currentMessage, isDarkMode]);

  const checkServerStatus = async () => {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      setStatus({ connected: data.opencode });
      if (!data.opencode) {
        setStatus({ connected: false, error: data.message });
      }
    } catch (error) {
      setStatus({ 
        connected: false, 
        error: 'Cannot connect to server. Make sure the application is running.' 
      });
    }
  };

  const loadProviders = async () => {
    try {
      const response = await fetch('/opencode/config/providers');
      const data = await response.json();
      
      console.log('Providers data:', data); // Debug log
      console.log('Available providers:', Object.keys(data.providers || {})); // Debug providers
      
      // Transform the providers data structure
      const providersList: Provider[] = Object.entries(data.providers || {}).map(([id, provider]: [string, any]) => ({
        id,
        name: provider.name || id,
        models: Array.isArray(provider.models) ? provider.models : 
                typeof provider.models === 'object' ? Object.keys(provider.models) : []
      }));
      
      setProviders(providersList);
      
      // Set default provider and model to Claude Sonnet 4
      if (providersList.length > 0 && !selectedProvider) {
        console.log('Looking for Bedrock provider in:', providersList.map(p => ({ id: p.id, name: p.name })));
        
        // Look for Amazon Bedrock provider - try common variations
        let bedrockProvider = providersList.find(p => 
          p.id === 'amazon-bedrock' || 
          p.name?.toLowerCase().includes('bedrock') ||
          p.name?.toLowerCase().includes('amazon') ||
          p.id.includes('bedrock') || 
          p.id.includes('amazon')
        );
        
        // If no bedrock found, look for any provider with Claude models
        if (!bedrockProvider) {
          bedrockProvider = providersList.find(p => 
            p.models.some(m => m.includes('claude') || m.includes('anthropic'))
          );
        }
        
        const claudeModel = 'anthropic.claude-sonnet-4-20250514-v1:0';
        let selectedModelName = claudeModel;
        
        console.log('Found provider:', bedrockProvider);
        console.log('Available models:', bedrockProvider?.models);
        
        if (bedrockProvider) {
          // Look for exact Claude Sonnet 4 model
          if (bedrockProvider.models.includes(claudeModel)) {
            selectedModelName = claudeModel;
          } else {
            // Look for any Claude Sonnet model
            const sonnetModel = bedrockProvider.models.find(m => 
              m.includes('claude-3-5-sonnet') || m.includes('claude-sonnet')
            );
            if (sonnetModel) {
              selectedModelName = sonnetModel;
            } else if (bedrockProvider.models.length > 0) {
              selectedModelName = bedrockProvider.models[0] || '';
            }
          }
          
          console.log('Setting provider:', bedrockProvider.id, 'model:', selectedModelName);
          console.log('Combined model will be:', `${bedrockProvider.id}/${selectedModelName}`);
          setSelectedProvider(bedrockProvider.id);
          setSelectedModel(selectedModelName);
        } else {
          // Fallback to first provider/model
          console.log('Using fallback provider/model');
          const defaultProvider = providersList[0];
          if (defaultProvider && defaultProvider.models.length > 0) {
            setSelectedProvider(defaultProvider.id);
            setSelectedModel(defaultProvider.models[0] || '');
          }
        }
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch('/opencode/session');
      const data = await response.json();
      setSessions(data);
      
      // Set active session if none selected
      if (data.length > 0 && !activeSessionId) {
        setActiveSessionId(data[0].id);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const loadMessages = async (sessionId: string) => {
    try {
      const response = await fetch(`/opencode/session/${sessionId}/message`);
      const data = await response.json();
      
      // Transform messages to our format
      const messagesList: OpenCodeMessage[] = data.flatMap((item: any) => {
        const messages = [];
        
        // Add user message if there's text
        if (item.info.text) {
          messages.push({
            id: `${item.info.id}-user`,
            role: 'user' as const,
            content: item.info.text,
            createdAt: item.info.createdAt
          });
        }
        
        // Add assistant messages from parts
        item.parts.forEach((part: any, index: number) => {
          if (part.content) {
            messages.push({
              id: `${item.info.id}-assistant-${index}`,
              role: 'assistant' as const,
              content: part.content,
              createdAt: item.info.createdAt
            });
          }
        });
        
        return messages;
      });
      
      setMessages(messagesList);
    } catch (error) {
      console.error('Failed to load messages:', error);
      setMessages([]);
    }
  };

  const createNewSession = async () => {
    try {
      const response = await fetch('/opencode/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Session' })
      });
      
      const newSession = await response.json();
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setMessages([]);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  };

  const sendMessage = async () => {
    if (!currentMessage.trim() || !activeSessionId || !selectedProvider || !selectedModel) return;

    const userMessage: OpenCodeMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: currentMessage,
      createdAt: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    const messageText = currentMessage;
    setCurrentMessage('');
    setIsLoading(true);

    try {
      const response = await fetch(`/opencode/session/${activeSessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parts: [
            {
              type: "text", 
              text: messageText
            }
          ],
          modelID: `${selectedProvider}/${selectedModel}`
        })
      });

      if (response.ok) {
        // Reload messages to get the full conversation
        await loadMessages(activeSessionId);
      } else {
        const errorText = await response.text();
        console.error('Server response:', errorText);
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove the temporary message on error
      setMessages(prev => prev.filter(m => m.id !== userMessage.id));
      
      // Show error message
      const errorMessage: OpenCodeMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to send message'}`,
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev.filter(m => m.id !== userMessage.id), errorMessage]);
    }

    setIsLoading(false);
  };

  const setupEventSource = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    eventSourceRef.current = new EventSource('/opencode/event');
    
    eventSourceRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Handle real-time message updates
        if (data.type === 'message.created' || data.type === 'message.updated') {
          if (data.sessionID === activeSessionId) {
            loadMessages(activeSessionId);
          }
        }
        
        // Handle session updates
        if (data.type === 'session.created' || data.type === 'session.updated') {
          loadSessions();
        }
      } catch (error) {
        console.error('Error parsing SSE event:', error);
      }
    };

    eventSourceRef.current.onerror = (error) => {
      console.error('SSE connection error:', error);
    };
  };

  const loadAgents = async () => {
    try {
      const response = await fetch('/opencode/agent');
      const data = await response.json();
      setAgents(data);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

  const loadFiles = async () => {
    try {
      const response = await fetch('/opencode/file/status');
      const data = await response.json();
      
      const fileItems: FileItem[] = data.map((file: any) => ({
        path: file.path,
        name: file.path.split('/').pop() || file.path,
        type: 'file'
      }));
      
      setFiles(fileItems);
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  };

  const searchFiles = async () => {
    if (!searchQuery.trim()) return;
    
    try {
      const response = await fetch(`/opencode/find?pattern=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();
      setSearchResults(data);
    } catch (error) {
      console.error('Failed to search files:', error);
    }
  };

  const executeShellCommand = async () => {
    if (!shellCommand.trim() || !activeSessionId) return;

    const commandText = shellCommand;
    setShellCommand('');
    setShellOutput(prev => prev + `$ ${commandText}\n`);
    
    try {
      const response = await fetch(`/opencode/session/${activeSessionId}/shell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: commandText
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();
      console.log('Shell result:', result);
      
      // Try different possible output fields
      const output = result.output || result.stdout || result.content || 'Command executed (no output)';
      setShellOutput(prev => prev + output + '\n\n');
      
    } catch (error) {
      console.error('Shell command error:', error);
      setShellOutput(prev => prev + `Error: ${error}\n\n`);
    }
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const regenerateMessage = async (messageId: string) => {
    if (!activeSessionId) return;
    
    try {
      // Revert to this message first
      await fetch(`/opencode/session/${activeSessionId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageID: messageId })
      });
      
      // Reload messages
      await loadMessages(activeSessionId);
    } catch (error) {
      console.error('Failed to regenerate message:', error);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await fetch(`/opencode/session/${sessionId}`, {
        method: 'DELETE'
      });
      
      loadSessions();
      
      if (sessionId === activeSessionId) {
        setActiveSessionId('');
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const shareSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/opencode/session/${sessionId}/share`, {
        method: 'POST'
      });
      
      const result = await response.json();
      
      if (result.shareURL) {
        navigator.clipboard.writeText(result.shareURL);
        // You could show a toast notification here
      }
    } catch (error) {
      console.error('Failed to share session:', error);
    }
  };

  const renameSession = async (sessionId: string, newTitle: string) => {
    try {
      await fetch(`/opencode/session/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      
      loadSessions();
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  const exportSession = async (sessionId: string) => {
    try {
      const response = await fetch(`/opencode/session/${sessionId}/message`);
      const data = await response.json();
      
      const exportData = {
        session: sessions.find(s => s.id === sessionId),
        messages: data,
        exportedAt: new Date().toISOString()
      };
      
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opencode-session-${sessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  };

  const loadFileContent = async (filePath: string) => {
    try {
      const response = await fetch(`/opencode/file?path=${encodeURIComponent(filePath)}`);
      const data = await response.json();
      setFileContent(data.content || 'No content available');
      setSelectedFile(filePath);
    } catch (error) {
      console.error('Failed to load file:', error);
      setFileContent('Error loading file');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!status.connected) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-96">
          <CardHeader>
            <h2 className="text-xl font-semibold text-center">OpenCode Server</h2>
          </CardHeader>
          <CardContent className="text-center">
            <div className="mb-4">
              <div className="w-4 h-4 bg-red-500 rounded-full mx-auto mb-2"></div>
              <p className="text-gray-600">Not Connected</p>
            </div>
            {status.error && (
              <p className="text-sm text-gray-500 mb-4">{status.error}</p>
            )}
            <div className="text-sm text-gray-500">
              <p className="mb-2">To get started:</p>
              <code className="bg-gray-100 px-2 py-1 rounded">opencode serve --port 4096</code>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedProviderData = providers.find(p => p.id === selectedProvider);

  return (
    <div className={`h-screen flex ${isDarkMode ? 'dark bg-gray-900' : 'bg-gray-50'}`}>
      {/* Sidebar */}
      <div className={`w-80 ${isDarkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} border-r flex flex-col`}>
        {/* Header */}
        <div className={`p-4 border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <h1 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>OpenCode</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDarkMode(!isDarkMode)}
                className="p-1"
              >
                {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </Button>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
          </div>
          
          {/* Navigation Tabs */}
          <div className="flex mb-3 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {[
              { id: 'chat', label: 'Chat', icon: FileText },
              { id: 'files', label: 'Files', icon: FileText },
              { id: 'search', label: 'Search', icon: Search },
              { id: 'shell', label: 'Shell', icon: Terminal },
              { id: 'settings', label: 'Settings', icon: Settings }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActivePanel(id as any)}
                className={`flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded text-xs font-medium transition-colors ${
                  activePanel === id
                    ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>

          
          {/* Model Selection */}
          <div className="space-y-2">
            <Select value={selectedProvider} onValueChange={setSelectedProvider}>
              <SelectTrigger>
                <SelectValue placeholder="Select Provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map(provider => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select Model" />
              </SelectTrigger>
              <SelectContent>
                {(selectedProviderData?.models || []).map(model => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {/* Panel Content */}
        <div className="flex-1 overflow-y-auto">
          {activePanel === 'chat' && (
            <>
              <Button onClick={createNewSession} className="w-full mb-3 mx-4" style={{width: 'calc(100% - 2rem)'}}>
                <Plus className="w-4 h-4 mr-2" />
                New Session
              </Button>
              
              {sessions.map(session => (
                <div
                  key={session.id}
                  className={`group relative p-3 border-b ${isDarkMode ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-100 hover:bg-gray-50'} cursor-pointer ${
                    session.id === activeSessionId ? (isDarkMode ? 'bg-gray-700 border-l-4 border-l-blue-400' : 'bg-blue-50 border-l-4 border-l-blue-500') : ''
                  }`}
                >
                  <div onClick={() => setActiveSessionId(session.id)} className="flex-1">
                    <div className={`font-medium text-sm truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      {session.title}
                    </div>
                    <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      {session.updatedAt ? new Date(session.updatedAt).toLocaleDateString() : 'No date'}
                    </div>
                  </div>
                  
                  {/* Session Actions */}
                  <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); shareSession(session.id); }}
                      className="p-1 h-6 w-6"
                    >
                      <Share2 className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); exportSession(session.id); }}
                      className="p-1 h-6 w-6"
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
                      className="p-1 h-6 w-6 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          {activePanel === 'files' && (
            <div className="flex-1 flex flex-col">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Project Files</h3>
                  <Button variant="ghost" size="sm" onClick={loadFiles}>
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex-1 overflow-hidden flex">
                {/* File List */}
                <div className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
                  {files.map(file => (
                    <div
                      key={file.path}
                      onClick={() => loadFileContent(file.path)}
                      className={`p-3 border-b border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer text-sm transition-colors ${
                        selectedFile === file.path ? 'bg-blue-100 dark:bg-gray-700' : ''
                      }`}
                    >
                      <div className={`font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {file.name}
                      </div>
                      <div className={`text-xs truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {file.path}
                      </div>
                    </div>
                  ))}
                  
                  {files.length === 0 && (
                    <div className={`p-4 text-center text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      No files found
                    </div>
                  )}
                </div>
                
                {/* File Content */}
                <div className="flex-1 flex flex-col">
                  {selectedFile ? (
                    <>
                      <div className={`p-3 border-b border-gray-200 dark:border-gray-700 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                        <div className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                          {selectedFile}
                        </div>
                      </div>
                      <div className="flex-1 overflow-auto">
                        <pre className={`p-4 text-xs font-mono whitespace-pre-wrap ${isDarkMode ? 'text-gray-300 bg-gray-900' : 'text-gray-800 bg-white'}`}>
                          {fileContent}
                        </pre>
                      </div>
                    </>
                  ) : (
                    <div className={`flex-1 flex items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                      <div className="text-center">
                        <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>Select a file to view its content</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activePanel === 'search' && (
            <div className="p-4">
              <div className="flex gap-2 mb-3">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in files..."
                  onKeyDown={(e) => e.key === 'Enter' && searchFiles()}
                  className="flex-1"
                />
                <Button onClick={searchFiles}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>
              
              {searchResults.map((result, index) => (
                <div key={index} className={`p-2 border rounded mb-2 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                  <div className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {result.path}
                  </div>
                  <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Line {result.line_number}
                  </div>
                  {result.lines.map((line, lineIndex) => (
                    <div key={lineIndex} className={`text-xs font-mono mt-1 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                      {line}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {activePanel === 'shell' && (
            <div className="flex-1 flex flex-col">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Shell Commands</h3>
                <div className="flex gap-2">
                  <Input
                    value={shellCommand}
                    onChange={(e) => setShellCommand(e.target.value)}
                    placeholder="Enter shell command... (e.g., ls, pwd, cat file.txt)"
                    onKeyDown={(e) => e.key === 'Enter' && executeShellCommand()}
                    className="flex-1 font-mono"
                    disabled={!activeSessionId}
                  />
                  <Button 
                    onClick={executeShellCommand}
                    disabled={!activeSessionId || !shellCommand.trim()}
                  >
                    <Terminal className="w-4 h-4" />
                  </Button>
                </div>
                
                {!activeSessionId && (
                  <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                    Create or select a session to run shell commands
                  </p>
                )}
              </div>
              
              <div className="flex-1 overflow-auto">
                {shellOutput ? (
                  <div className={`p-4 font-mono text-sm whitespace-pre-wrap h-full ${isDarkMode ? 'bg-black text-green-400' : 'bg-gray-900 text-green-300'}`}>
                    {shellOutput}
                  </div>
                ) : (
                  <div className={`flex-1 flex items-center justify-center ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    <div className="text-center">
                      <Terminal className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>Run shell commands and see output here</p>
                      <p className="text-xs mt-1">Commands are executed in the project directory</p>
                    </div>
                  </div>
                )}
              </div>
              
              {shellOutput && (
                <div className="p-2 border-t border-gray-200 dark:border-gray-700">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShellOutput('')}
                    className="w-full"
                  >
                    Clear Output
                  </Button>
                </div>
              )}
            </div>
          )}

          {activePanel === 'settings' && (
            <div className="p-4 space-y-6">
              {/* Keyboard Shortcuts */}
              <div>
                <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Keyboard Shortcuts
                </h3>
                <div className="space-y-2 text-sm">
                  {[
                    { keys: ['⌘', 'Enter'], desc: 'Send message' },
                    { keys: ['⌘', 'N'], desc: 'New session' },
                    { keys: ['⌘', 'K'], desc: 'Search files' },
                    { keys: ['⌘', '`'], desc: 'Open terminal' },
                    { keys: ['⌘', 'D'], desc: 'Toggle dark mode' }
                  ].map((shortcut, index) => (
                    <div key={index} className="flex justify-between items-center">
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                        {shortcut.desc}
                      </span>
                      <div className="flex gap-1">
                        {shortcut.keys.map((key, i) => (
                          <kbd 
                            key={i}
                            className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-700'}`}
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Available Agents */}
              <div>
                <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  Available Agents
                </h3>
                {agents.length > 0 ? (
                  agents.map(agent => (
                    <div key={agent.id} className={`p-3 border rounded mb-2 ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
                      <div className={`font-medium text-sm ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div className={`text-xs mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {agent.description}
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    No agents available
                  </div>
                )}
              </div>

              {/* App Information */}
              <div>
                <h3 className={`font-medium mb-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  About
                </h3>
                <div className={`text-sm space-y-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div>OpenCode Web Interface</div>
                  <div>Built with Bun + React + TypeScript</div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Connected to OpenCode Server</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeSession ? (
          <>
            {/* Chat Header */}
            <div className={`p-4 border-b ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className={`font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {activeSession.title}
                  </h2>
                  <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    {selectedProviderData?.name} • {selectedModel}
                  </p>
                </div>
                
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => shareSession(activeSession.id)}
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => exportSession(activeSession.id)}
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
              {messages.map(message => (
                <div
                  key={message.id}
                  className={`group flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-2xl rounded-lg p-3 relative ${
                      message.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : isDarkMode 
                          ? 'bg-gray-800 border border-gray-700 text-gray-100'
                          : 'bg-white border border-gray-200 text-gray-900'
                    }`}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{message.content}</pre>
                    
                    {/* Message Actions */}
                    <div className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyMessage(message.content)}
                        className="p-1 h-6 w-6 bg-white dark:bg-gray-700 shadow-sm"
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                      {message.role === 'assistant' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => regenerateMessage(message.id)}
                          className="p-1 h-6 w-6 bg-white dark:bg-gray-700 shadow-sm"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start">
                  <div className={`rounded-lg p-3 ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                    <div className="flex items-center space-x-2">
                      <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>
                      <span className={isDarkMode ? 'text-gray-300' : 'text-gray-500'}>
                        Thinking...
                      </span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className={`p-4 border-t ${isDarkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
              <div className="flex space-x-2">
                <div className="flex-1">
                  <Input
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask OpenCode anything... (⌘+Enter to send)"
                    disabled={isLoading}
                    className="w-full resize-none"
                  />
                </div>
                <Button 
                  onClick={sendMessage} 
                  disabled={isLoading || !currentMessage.trim()}
                  className="px-6"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    'Send'
                  )}
                </Button>
              </div>
              
              {/* Quick Actions */}
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentMessage("Explain this code")}
                  disabled={isLoading}
                >
                  Explain Code
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentMessage("Review and suggest improvements")}
                  disabled={isLoading}
                >
                  Review Code
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentMessage("Generate tests for this function")}
                  disabled={isLoading}
                >
                  Generate Tests
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className={`flex-1 flex items-center justify-center ${isDarkMode ? 'bg-gray-900' : 'bg-gray-50'}`}>
            <div className="text-center">
              <h3 className={`text-lg font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                No Session Selected
              </h3>
              <p className={`mb-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                Create a new session to get started
              </p>
              <Button onClick={createNewSession}>
                <Plus className="w-4 h-4 mr-2" />
                Create New Session
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
