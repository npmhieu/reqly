import { useState, useRef, useEffect } from "react";
import { Send, Trash2, ArrowDownCircle, ArrowUpCircle, Info } from "lucide-react";
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { useTheme } from "./ThemeProvider";
import type { SocketMessage } from "../hooks/useSocketIO";

interface SocketPanelProps {
  messages: SocketMessage[];
  isConnected: boolean;
  onEmit: (eventName: string, payload: any) => void;
  onClear: () => void;
}

export function SocketPanel({ messages, isConnected, onEmit, onClear }: SocketPanelProps) {
  const { theme } = useTheme();
  const [eventName, setEventName] = useState("");
  const [payloadText, setPayloadText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleEmit = () => {
    if (!eventName.trim()) return;
    
    let parsedPayload = payloadText;
    try {
      if (payloadText.trim()) {
        parsedPayload = JSON.parse(payloadText);
      }
    } catch (e) {
      // Send as raw string if JSON parsing fails
    }

    onEmit(eventName.trim(), parsedPayload);
    setPayloadText("");
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: '8px' }}>
      <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="request-config-head" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', marginBottom: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '13px' }}>Chat Log</div>
          <button className="icon-button" onClick={onClear} title="Clear Messages">
            <Trash2 size={14} />
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.length === 0 ? (
            <div className="empty-state compact">No messages yet.</div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} style={{ 
                display: 'flex', 
                gap: '8px', 
                fontSize: '13px',
                alignItems: 'flex-start',
                background: msg.type === 'system' ? 'var(--muted)' : (msg.type === 'sent' ? 'var(--blue-soft)' : 'var(--green-soft)'),
                padding: '8px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)'
              }}>
                <div style={{ marginTop: '2px', color: msg.type === 'system' ? 'var(--muted-foreground)' : (msg.type === 'sent' ? 'var(--blue)' : 'var(--green)') }}>
                  {msg.type === 'system' && <Info size={14} />}
                  {msg.type === 'sent' && <ArrowUpCircle size={14} />}
                  {msg.type === 'received' && <ArrowDownCircle size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                      {msg.type === 'system' ? 'System' : (msg.type === 'sent' ? `Emit: ${msg.eventName}` : `Receive: ${msg.eventName}`)}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--muted-foreground)' }}>
                      {msg.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ color: 'var(--foreground)', whiteSpace: 'pre-wrap', fontFamily: msg.type !== 'system' ? 'monospace' : 'inherit' }}>
                    {typeof msg.payload === 'object' ? JSON.stringify(msg.payload, null, 2) : String(msg.payload)}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="panel" style={{ height: '200px', display: 'flex', flexDirection: 'column', padding: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <input
            className="input small"
            style={{ width: '200px', flexShrink: 0 }}
            placeholder="Event name (e.g. 'message')"
            value={eventName}
            onChange={e => setEventName(e.target.value)}
            disabled={!isConnected}
          />
          <button 
            className="button primary small" 
            onClick={handleEmit}
            disabled={!isConnected || !eventName.trim()}
          >
            <Send size={14} />
            Emit
          </button>
        </div>
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <CodeMirror
            value={payloadText}
            onChange={setPayloadText}
            theme={isDark ? oneDark : 'light'}
            extensions={[json()]}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
            }}
            editable={isConnected}
            style={{
              height: '100%',
              fontSize: 13,
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            placeholder={isConnected ? "Enter JSON or text payload here..." : "Connect to socket to emit messages."}
          />
        </div>
      </div>
    </div>
  );
}
