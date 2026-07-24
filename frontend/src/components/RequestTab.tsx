import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import {
  Check,
  ChevronDown,
  Clipboard,
  Download,
  Loader2,
  Plus,
  Moon,
  Search,
  Send,
  Sun,
  Monitor,
  Tag,
  Trash2,
  X,
  Code,
  Copy,
  Settings,
  MoreHorizontal,
  Pencil,
  Plug,
} from "lucide-react";
import "../App.css";
import { useTheme } from "./ThemeProvider";
import {
  ExecuteRequest,
  CancelRequest,
  GetHistory,
  DeleteHistory,
  GetAllTags,
  GetTagsWithCount,
  RenameTag,
  DeleteTag,
  UpdateRequestTags,
  ParseCurl,
  ParseHttpEntry,
  SelectFile,
} from "../../wailsjs/go/main/App";
import { engine, db } from "../../wailsjs/go/models";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./Tooltip";
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { Modal } from "./Modal";
import { SocketPanel } from "./SocketPanel";
import { useSocketIO } from "../hooks/useSocketIO";
import { useWebSocket } from "../hooks/useWebSocket";

const PAGE_SIZE = 50;
const MAX_URL_TOOLTIP_LENGTH = 500;
const MAX_VISIBLE_HISTORY_TAGS = 3;

const COMMON_HEADER_NAMES = [
  "Accept",
  "Accept-Encoding",
  "Accept-Language",
  "Authorization",
  "Cache-Control",
  "Content-Type",
  "Cookie",
  "If-None-Match",
  "Origin",
  "Referer",
  "User-Agent",
  "X-API-Key",
  "X-Request-ID",
];

const COMMON_HEADER_VALUES: Record<string, string[]> = {
  accept: ["application/json", "text/plain", "text/html", "*/*"],
  "accept-encoding": ["gzip, deflate, br", "gzip"],
  "accept-language": ["en-US,en;q=0.9", "en", "vi-VN,vi;q=0.9,en;q=0.8"],
  authorization: ["Bearer ", "Basic "],
  "cache-control": ["no-cache", "no-store", "max-age=0"],
  "content-type": ["application/json", "application/x-www-form-urlencoded", "multipart/form-data", "text/plain"],
  origin: ["https://"],
  referer: ["https://"],
  "user-agent": ["Reqly/1.0", "Mozilla/5.0"],
};

interface HeaderRow {
  enabled: boolean;
  key: string;
  value: string;
}

interface RequestHistoryItem {
  id: number;
  url: string;
  method: string;
  headers: string;
  body_type: string;
  body: string;
  form_data: string;
  response_status: number;
  response_body: string;
  response_headers: string;
  duration_ms: number;
  created_at: string;
  tags: string[];
}

type ResponseState = {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  duration_ms: number;
};

function ThemeModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="segmented" aria-label="Theme mode">
      <button className={theme === "light" ? "active" : ""} onClick={() => setTheme("light")} title="Light mode">
        <Sun size={15} />
      </button>
      <button className={theme === "dark" ? "active" : ""} onClick={() => setTheme("dark")} title="Dark mode">
        <Moon size={15} />
      </button>
      <button className={theme === "system" ? "active" : ""} onClick={() => setTheme("system")} title="System theme">
        <Monitor size={15} />
      </button>
    </div>
  );
}



export interface RequestTabProps {
  isActive: boolean;
  isDark: boolean;
  initialHistoryItem?: RequestHistoryItem | null;
  onUpdateTitle: (title: string) => void;
  reloadHistory: () => void;
  loadTags: () => Promise<void>;
  globalImportText?: string;
}

export function RequestTab({ isActive, isDark, initialHistoryItem, onUpdateTitle, reloadHistory, loadTags, globalImportText }: RequestTabProps) {
  const { theme } = useTheme();
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [method, setMethod] = useState("GET");
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { enabled: true, key: "Accept", value: "application/json" },
    { enabled: true, key: "", value: "" },
  ]);
  const [params, setParams] = useState<HeaderRow[]>([
    { enabled: true, key: "", value: "" },
  ]);
  const [bodyType, setBodyType] = useState<"raw" | "form-data" | "x-www-form-urlencoded">("raw");
  const [body, setBody] = useState("");
  const [formData, setFormData] = useState<engine.FormDataItem[]>([
    new engine.FormDataItem({ key: "", value: "", type: "text" })
  ]);
  const [tags, setTags] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ResponseState | null>(null);

  useEffect(() => {
    let title = method + " " + (url || "Untitled Request");
    onUpdateTitle(title);
  }, [method, url]);

  useEffect(() => {
    if (globalImportText) {
      setImportText(globalImportText);
      setTimeout(() => {
        handleImport();
      }, 0);
    }
  }, [globalImportText]);

  useEffect(() => {
    if (!initialHistoryItem) return;
    const item = initialHistoryItem;
    setUrl(item.url);
    setMethod(item.method);
    setBody(item.body || "");
    try {
      const parsedHeaders = JSON.parse(item.headers || "{}");
      const rows: HeaderRow[] = Object.entries(parsedHeaders).map(([key, value]) => ({
        enabled: true, key, value: value as string,
      }));
      rows.push({ enabled: true, key: "", value: "" });
      setHeaders(rows);
    } catch {
      setHeaders([{ enabled: true, key: "", value: "" }]);
    }
    setBodyType((item.body_type as "raw" | "form-data" | "x-www-form-urlencoded") || "raw");
    try {
      if (item.form_data) {
        const parsedFormData = JSON.parse(item.form_data);
        if (Array.isArray(parsedFormData) && parsedFormData.length > 0) {
          setFormData(parsedFormData.map(f => new engine.FormDataItem(f)));
        } else {
          setFormData([new engine.FormDataItem({ key: "", value: "", type: "text" })]);
        }
      } else {
        setFormData([new engine.FormDataItem({ key: "", value: "", type: "text" })]);
      }
    } catch {
      setFormData([new engine.FormDataItem({ key: "", value: "", type: "text" })]);
    }
    setTags(item.tags?.join(", ") || "");
    let parsedRespHeaders: Record<string, string> = {};
    try {
      parsedRespHeaders = JSON.parse(item.response_headers || "{}");
    } catch {}
    setResponse({
      status: item.response_status,
      status_text: `${item.response_status}`,
      headers: parsedRespHeaders,
      body: item.response_body,
      duration_ms: item.duration_ms,
    });
    setError(null);
  }, [initialHistoryItem]);

  const activeRequestIdRef = useRef<string | null>(null);
  const requestWasCancelledRef = useRef(false);

  const socketIO = useSocketIO();
  const webSocket = useWebSocket();

  const [history, setHistory] = useState<RequestHistoryItem[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const isHistoryLoadingRef = useRef(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [tagsWithCount, setTagsWithCount] = useState<db.TagWithCount[]>([]);
  const [isTagManagerOpen, setIsTagManagerOpen] = useState(false);
  const [editingTagName, setEditingTagName] = useState<string | null>(null);
  const [editingTagDraft, setEditingTagDraft] = useState("");
  const [confirmDeleteTagName, setConfirmDeleteTagName] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCurl, setShowCurl] = useState(false);
  const [isCurlCopied, setIsCurlCopied] = useState(false);
  
  // Tag input row state
  const [originalTags, setOriginalTags] = useState("");
  const [isEditingDraftTags, setIsEditingDraftTags] = useState(false);

  const [isResizing, setIsResizing] = useState(false);
  const [isMoreTagsOpen, setIsMoreTagsOpen] = useState(false);
  const moreTagsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreTagsRef.current && !moreTagsRef.current.contains(event.target as Node)) {
        setIsMoreTagsOpen(false);
      }
    };
    if (isMoreTagsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.addEventListener("mousedown", handleClickOutside);
    };
  }, [isMoreTagsOpen]);
  const reqConfigRef = useRef<HTMLElement>(null);
  const isDraggingRef = useRef(false);

  const handleMouseMoveRef = useRef<((e: MouseEvent) => void) | undefined>(undefined);
  const stopResizeRef = useRef<(() => void) | undefined>(undefined);

  if (!handleMouseMoveRef.current) {
    handleMouseMoveRef.current = (e: MouseEvent) => {
      if (!isDraggingRef.current || !reqConfigRef.current) return;
      const top = reqConfigRef.current.getBoundingClientRect().top;
      const newHeight = e.clientY - top;
      reqConfigRef.current.style.height = `${Math.max(100, newHeight)}px`;
    };
  }

  if (!stopResizeRef.current) {
    stopResizeRef.current = () => {
      isDraggingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      if (handleMouseMoveRef.current) document.removeEventListener('mousemove', handleMouseMoveRef.current);
      if (stopResizeRef.current) document.removeEventListener('mouseup', stopResizeRef.current);
    };
  }

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'ns-resize';
    if (handleMouseMoveRef.current) document.addEventListener('mousemove', handleMouseMoveRef.current);
    if (stopResizeRef.current) document.addEventListener('mouseup', stopResizeRef.current);
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showCurl) {
        setShowCurl(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [showCurl]);



  const generateCurl = useCallback(() => {
    let curlStr = `curl -X ${method} '${url}'`;
    
    headers.forEach(h => {
      if (h.enabled && h.key) {
        curlStr += ` \\\n  -H '${h.key}: ${h.value.replace(/'/g, "'\\''")}'`;
      }
    });

    if (method !== 'GET' && method !== 'HEAD') {
      if (bodyType === 'raw' && body) {
        curlStr += ` \\\n  -d '${body.replace(/'/g, "'\\''")}'`;
      } else if (bodyType === 'form-data') {
        formData.forEach(f => {
          if (f.key) {
            if (f.type === 'text') {
              curlStr += ` \\\n  -F '${f.key}=${f.value.replace(/'/g, "'\\''")}'`;
            } else {
              curlStr += ` \\\n  -F '${f.key}=@${f.value.replace(/'/g, "'\\''")}'`;
            }
          }
        });
      } else if (bodyType === 'x-www-form-urlencoded') {
        formData.forEach(f => {
          if (f.key && f.type === 'text') {
            curlStr += ` \\\n  --data-urlencode '${f.key}=${f.value.replace(/'/g, "'\\''")}'`;
          }
        });
      }
    }
    
    return curlStr;
  }, [method, url, headers, bodyType, body, formData]);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const [reqTab, setReqTab] = useState<"params" | "headers" | "body">("headers");
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);
  const [editingTagsText, setEditingTagsText] = useState("");




  const loadHistoryPage = useCallback(
    async (page: number, replace = false) => {
      if (isHistoryLoadingRef.current) return;

      isHistoryLoadingRef.current = true;
      setIsHistoryLoading(true);
      try {
        const hist = (await GetHistory(selectedTag, page, PAGE_SIZE)) || [];
        setHistory((current) => (replace ? hist : [...current, ...hist]));
        setHistoryPage(page);
        setHasMoreHistory(hist.length === PAGE_SIZE);
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        isHistoryLoadingRef.current = false;
        setIsHistoryLoading(false);
      }
    },
    [selectedTag]
  );


  useEffect(() => {
    reloadHistory();
  }, [reloadHistory]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const query = searchQuery.toLowerCase();
    return history.filter(
      (item) =>
        item.url.toLowerCase().includes(query) ||
        item.method.toLowerCase().includes(query) ||
        (item.body && item.body.toLowerCase().includes(query))
    );
  }, [history, searchQuery]);

  const enabledHeaderCount = headers.filter((h) => h.enabled && h.key.trim()).length;
  const enabledParamCount = params.filter((p) => p.enabled && p.key.trim()).length;

  const enabledBodyCount = useMemo(() => {
    if (bodyType === 'raw' || method === 'SOCKET.IO' || method === 'WEBSOCKET') {
      return body.trim() ? 1 : 0;
    } else {
      return formData.filter((f) => f.key.trim()).length;
    }
  }, [bodyType, body, formData, method]);

  useEffect(() => {
    const idx = url.indexOf('?');
    const qs = idx === -1 ? "" : url.substring(idx + 1);
    const searchParams = new URLSearchParams(qs);
    const newParams: HeaderRow[] = [];
    searchParams.forEach((value, key) => {
      newParams.push({ enabled: true, key, value });
    });
    newParams.push({ enabled: true, key: "", value: "" });

    // Deep equal check to prevent loop
    const isSame = newParams.length === params.length && newParams.every((p, i) => p.key === params[i].key && p.value === params[i].value && p.enabled === params[i].enabled);
    if (!isSame) {
      setParams(newParams);
    }
  }, [url]);

  const handleParamChange = (index: number, field: keyof HeaderRow, value: string | boolean) => {
    const updated = [...params];
    updated[index] = { ...updated[index], [field]: value };
    setParams(updated);

    const idx = url.indexOf('?');
    const baseUrl = idx === -1 ? url : url.substring(0, idx);
    const searchParams = new URLSearchParams();
    updated.forEach(p => {
      if (p.enabled && p.key.trim()) {
        searchParams.append(p.key.trim(), p.value);
      }
    });
    const qs = searchParams.toString();
    setUrl(qs ? `${baseUrl}?${qs}` : baseUrl);
  };

  const addParam = () => setParams((current) => [...current, { enabled: true, key: "", value: "" }]);
  
  const removeParam = (index: number) => {
    const updated = params.filter((_, i) => i !== index);
    if (updated.length === 0) {
      updated.push({ enabled: true, key: "", value: "" });
    }
    setParams(updated);

    const idx = url.indexOf('?');
    const baseUrl = idx === -1 ? url : url.substring(0, idx);
    const searchParams = new URLSearchParams();
    updated.forEach(p => {
      if (p.enabled && p.key.trim()) {
        searchParams.append(p.key.trim(), p.value);
      }
    });
    const qs = searchParams.toString();
    setUrl(qs ? `${baseUrl}?${qs}` : baseUrl);
  };

  const handleMethodChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newMethod = event.target.value;
    if (newMethod === "WEBSOCKET" && reqTab === "headers") {
      setReqTab("params");
    }
    setMethod(newMethod);
  };

  const handleSend = async () => {
    if (isLoading) return;
    if (!url.trim()) {
      setError("URL is required");
      return;
    }

    const requestID = crypto.randomUUID();
    activeRequestIdRef.current = requestID;
    requestWasCancelledRef.current = false;
    setIsLoading(true);
    setIsCancelling(false);
    setError(null);
    setResponse(null);

    const filteredHeaders: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.enabled && h.key.trim()) {
        filteredHeaders[h.key.trim()] = h.value;
      }
    });

    if (isEditingDraftTags) {
      setIsEditingDraftTags(false);
    }
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const validFormData = formData.filter(f => f.key.trim());

    if (method === "SOCKET.IO") {
      socketIO.connect(url.trim(), headers, body);
      setIsLoading(false);
      // Save configuration to history
      try {
        await ExecuteRequest(new engine.HTTPRequest({
          url: url.trim(),
          method: "SOCKET.IO",
          headers: filteredHeaders,
          body_type: bodyType,
          body: body,
          form_data: validFormData,
        }), parsedTags, requestID);
      } catch(e) {
        // execute request will fail because the Go backend won't know how to handle SOCKET.IO method,
        // but it will save the history before executing!
      }
      reloadHistory();
      void loadTags();
      return;
    } else if (method === "WEBSOCKET") {
      webSocket.connect(url.trim(), body);
      setIsLoading(false);
      // Save configuration to history
      try {
        await ExecuteRequest(new engine.HTTPRequest({
          url: url.trim(),
          method: "WEBSOCKET",
          headers: filteredHeaders,
          body_type: bodyType,
          body: body,
          form_data: validFormData,
        }), parsedTags, requestID);
      } catch(e) {
      }
      reloadHistory();
      void loadTags();
      return;
    }

    try {
      const reqPayload = new engine.HTTPRequest({
        url: url.trim(),
        method,
        headers: filteredHeaders,
        body_type: bodyType,
        body: body,
        form_data: validFormData,
      });
      const resp = await ExecuteRequest(reqPayload, parsedTags, requestID);

      setResponse(resp as ResponseState);
      setRespTab("body");
      reloadHistory();
      void loadTags();
    } catch (err: any) {
      if (!requestWasCancelledRef.current) {
        setError(err?.toString() || "An unexpected error occurred");
      }
    } finally {
      if (activeRequestIdRef.current === requestID) {
        activeRequestIdRef.current = null;
        setIsLoading(false);
        setIsCancelling(false);
      }
    }
  };

  const handleCancelRequest = () => {
    const requestID = activeRequestIdRef.current;
    if (!requestID || isCancelling) return;

    requestWasCancelledRef.current = true;
    setIsCancelling(true);
    void CancelRequest(requestID);
  };

  const handleHeaderChange = (index: number, field: keyof HeaderRow, value: string | boolean) => {
    const updated = [...headers];
    updated[index] = { ...updated[index], [field]: value };
    setHeaders(updated);
  };

  const addHeader = () => {
    setHeaders((current) => [...current, { enabled: true, key: "", value: "" }]);
  };

  const removeHeader = (index: number) => {
    const updated = headers.filter((_, i) => i !== index);
    setHeaders(updated.length ? updated : [{ enabled: true, key: "", value: "" }]);
  };

  const handleFormDataChange = (index: number, field: keyof engine.FormDataItem, value: string) => {
    const updated = [...formData];
    updated[index] = new engine.FormDataItem({ ...updated[index], [field]: value });
    setFormData(updated);
  };

  const removeFormData = (index: number) => {
    const updated = formData.filter((_, i) => i !== index);
    setFormData(updated.length ? updated : [new engine.FormDataItem({ key: "", value: "", type: "text" })]);
  };

  const handleSelectFile = async (index: number) => {
    try {
      const filePath = await SelectFile();
      if (filePath) {
        handleFormDataChange(index, "value", filePath);
      }
    } catch (err) {
      console.error("SelectFile error", err);
    }
  };



  const handleImport = async () => {
    setImportError(null);
    if (!importText.trim()) {
      setImportError("Please enter some text to parse");
      return;
    }

    try {
      const parsed = importText.trim().toLowerCase().startsWith("curl")
        ? await ParseCurl(importText)
        : await ParseHttpEntry(importText);

      if (!parsed) return;

      setUrl(parsed.url || "");
      setMethod(parsed.method || "GET");
      setBody(parsed.body || "");

      const rows: HeaderRow[] = Object.entries(parsed.headers || {}).map(([key, value]) => ({
        enabled: true,
        key,
        value: value as string,
      }));
      rows.push({ enabled: true, key: "", value: "" });
      setHeaders(rows);

      setShowImport(false);
      setImportText("");
    } catch (err: any) {
      setImportError(err?.toString() || "Failed to parse input");
    }
  };




  const getFormattedResponseBody = () => {
    if (!response?.body) return "";
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  };

  const methodClass = (value: string) => `method-badge ${value.toLowerCase()}`;
  const statusClass = (status: number) => {
    if (status >= 200 && status < 300) return "status-badge success";
    if (status >= 300 && status < 400) return "status-badge info";
    if (status >= 400 && status < 500) return "status-badge warning";
    return "status-badge danger";
  };

  const getTooltipText = (value: string, maxLength = MAX_URL_TOOLTIP_LENGTH) => {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  };

  const getHeaderValueSuggestions = (key: string) => {
    return COMMON_HEADER_VALUES[key.trim().toLowerCase()] || [];
  };

  const canShowBody = ["POST", "PUT", "PATCH", "DELETE", "SOCKET.IO", "WEBSOCKET"].includes(method);

  return (
    <div style={{ display: isActive ? 'flex' : 'none', flex: 1, minWidth: 0, height: '100%', position: 'relative', overflow: 'hidden' }}>
      <main className="workspace" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%', overflow: 'hidden' }}>
        <section className="request-bar panel">
          <div className="request-line">
            <div className="select-wrap">
              <select className="select" value={method} onChange={handleMethodChange}>
                {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "SOCKET.IO", "WEBSOCKET"].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
              className="input url-input"
              placeholder="https://api.example.com/v1/resource"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleSend()}
            />
            {method === "SOCKET.IO" || method === "WEBSOCKET" ? (
              <button
                className={`button ${
                  method === "SOCKET.IO" 
                    ? (socketIO.isConnected ? "outline" : "primary") 
                    : (webSocket.isConnected ? "outline" : "primary")
                } send-button`}
                onClick={
                  method === "SOCKET.IO"
                    ? (socketIO.isConnected ? socketIO.disconnect : handleSend)
                    : (webSocket.isConnected ? webSocket.disconnect : handleSend)
                }
              >
                {(method === "SOCKET.IO" ? socketIO.isConnected : webSocket.isConnected) ? <X size={16} style={{ flexShrink: 0 }} /> : <Plug size={16} style={{ flexShrink: 0 }} />}
                {(method === "SOCKET.IO" ? socketIO.isConnected : webSocket.isConnected) ? "Disconnect" : "Connect"}
              </button>
            ) : (
              <button
                className={`button ${isLoading ? "outline" : "primary"} send-button`}
                onClick={isLoading ? handleCancelRequest : handleSend}
                disabled={isCancelling}
              >
                {isLoading ? (isCancelling ? <Loader2 size={16} className="spin" style={{ flexShrink: 0 }} /> : <X size={16} style={{ flexShrink: 0 }} />) : <Send size={16} style={{ flexShrink: 0 }} />}
                {isLoading ? (isCancelling ? "Cancelling" : "Cancel") : "Send"}
              </button>
            )}
          </div>

          <form 
            className="tag-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              setIsEditingDraftTags(false);
              (document.activeElement as HTMLElement)?.blur();
            }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsEditingDraftTags(false);
              }
            }}
          >
            <Tag size={15} />
            <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
              className="input small"
              placeholder="Associate tags: auth, production"
              value={tags}
              onFocus={() => {
                if (!isEditingDraftTags) {
                  setIsEditingDraftTags(true);
                  setOriginalTags(tags);
                }
              }}
              onChange={(event) => setTags(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setIsEditingDraftTags(false);
                  setTags(originalTags);
                  e.currentTarget.blur();
                }
              }}
            />
            {isEditingDraftTags && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button 
                  className="button outline small" 
                  type="button" 
                  onClick={() => {
                    setIsEditingDraftTags(false);
                    setTags(originalTags);
                  }}
                >
                  Cancel
                </button>
                <button 
                  className="button primary small" 
                  type="submit"
                >
                  Save
                </button>
              </div>
            )}
            {!isEditingDraftTags && (
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="button ghost small" onClick={() => setShowCurl(true)} style={{ marginLeft: 'auto' }}>
                      <Code size={16} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Show equivalent cURL</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </form>
        </section>

        <section ref={reqConfigRef} className="panel request-config">
          <div className="request-config-head">
            <div className="tabs">
              {method !== "WEBSOCKET" && (
                <button className={reqTab === "headers" ? "active" : ""} onClick={() => setReqTab("headers")}>
                  Headers ({enabledHeaderCount})
                </button>
              )}
              {canShowBody && (
                <button className={reqTab === "body" ? "active" : ""} onClick={() => setReqTab("body")}>
                  {method === "SOCKET.IO" 
                    ? (enabledBodyCount > 0 ? `Options (${enabledBodyCount})` : "Options") 
                    : method === "WEBSOCKET" 
                      ? (enabledBodyCount > 0 ? `Protocols (${enabledBodyCount})` : "Protocols") 
                      : (enabledBodyCount > 0 ? `Body (${enabledBodyCount})` : "Body")}
                </button>
              )}
              <button className={reqTab === "params" ? "active" : ""} onClick={() => setReqTab("params")}>
                Params ({enabledParamCount})
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {reqTab === "params" && (
                <button className="button outline small" onClick={addParam}>
                  <Plus size={14} />
                  Add param
                </button>
              )}
              {reqTab === "headers" && method !== "WEBSOCKET" && (
                <button className="button outline small" onClick={addHeader}>
                  <Plus size={14} />
                  Add header
                </button>
              )}
            </div>
          </div>

          {reqTab === "params" && (
            <table className="headers-table">
              <thead>
                <tr>
                  <th style={{ width: '36px', textAlign: "center" }}>On</th>
                  <th style={{ width: '25%' }}>Key</th>
                  <th>Value</th>
                  <th style={{ width: '36px' }}></th>
                </tr>
              </thead>
              <tbody>
                {params.map((row, index) => (
                  <tr className={row.enabled ? "header-row" : "header-row disabled"} key={index}>
                    <td style={{ textAlign: "center" }}>
                      <label className="checkbox" style={{ display: 'flex', justifyContent: 'center' }}>
                        <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(event) => handleParamChange(index, "enabled", event.target.checked)}
                        />
                        <span>{row.enabled && <Check size={13} />}</span>
                      </label>
                    </td>
                    <td>
                      <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                        className="input small"
                        placeholder="Key"
                        value={row.key}
                        onChange={(event) => handleParamChange(index, "key", event.target.value)}
                      />
                    </td>
                    <td>
                      <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                        className="input small"
                        placeholder="Value"
                        value={row.value}
                        onChange={(event) => handleParamChange(index, "value", event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Tab' && index === params.length - 1 && (row.key || row.value)) {
                            addParam();
                          }
                        }}
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <button className="icon-button" onClick={() => removeParam(index)}>
                        <X size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {reqTab === "headers" && method !== "WEBSOCKET" && (
            <>
              <datalist id="common-header-names">
                {COMMON_HEADER_NAMES.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <table className="headers-table">
                <thead>
                  <tr>
                    <th style={{ width: '36px', textAlign: "center" }}>On</th>
                    <th style={{ width: '25%' }}>Key</th>
                    <th>Value</th>
                    <th style={{ width: '36px' }}></th>
                  </tr>
                </thead>
                <tbody>
                {headers.map((row, index) => {
                  const valueSuggestions = getHeaderValueSuggestions(row.key);
                  const valueListId = `common-header-values-${index}`;

                  return (
                    <tr className={row.enabled ? "header-row" : "header-row disabled"} key={index}>
                      <td style={{ textAlign: "center" }}>
                        <label className="checkbox" style={{ display: 'flex', justifyContent: 'center' }}>
                          <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(event) => handleHeaderChange(index, "enabled", event.target.checked)}
                          />
                          <span>{row.enabled && <Check size={13} />}</span>
                        </label>
                      </td>
                      <td>
                        <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                          className="input small"
                          list="common-header-names"
                          placeholder="Content-Type"
                          value={row.key}
                          onChange={(event) => handleHeaderChange(index, "key", event.target.value)}
                        />
                      </td>
                      <td>
                        {valueSuggestions.length > 0 && (
                          <datalist id={valueListId}>
                            {valueSuggestions.map((value) => (
                              <option key={value} value={value} />
                            ))}
                          </datalist>
                        )}
                        <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                          className="input small"
                          list={valueSuggestions.length > 0 ? valueListId : undefined}
                          placeholder="application/json"
                          value={row.value}
                          onChange={(event) => handleHeaderChange(index, "value", event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Tab' && index === headers.length - 1 && (row.key || row.value)) {
                              setHeaders((current) => [...current, { enabled: true, key: "", value: "" }]);
                            }
                          }}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button className="icon-button" onClick={() => removeHeader(index)}>
                          <X size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
            </>
          )}

          {reqTab === "body" && (
            <div className="request-body-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {method !== "SOCKET.IO" && method !== "WEBSOCKET" && (
                <div className="tabs small" style={{ alignSelf: "flex-start" }}>
                  <button className={bodyType === "raw" ? "active" : ""} onClick={() => setBodyType("raw")}>raw</button>
                  <button className={bodyType === "form-data" ? "active" : ""} onClick={() => setBodyType("form-data")}>form-data</button>
                  <button className={bodyType === "x-www-form-urlencoded" ? "active" : ""} onClick={() => setBodyType("x-www-form-urlencoded")}>x-www-form-urlencoded</button>
                </div>
              )}

              {bodyType === "raw" || method === "SOCKET.IO" || method === "WEBSOCKET" ? (
                <div style={{ position: 'relative' }}>
                  <button className="button ghost small" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }} onClick={() => {
                    try {
                      const parsed = JSON.parse(body);
                      setBody(JSON.stringify(parsed, null, 2));
                    } catch {}
                  }}>Format</button>
                  <div className="code-editor-container">
                    <CodeMirror
                      value={body}
                      height="auto"
                      minHeight="100px"
                      theme={isDark ? oneDark : 'light'}
                      extensions={[json()]}
                      onChange={(val) => setBody(val)}
                      basicSetup={{
                        lineNumbers: true,
                        foldGutter: true,
                        highlightActiveLine: false,
                        highlightActiveLineGutter: false,
                      }}
                      style={{
                        fontSize: 13,
                        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
                        backgroundColor: 'transparent'
                      }}
                    />
                  </div>
                  {method === "SOCKET.IO" && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                      JSON options will be merged into the Socket.IO <code>io(url, options)</code> initialization. Example: <code>{`{ "path": "/chat/socket.io", "auth": { "token": "..." } }`}</code>
                    </div>
                  )}
                  {method === "WEBSOCKET" && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--muted-foreground)' }}>
                      JSON array of sub-protocols for standard WebSocket <code>new WebSocket(url, protocols)</code>. Example: <code>{`["graphql-ws"]`}</code>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 80px minmax(180px, 2fr) 30px", columnGap: "8px", rowGap: "6px", alignItems: "center", maxHeight: "230px", overflowY: "auto" }}>
                  <div className="headers-head">Key</div>
                  <div className="headers-head">Type</div>
                  <div className="headers-head">Value</div>
                  <div className="headers-head" />
                  {formData.map((row, index) => (
                    <div style={{ display: "contents" }} key={index}>
                      <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                        className="input small"
                        placeholder="Key"
                        value={row.key}
                        onChange={(event) => handleFormDataChange(index, "key", event.target.value)}
                      />
                      <select 
                        className="select small" 
                        value={row.type} 
                        onChange={(event) => handleFormDataChange(index, "type", event.target.value)}
                        style={{ padding: '0 4px', fontSize: '12px' }}
                        disabled={bodyType === "x-www-form-urlencoded"}
                      >
                        <option value="text">Text</option>
                        {bodyType !== "x-www-form-urlencoded" && <option value="file">File</option>}
                      </select>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input autoCapitalize="none" spellCheck={false} autoComplete="off" autoCorrect="off"
                          className="input small"
                          placeholder={row.type === "file" ? "Select a file..." : "Value"}
                          value={row.value}
                          onChange={(event) => handleFormDataChange(index, "value", event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Tab' && index === formData.length - 1 && (row.key || row.value)) {
                              setFormData((current) => [...current, new engine.FormDataItem({ key: "", value: "", type: "text" })]);
                            }
                          }}
                        />
                        {row.type === "file" && (
                          <button className="button outline small" style={{ flexShrink: 0 }} onClick={() => handleSelectFile(index)}>Browse</button>
                        )}
                      </div>
                      <button className="icon-button" onClick={() => removeFormData(index)}>
                        <X size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <div 
          className={`resizer-horizontal ${isResizing ? 'dragging' : ''}`} 
          onMouseDown={startResize} 
          title="Drag to resize"
        />

        {method === "SOCKET.IO" || method === "WEBSOCKET" ? (
          <>
            {method === "SOCKET.IO" && (
              <SocketPanel 
                type="socket.io"
                isConnected={socketIO.isConnected} 
                messages={socketIO.messages} 
                onEmit={(eventName, payload) => socketIO.emit(eventName, payload)}
                onClear={socketIO.clearMessages}
              />
            )}
            {method === "WEBSOCKET" && (
              <SocketPanel 
                type="websocket"
                isConnected={webSocket.isConnected} 
                messages={webSocket.messages} 
                onEmit={(_eventName, payload) => webSocket.send(payload)}
                onClear={webSocket.clearMessages}
              />
            )}
          </>
        ) : (
          <section className="panel response-panel">
          <div className="response-head">
            <h2>Response</h2>
            {response && (
              <div className="response-meta">
                <span className={statusClass(response.status)}>
                  {response.status} {response.status_text?.replace(response.status.toString(), '').trim()}
                </span>
                <span className="latency">{response.duration_ms} ms</span>
              </div>
            )}
          </div>

          <div className="response-content">
            {error && (
              <div className="error-box">
                <strong>Request Failed</strong>
                <pre>{error}</pre>
              </div>
            )}

            {!response && !error && !isLoading && (
              <div className="empty-state">
                <Send size={38} />
                <h3>No Active Session</h3>
                <p>Type a URL and send it, or select an item from history.</p>
              </div>
            )}

            {isLoading && (
              <div className="empty-state">
                <Loader2 size={38} className="spin" />
                <h3>Connecting to endpoint</h3>
                <p>Waiting for the remote target to return a response.</p>
              </div>
            )}

            {response && !isLoading && (
              <>
                <div className="tabs response-tabs">
                  <button className={respTab === "body" ? "active" : ""} onClick={() => setRespTab("body")}>
                    Body
                  </button>
                  <button className={respTab === "headers" ? "active" : ""} onClick={() => setRespTab("headers")}>
                    Headers ({Object.keys(response.headers || {}).length})
                  </button>
                </div>

                <div className="response-view">
                  {respTab === "body" && (
                    response.body ? (
                      <>
                        <button className="button ghost small" style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 10 }} onClick={() => navigator.clipboard.writeText(getFormattedResponseBody())}>
                          <Copy size={16} />
                        </button>
                        <CodeMirror
                          value={getFormattedResponseBody()}
                          height="auto"
                          theme={isDark ? oneDark : 'light'}
                          extensions={[json()]}
                          readOnly
                          basicSetup={{
                            lineNumbers: true,
                            foldGutter: true,
                            highlightActiveLine: false,
                            highlightActiveLineGutter: false,
                          }}
                          style={{
                            fontSize: 13,
                            fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
                            backgroundColor: 'transparent'
                          }}
                        />
                      </>
                    ) : (
                      <div className="empty-state compact">No response body</div>
                    )
                  )}

                  {respTab === "headers" && (
                    <div className="response-headers">
                      {Object.entries(response.headers || {}).map(([key, value]) => (
                        <div key={key}>
                          <span>{key}</span>
                          <code>{value}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
        )}
      </main>

      <div className={`curl-overlay ${showCurl ? 'show' : ''}`} onClick={() => setShowCurl(false)} />
      {/* cURL Sidebar Overlay */}
      <div className={`curl-sidebar ${showCurl ? 'open' : ''}`}>
        <div className="curl-sidebar-head">
          <h2>cURL Command</h2>
          <button className="icon-button" onClick={() => setShowCurl(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="curl-sidebar-body">
          <button 
            className="button outline small" 
            style={{ marginBottom: '10px' }}
            onClick={() => {
              navigator.clipboard.writeText(generateCurl());
              setIsCurlCopied(true);
              setTimeout(() => setIsCurlCopied(false), 2000);
            }}
          >
            {isCurlCopied ? (
              <>
                <Check size={14} />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} />
                Copy cURL
              </>
            )}
          </button>
          <CodeMirror
            value={generateCurl()}
            height="auto"
            theme={isDark ? oneDark : 'light'}
            extensions={[json()]}
            readOnly
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            style={{
              fontSize: 13,
              fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
              backgroundColor: 'transparent'
            }}
          />
        </div>
      </div>
    </div>
  );
}
