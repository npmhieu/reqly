import { useState, useRef, useCallback } from 'react';
import type { SocketMessage } from './useSocketIO';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  const addMessage = useCallback((msg: Omit<SocketMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date()
    }]);
  }, []);

  const connect = useCallback((url: string, protocolsStr?: string) => {
    if (socketRef.current) {
      socketRef.current.close();
    }

    try {
      let protocols: string[] | undefined = undefined;
      if (protocolsStr && protocolsStr.trim()) {
        try {
          const parsed = JSON.parse(protocolsStr);
          if (Array.isArray(parsed)) {
             protocols = parsed;
          }
        } catch (e) {
          // If not JSON array, just treat it as a single protocol string
          protocols = [protocolsStr.trim()];
        }
      }

      // Automatically convert http(s) to ws(s) if user forgets
      let wsUrl = url.trim();
      if (wsUrl.startsWith('http://')) wsUrl = wsUrl.replace('http://', 'ws://');
      else if (wsUrl.startsWith('https://')) wsUrl = wsUrl.replace('https://', 'wss://');
      else if (!wsUrl.startsWith('ws://') && !wsUrl.startsWith('wss://')) {
        // default to ws:// if no protocol provided (though usually Wails might throw before this)
        wsUrl = 'ws://' + wsUrl;
      }

      const ws = new WebSocket(wsUrl, protocols);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        addMessage({
          type: 'system',
          payload: `Connected to ${wsUrl}`,
        });
      };

      ws.onmessage = (event) => {
        let payload = event.data;
        try {
          if (typeof payload === 'string') {
             payload = JSON.parse(payload);
          }
        } catch (e) {
          // Not JSON, leave as string
        }

        addMessage({
          type: 'received',
          payload,
        });
      };

      ws.onerror = (error) => {
        addMessage({
          type: 'system',
          payload: `WebSocket Error: Connection failed. Check console for details.`,
        });
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        addMessage({
          type: 'system',
          payload: `Disconnected (Code: ${event.code}, Reason: ${event.reason || 'None'})`,
        });
      };
    } catch (e: any) {
      addMessage({
        type: 'system',
        payload: `Error connecting: ${e.message}`,
      });
    }
  }, [addMessage]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
  }, []);

  const send = useCallback((payload: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      let data = payload;
      if (typeof payload === 'object') {
        data = JSON.stringify(payload);
      } else {
        data = String(payload);
      }
      
      socketRef.current.send(data);
      addMessage({
        type: 'sent',
        payload,
      });
    } else {
      addMessage({
        type: 'system',
        payload: 'Cannot send message: Socket is not connected',
      });
    }
  }, [addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return {
    isConnected,
    messages,
    connect,
    disconnect,
    send,
    clearMessages,
  };
}
