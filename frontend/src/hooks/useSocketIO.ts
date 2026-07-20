import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export type SocketMessage = {
  id: string;
  type: 'system' | 'sent' | 'received';
  eventName?: string;
  payload?: any;
  timestamp: Date;
};

export function useSocketIO() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<SocketMessage[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const addMessage = useCallback((msg: Omit<SocketMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date()
    }]);
  }, []);

  const connect = useCallback((url: string, headers: Array<{key: string, value: string, enabled: boolean}>) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const extraHeaders: Record<string, string> = {};
    headers.forEach(h => {
      if (h.enabled && h.key.trim()) {
        extraHeaders[h.key.trim()] = h.value;
      }
    });

    try {
      const newSocket = io(url, {
        extraHeaders,
        transports: ['websocket', 'polling']
      });

      newSocket.on('connect', () => {
        setIsConnected(true);
        addMessage({ type: 'system', payload: `Connected to ${url}` });
      });

      newSocket.on('disconnect', (reason) => {
        setIsConnected(false);
        addMessage({ type: 'system', payload: `Disconnected: ${reason}` });
      });

      newSocket.on('connect_error', (error) => {
        setIsConnected(false);
        addMessage({ type: 'system', payload: `Connection Error: ${error.message}` });
      });

      // Capture all incoming events using wildcard catch-all (available in Socket.IO v4)
      newSocket.onAny((eventName, ...args) => {
        addMessage({
          type: 'received',
          eventName,
          payload: args.length === 1 ? args[0] : args
        });
      });

      socketRef.current = newSocket;
      setSocket(newSocket);
    } catch (err: any) {
      addMessage({ type: 'system', payload: `Failed to initialize socket: ${err.message}` });
    }
  }, [addMessage]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    }
  }, []);

  const emit = useCallback((eventName: string, payload: any) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(eventName, payload);
      addMessage({ type: 'sent', eventName, payload });
    }
  }, [isConnected, addMessage]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  return {
    socket,
    isConnected,
    messages,
    connect,
    disconnect,
    emit,
    clearMessages
  };
}
