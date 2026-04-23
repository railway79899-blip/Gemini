import React, { useState, useRef, useEffect } from 'react';
import { Send, Settings, Trash2, Menu, Plus, Key, MessageSquare, ChevronRight, Play, Code, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateChatStream, ChatMessage } from './lib/gemini';
import { auth, googleProvider, loginWithGoogle, logout, getUserChats, saveChatSession, ChatSession, deleteChatSession } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  
  // Chat History
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  
  // Layout state
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isDevMode, setIsDevMode] = useState(false);
  
  // Settings
  const [model, setModel] = useState('gemini-3.1-pro-preview');
  const [systemInstruction, setSystemInstruction] = useState('你是 Gemini 3.1 Pro，由 Google DeepMind 所開發的強大 AI 助手。你深知當前最新的模型系列為 Gemini 3.1 (2026 年發布)，其主打深度邏輯與代理 (Agentic) 能力。你的影片生成對應版本是 Veo 3.1。');
  const [temperature, setTemperature] = useState(0.7);
  const [topK, setTopK] = useState(40);
  const [topP, setTopP] = useState(0.95);
  const [safetySettings, setSafetySettings] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => scrollToBottom(), [messages]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setShowLoginModal(false);
        await loadUserChats(currentUser.uid);
      } else {
        setChats([]);
        setMessages([]);
        setCurrentChatId('');
      }
    });
    return () => unsubscribe();
  }, []);

  const loadUserChats = async (uid: string) => {
    const userChats = await getUserChats(uid);
    setChats(userChats);
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentChatId('');
  };

  const loadLocalChat = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setMessages(chat.messages);
      setCurrentChatId(chat.id);
    }
  };

  const syncChatToFirebase = async (newMessages: ChatMessage[]) => {
    if (!user) return;
    
    // Auto-generate a title if it's a new chat based on user's first prompt
    let title = "新對話";
    if (newMessages.length > 0) {
      const firstUserMsg = newMessages.find(m => m.role === 'user')?.text || "新對話";
      title = firstUserMsg.substring(0, 30) + (firstUserMsg.length > 30 ? "..." : "");
    }

    // Generate random 16 UUID for new chat
    const chatId = currentChatId || crypto.randomUUID();
    
    const newChatSession: ChatSession = {
      id: chatId,
      title: title,
      messages: newMessages,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await saveChatSession(user.uid, newChatSession);
      if (!currentChatId) {
        setCurrentChatId(chatId);
      }
      // Silently refresh list to update timestamp ordering
      const updatedChats = await getUserChats(user.uid);
      setChats(updatedChats);
    } catch(e) {
      console.error("Firebase sync error", e);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!user && messages.length === 0) {
      // First message, user not logged in? It's fine, we let them chat but we don't save.
    }

    const userMessage = input.trim();
    setInput('');
    
    const updatedMessages = [...messages, { role: 'user' as const, text: userMessage }];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {
      setMessages(prev => [...prev, { role: 'model', text: '' }]);
      
      let accumulatedText = "";
      const stream = generateChatStream(messages, userMessage, {
        model,
        systemInstruction,
        temperature,
        topK,
        topP
      });

      for await (const chunkText of stream) {
        accumulatedText += chunkText;
        setMessages(prev => {
          const newMessages = [...prev];
          newMessages[newMessages.length - 1].text = accumulatedText;
          return newMessages;
        });
      }

      // Sync after completion
      await syncChatToFirebase([...updatedMessages, { role: 'model', text: accumulatedText }]);

    } catch (error: any) {
      console.error(error);
      const errMessages = [...updatedMessages, { 
        role: 'model' as const, 
        text: `**錯誤：** ${error.message || '與 API 溝通時發生錯誤。'}` 
      }];
      setMessages(errMessages);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDeleteChat = async (e: React.MouseEvent, targetChatId: string) => {
    e.stopPropagation(); // 防止點擊觸發載入聊天
    if(!window.confirm('確定要刪除此對話嗎？')) return;
    
    if (user) {
      await deleteChatSession(user.uid, targetChatId);
      const updatedChats = await getUserChats(user.uid);
      setChats(updatedChats);
      
      // If we deleted the currently active chat
      if (currentChatId === targetChatId) {
        setMessages([]);
        setCurrentChatId('');
      }
    }
  };

  const handleDeleteCurrentChat = async () => {
    if(!window.confirm('確定要刪除此對話嗎？')) return;
    
    if (user && currentChatId) {
      await deleteChatSession(user.uid, currentChatId);
      await loadUserChats(user.uid);
    }
    setMessages([]);
    setCurrentChatId('');
  };

  const generateExportJson = () => {
    return JSON.stringify({
      contents: messages.map(msg => ({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.text }]
      })).concat(input.trim() ? [{ role: 'user', parts: [{ text: input.trim() }] }] : []),
      systemInstruction: {
        role: "user",
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature,
        topK,
        topP,
        maxOutputTokens: 8192,
        stopSequences: []
      },
      safetySettings: safetySettings ? 'DEFAULT' : 'BLOCK_NONE'
    }, null, 2);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-google-bg text-gray-200 font-sans selection:bg-google-blue/30 selection:text-google-blue">
      
      {/* 1. Left Sidebar */}
      <div 
        className={`${isSidebarOpen ? 'w-64' : 'w-0'} z-20 absolute md:relative h-full flex-shrink-0 bg-google-bg border-r border-google-border flex flex-col transition-all duration-300 overflow-hidden shadow-2xl md:shadow-none`}
      >
        <div className="p-4 flex items-center justify-between border-b border-google-border md:border-transparent">
           <span className="font-bold tracking-wide text-google-blue md:hidden">TW ai chat</span>
           <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 hover:text-white p-1 rounded-md bg-white/5">
             <Menu className="w-5 h-5" />
           </button>
        </div>

        <div className="p-4">
          <button 
            onClick={startNewChat}
            className="flex items-center gap-2 w-full py-2.5 px-4 rounded-full border border-google-border hover:bg-white/5 transition-colors group"
          >
            <Plus className="w-5 h-5 text-gray-400 group-hover:text-white transition-colors" />
            <span className="text-sm font-medium">建立新對話</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar">
          <div className="px-3 mb-2 text-xs font-semibold text-gray-500 uppercase tracking-widest mt-4">
            歷史對話
          </div>
          
          <div className="space-y-1">
            {!user ? (
               <div className="px-3 py-4 text-xs text-center text-gray-500 italic">
                 登入以儲存對話紀錄
               </div>
            ) : chats.length === 0 ? (
               <div className="px-3 py-4 text-xs text-center text-gray-500 italic">
                 尚無對話紀錄。
               </div>
            ) : (
              chats.map(chat => (
                <button 
                  key={chat.id}
                  onClick={() => loadLocalChat(chat.id)}
                  className={`w-full flex justify-between items-center px-3 py-2 rounded-md hover:bg-white/10 text-sm text-left transition-colors group ${currentChatId === chat.id ? 'bg-white/10 text-white' : 'text-gray-300'}`}
                >
                  <div className="flex items-center gap-3 overflow-hidden pr-2">
                    <MessageSquare className="w-4 h-4 flex-shrink-0 text-gray-500" />
                    <span className="truncate">{chat.title}</span>
                  </div>
                  <div 
                    onClick={(e) => handleDeleteChat(e, chat.id)}
                    className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all flex-shrink-0"
                    title="刪除對話"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="p-2 border-t border-google-border">
          {!user ? (
             <button onClick={() => setShowLoginModal(true)} className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-google-blue/10 text-google-blue text-sm font-semibold transition-colors">
              <LogIn className="w-4 h-4" />
              <span>登入</span>
            </button>
          ) : (
             <div className="space-y-1">
               <div className="px-3 py-2 text-xs text-gray-500 truncate border-b border-google-border mb-1">
                 {user.email}
               </div>
               <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 text-sm text-gray-300 transition-colors">
                  <LogOut className="w-4 h-4 text-gray-500" />
                  <span>登出</span>
               </button>
             </div>
          )}
          <button className="w-full mt-1 flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 text-sm text-gray-300 transition-colors">
            <Settings className="w-4 h-4 text-gray-500" />
            <span>設定</span>
          </button>
        </div>
      </div>

      {/* Toggle Sidebar Button (when closed) */}
      {!isSidebarOpen && (
        <button 
          onClick={() => setIsSidebarOpen(true)}
          className="absolute top-4 left-4 z-50 p-2 bg-google-surface border border-google-border rounded-full hover:bg-white/10 transition-colors"
        >
          <Menu className="w-5 h-5 text-gray-400" />
        </button>
      )}

      {/* 2. Main Editor Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#000000]/20 relative">
        {/* Header */}
        <header className="h-14 border-b border-google-border flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(false)} className="hidden md:block p-1.5 rounded-full hover:bg-white/10 transition-colors group">
                <Menu className="w-5 h-5 text-gray-400 group-hover:text-white" />
              </button>
            )}
            <h1 className="text-lg font-medium tracking-wide">TW ai chat - Studio</h1>
          </div>
          <div className="flex items-center gap-2">
             <button 
              onClick={() => setIsDevMode(!isDevMode)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-all ${isDevMode ? 'bg-google-blue/10 text-google-blue border-google-blue/50' : 'bg-white/5 text-gray-300 border-transparent hover:bg-white/10'} border hover:scale-105 active:scale-95`}
            >
              <Code className="w-4 h-4" />
              開發者模式 (Codex)
            </button>
          </div>
        </header>

        <div className={`flex-1 flex flex-col overflow-hidden ${isDevMode ? 'lg:flex-row' : ''}`}>
          
          {/* Editor Area */}
          <div className="flex-1 flex flex-col min-w-0 h-full relative">
            {/* System Instruction */}
            <div className="p-4 flex-shrink-0">
              <div className="bg-google-surface border border-google-blue/40 rounded-xl overflow-hidden focus-within:border-google-blue focus-within:ring-1 focus-within:ring-google-blue/50 transition-all">
                <div className="px-4 py-2 border-b border-white/5 flex items-center justify-between bg-black/20">
                  <span className="text-xs font-semibold uppercase tracking-wider text-google-blue flex items-center gap-2">
                    系統指令 (System Instructions)
                  </span>
                </div>
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  className="w-full h-20 md:h-24 bg-transparent resize-none p-4 text-sm focus:outline-none custom-scrollbar"
                  placeholder="你是一個有幫助的助手..."
                />
              </div>
            </div>

            {/* Chat Flow */}
            <div className="flex-1 overflow-y-auto px-4 pb-32 custom-scrollbar relative">
              <div className="max-w-4xl mx-auto space-y-6">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 text-gray-500">
                    <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
                    <p>在下方輸入提示以開始對話。</p>
                  </div>
                ) : (
                  messages.map((msg, index) => (
                    <div key={index} className="flex gap-4 group">
                      <div className="mt-1 w-8 h-8 rounded shrink-0 flex items-center justify-center bg-white/5 border border-white/10">
                        {msg.role === 'model' ? (
                          <div className="w-5 h-5 rounded-full bg-google-blue/20 flex items-center justify-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-google-blue"></div>
                          </div>
                        ) : (
                          <div className="w-5 h-5 rounded flex items-center justify-center text-gray-400 font-bold text-xs">U</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className="font-semibold text-xs text-gray-400 mb-2 uppercase tracking-wide">
                          {msg.role === 'user' ? '您' : '模型'}
                        </div>
                        {msg.role === 'model' && !msg.text ? (
                          <div className="flex items-center gap-1 h-6">
                            <div className="w-1.5 h-1.5 rounded-full bg-google-blue animate-pulse" style={{ animationDelay: '0ms' }}></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-google-blue animate-pulse" style={{ animationDelay: '150ms' }}></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-google-blue animate-pulse" style={{ animationDelay: '300ms' }}></div>
                          </div>
                        ) : (
                          <div className="markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.text}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Bottom Input */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-google-bg via-[#171719] to-transparent">
              <div className="max-w-4xl mx-auto flex items-end gap-3 bg-google-surface border border-google-border rounded-2xl p-2.5 focus-within:border-google-blue/80 transition-colors shadow-2xl">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="輸入些什麼..."
                  className="flex-1 max-h-48 min-h-[44px] bg-transparent border-none focus:ring-0 resize-none py-2.5 px-3 text-sm text-gray-200 custom-scrollbar"
                  rows={Math.min(6, Math.max(1, input.split('\n').length))}
                  disabled={isLoading}
                />
                <button
                  onClick={handleSubmit}
                  disabled={isLoading || (!input.trim() && messages.length > 0 && messages[messages.length-1].role === 'user')}
                  className={`p-3 rounded-xl flex-shrink-0 flex items-center justify-center transition-all h-11 px-5 font-medium
                    ${(input.trim() && !isLoading) 
                      ? 'bg-google-blue text-[#131314] hover:bg-blue-300 hover:scale-105 active:scale-95' 
                      : 'bg-white/5 text-gray-500 cursor-not-allowed'}`}
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-[#131314] border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <span className="flex items-center gap-2">
                       執行 <Play className="w-4 h-4 fill-current" />
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Developer Json panel */}
          {isDevMode && (
             <div className="lg:w-1/3 w-full border-t lg:border-t-0 lg:border-l border-google-border bg-black/40 flex flex-col min-h-[300px] h-full shadow-inner animate-in slide-in-from-right-4 fade-in duration-300">
                <div className="px-4 py-2 border-b border-google-border bg-google-bg/80 backdrop-blur flex justify-between items-center">
                  <span className="text-xs font-semibold text-gray-400">JSON 匯出</span>
                  <button onClick={() => navigator.clipboard.writeText(generateExportJson())} className="text-xs text-google-blue hover:underline">複製</button>
                </div>
                <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                  <pre className="text-xs font-mono text-[#a8c7fa]">
                    {generateExportJson()}
                  </pre>
                </div>
             </div>
          )}
        </div>
      </div>

      {/* 3. Right Sidebar (Parameters) */}
      <div className="w-72 hidden lg:flex flex-shrink-0 bg-google-surface border-l border-google-border flex-col h-full overflow-y-auto custom-scrollbar z-10 shadow-xl">
        <div className="p-4 border-b border-google-border">
          <h2 className="text-sm font-semibold tracking-wide text-gray-300 flex items-center gap-2">
            執行設定
          </h2>
        </div>

        <div className="p-5 space-y-8">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">模型</label>
            <div className="relative">
              <select 
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-black/30 border border-white/10 rounded-lg py-2.5 px-3 text-sm text-gray-200 focus:outline-none focus:border-google-blue focus:ring-1 focus:ring-google-blue appearance-none cursor-pointer hover:bg-black/50 transition-colors"
              >
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite</option>
                <option value="gemini-3.1-flash-image-preview">Nano Banana 2 (Image)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                <ChevronRight className="w-4 h-4 transform rotate-90" />
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider tooltip">隨機性 (Temperature)</label>
              <span className="text-xs bg-black/40 px-2 py-0.5 rounded font-mono text-gray-300">{temperature.toFixed(2)}</span>
            </div>
            <input 
              type="range" min="0" max="2" step="0.05" value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-google-blue hover:accent-blue-400"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top K</label>
              <span className="text-xs bg-black/40 px-2 py-0.5 rounded font-mono text-gray-300">{topK}</span>
            </div>
            <input 
              type="range" min="1" max="100" step="1" value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-google-blue hover:accent-blue-400"
            />
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Top P</label>
              <span className="text-xs bg-black/40 px-2 py-0.5 rounded font-mono text-gray-300">{topP.toFixed(2)}</span>
            </div>
            <input 
              type="range" min="0" max="1" step="0.01" value={topP}
              onChange={(e) => setTopP(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-google-blue hover:accent-blue-400"
            />
          </div>

          <hr className="border-white/5" />

          <div className="space-y-3">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              安全設定 (Safety Settings)
              {safetySettings ? (
                <span className="text-green-400 text-[10px]">已啟用</span>
              ) : (
                <span className="text-yellow-500 text-[10px] flex items-center gap-1"><AlertTriangle className="w-3 h-3"/> 已停用</span>
              )}
            </label>
            <button 
              onClick={() => setSafetySettings(!safetySettings)}
              className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg border border-white/10 bg-black/20 hover:bg-black/40 transition-colors"
            >
              <span className="text-sm text-gray-300">不套用任何限制</span>
              <div className={`w-8 h-4 rounded-full transition-colors relative ${safetySettings ? 'bg-google-blue' : 'bg-gray-600'}`}>
                <div className={`absolute top-0.5 left-0.5 bg-white w-3 h-3 rounded-full transition-transform ${safetySettings ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </button>
          </div>

          <div className="space-y-4 pt-4">
             <button 
                onClick={handleDeleteCurrentChat}
                className="w-full flex justify-center items-center gap-2 py-2.5 px-4 border border-red-500/20 text-red-500 rounded-lg text-sm font-medium hover:bg-red-500/10 hover:border-red-500/50 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Trash2 className="w-4 h-4" /> 刪除當前對話
              </button>
          </div>

        </div>
      </div>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-google-surface border border-google-border rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
             <div className="p-6 relative">
                <button onClick={() => setShowLoginModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-white">
                   <ChevronRight className="w-5 h-5 transform rotate-90" />
                </button>
                <h3 className="text-xl font-bold text-white mb-2">登入</h3>
                <p className="text-sm text-gray-400 mb-6">登入以儲存並從雲端存取您的對話紀錄。</p>

                <div className="space-y-3">
                  <button onClick={loginWithGoogle} className="w-full h-12 flex items-center justify-center gap-3 bg-white text-gray-900 rounded-lg font-medium hover:bg-gray-100 transition-colors shadow-sm">
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fillRule="evenodd"></path><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path></svg>
                    使用 Google 登入
                  </button>
                  <button onClick={() => alert("若要啟用 Apple 登入，您必須在 Firebase Console 中設定 Apple 開發者憑證。")} className="w-full h-12 flex items-center justify-center gap-3 bg-black border border-white/20 text-white rounded-lg font-medium hover:bg-white/5 transition-colors">
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 384 512"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
                    使用 Apple 登入
                  </button>
                  <button onClick={() => alert("若要啟用 Facebook 登入，請設定 Facebook 開發者平台並將用戶端金鑰輸入 Firebase Console 中。")} className="w-full h-12 flex items-center justify-center gap-3 bg-[#1877F2] text-white rounded-lg font-medium hover:bg-[#166FE5] transition-colors">
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 320 512"><path d="M279.14 288l14.22-92.66h-88.91v-60.13c0-25.35 12.42-50.06 52.24-50.06h40.42V6.26S260.43 0 225.36 0c-73.22 0-121.08 44.38-121.08 124.72v70.62H22.89V288h81.39v224h100.17V288z"/></svg>
                    使用 Facebook 登入
                  </button>
                  <button onClick={() => alert("若要啟用 Instagram 登入，您必須設定 Instagram 基本顯示 API 並註冊 OAuth URL。")} className="w-full h-12 flex items-center justify-center gap-3 bg-gradient-to-r from-[#833ab4] via-[#fd1d1d] to-[#fcb045] text-white rounded-lg font-medium hover:opacity-90 transition-colors">
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 448 512"><path d="M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12.2 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z"/></svg>
                    使用 Instagram 登入
                  </button>
                  <button onClick={() => alert("若要啟用 TikTok 登入，請前往 developers.tiktok.com 註冊並在 Firebase Functions 內部設定 OAuth token 交換機制。")} className="w-full h-12 flex items-center justify-center gap-3 bg-[#010101] border border-white/10 text-white rounded-lg font-medium hover:bg-[#25F4EE]/20 transition-colors">
                    <svg className="w-5 h-5 fill-current" viewBox="0 0 448 512"><path d="M448,209.91a210.06,210.06,0,0,1-122.77-39.25V349.38A162.55,162.55,0,1,1,185,188.31V278.2a74.62,74.62,0,1,0,52.23,71.18V0l88,0a121.18,121.18,0,0,0,1.86,22.17h0A122.18,122.18,0,0,0,381,102.39a121.43,121.43,0,0,0,67,20.14Z"/></svg>
                    使用 TikTok 登入
                  </button>
                </div>
             </div>
          </div>
        </div>
      )}

    </div>
  );
}


