'use client';

import { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTED_QUESTIONS = [
  '這些水果乾有添加糖分嗎？',
  '水果乾要怎麼保存？保存期限多長？',
  '我想進貨，大概需要訂多少才合適？',
  '蔬果脆片適合做哪些料理搭配？',
];

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '您好！我是一吉水果乾的 AI 助手 🍎\n\n我可以回答您關於商品成分、保存方式、採購建議以及搭配推薦等問題。請問有什麼可以幫您？',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // 跳過首次渲染，避免頁面載入時被強制捲到底部
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // 僅在聊天容器內部捲動，不影響頁面整體位置
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, userMsg] }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '抱歉，目前無法取得回答，請稍後再試或直接聯絡我們的業務人員。',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
      {/* 聊天標題 */}
      <div className="bg-gradient-to-r from-leaf-600 to-leaf-500 px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center text-white font-bold">AI</div>
        <div>
          <div className="text-white font-semibold">一吉 AI 助手</div>
          <div className="text-leaf-100 text-xs">商品專業顧問・24小時服務</div>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-2 h-2 bg-green-300 rounded-full animate-pulse" />
          <span className="text-xs text-leaf-100">線上中</span>
        </div>
      </div>

      {/* 訊息區域 */}
      <div className="h-80 overflow-y-auto p-5 space-y-4 bg-brand-50/30">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-8 h-8 bg-leaf-100 rounded-full flex items-center justify-center text-leaf-600 text-sm mr-2 mt-1 flex-shrink-0">
                🤖
              </div>
            )}
            <div
              className={`max-w-xs md:max-w-sm rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-leaf-500 text-white rounded-br-sm'
                  : 'bg-white border border-brand-100 text-earth-800 rounded-bl-sm shadow-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="w-8 h-8 bg-leaf-100 rounded-full flex items-center justify-center text-leaf-600 text-sm mr-2 flex-shrink-0">🤖</div>
            <div className="bg-white border border-brand-100 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-2 h-2 bg-earth-300 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 快捷問題 */}
      <div className="px-4 py-3 border-t border-brand-100 bg-white">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SUGGESTED_QUESTIONS.map(q => (
            <button
              key={q}
              onClick={() => sendMessage(q)}
              className="flex-shrink-0 text-xs bg-leaf-50 text-leaf-700 border border-leaf-200 rounded-full px-3 py-1.5 hover:bg-leaf-100 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* 輸入框 */}
      <div className="px-4 py-3 border-t border-brand-100 bg-white">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), sendMessage(input))}
            placeholder="輸入您的問題..."
            className="flex-1 px-4 py-2.5 border border-brand-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-leaf-400 focus:border-transparent"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className="btn-primary px-4 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
