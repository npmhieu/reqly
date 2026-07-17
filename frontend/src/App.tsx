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
} from "lucide-react";
import "./App.css";
import { useTheme } from "./components/ThemeProvider";
import {
  ExecuteRequest,
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
} from "../wailsjs/go/main/App";
import { engine, db } from "../wailsjs/go/models";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "./components/Tooltip";
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';

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

export default function App() {
  const { theme } = useTheme();
  const [url, setUrl] = useState("https://httpbin.org/get");
  const [method, setMethod] = useState("GET");
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { enabled: true, key: "Accept", value: "application/json" },
    { enabled: true, key: "", value: "" },
  ]);
  const [bodyType, setBodyType] = useState<"raw" | "form-data">("raw");
  const [body, setBody] = useState("");
  const [formData, setFormData] = useState<engine.FormDataItem[]>([
    new engine.FormDataItem({ key: "", value: "", type: "text" })
  ]);
  const [tags, setTags] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ResponseState | null>(null);

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

  const [isDark, setIsDark] = useState(() => 
    theme === 'dark' || (theme === 'system' && window.matchMedia("(prefers-color-scheme: dark)").matches)
  );

  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
      setIsDark(mediaQuery.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    } else {
      setIsDark(theme === 'dark');
    }
  }, [theme]);

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
      }
    }
    
    return curlStr;
  }, [method, url, headers, bodyType, body, formData]);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const [reqTab, setReqTab] = useState<"headers" | "body">("headers");
  const [respTab, setRespTab] = useState<"body" | "headers">("body");
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);
  const [editingTagsText, setEditingTagsText] = useState("");

  const loadTags = useCallback(async () => {
    try {
      const tagsList = (await GetAllTags()) || [];
      setAllTags(tagsList);
      const withCount = (await GetTagsWithCount()) || [];
      setTagsWithCount(withCount);
    } catch (err) {
      console.error("Failed to load tags:", err);
    }
  }, []);

  const handleSaveTagEdit = async (oldName: string) => {
    if (!editingTagDraft || editingTagDraft.trim() === "") {
      setEditingTagName(null);
      return;
    }
    const newName = editingTagDraft.trim();
    if (newName !== oldName) {
      try {
        await RenameTag(oldName, newName);
        void loadTags();
        reloadHistory();
      } catch (err) {
        console.error("Failed to rename tag:", err);
      }
    }
    setEditingTagName(null);
  };

  const handleDeleteTag = async (name: string) => {
    try {
      await DeleteTag(name);
      setConfirmDeleteTagName(null);
      void loadTags();
      reloadHistory();
    } catch (err) {
      console.error("Failed to delete tag:", err);
    }
  };

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

  const reloadHistory = useCallback(() => {
    setHistory([]);
    setHasMoreHistory(true);
    void loadHistoryPage(1, true);
  }, [loadHistoryPage]);

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

  const handleSend = async () => {
    if (!url.trim()) {
      setError("URL is required");
      return;
    }

    setIsLoading(true);
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

    try {
      const reqPayload = new engine.HTTPRequest({
        url: url.trim(),
        method,
        headers: filteredHeaders,
        body_type: bodyType,
        body: body,
        form_data: validFormData,
      });
      const resp = await ExecuteRequest(reqPayload, parsedTags);

      setResponse(resp as ResponseState);
      setRespTab("body");
      reloadHistory();
      void loadTags();
    } catch (err: any) {
      setError(err?.toString() || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
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

  const handleDeleteHistory = async (id: number, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await DeleteHistory(id);
      reloadHistory();
      void loadTags();
    } catch (err) {
      console.error("Failed to delete history:", err);
    }
  };

  const handleRerun = (item: RequestHistoryItem) => {
    setUrl(item.url);
    setMethod(item.method);
    setBody(item.body || "");

    try {
      const parsedHeaders = JSON.parse(item.headers || "{}");
      const rows: HeaderRow[] = Object.entries(parsedHeaders).map(([key, value]) => ({
        enabled: true,
        key,
        value: value as string,
      }));
      rows.push({ enabled: true, key: "", value: "" });
      setHeaders(rows);
    } catch {
      setHeaders([{ enabled: true, key: "", value: "" }]);
    }

    setBodyType((item.body_type as "raw" | "form-data") || "raw");
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

  const startEditingTags = (item: RequestHistoryItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingHistoryId(item.id);
    setEditingTagsText(item.tags?.join(", ") || "");
  };

  const saveEditedTags = async (id: number, event: React.FormEvent) => {
    event.preventDefault();
    const updatedTags = editingTagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      await UpdateRequestTags(id, updatedTags);
      setEditingHistoryId(null);
      reloadHistory();
      void loadTags();
    } catch (err) {
      console.error("Failed to update tags:", err);
    }
  };

  const handleHistoryScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 96;
    if (nearBottom && hasMoreHistory && !isHistoryLoading && !searchQuery.trim()) {
      void loadHistoryPage(historyPage + 1);
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

  const canShowBody = ["POST", "PUT", "PATCH", "DELETE"].includes(method);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="app-shell">
        <aside className="sidebar">
        <div className="sidebar-top">
          <div>
            <h1>Reqly</h1>
            <p>HTTP workspace</p>
          </div>
          <ThemeModeToggle />
        </div>

        <div className="sidebar-actions">
          <button className="button outline" onClick={() => setShowImport((value) => !value)}>
            <Download size={16} />
            Import
          </button>
        </div>

        {showImport && (
          <section className="panel import-panel">
            <div className="section-title">Paste cURL or .http Entry</div>
            <textarea
              className="textarea mono"
              rows={5}
              placeholder="curl -X POST https://api.example.com -H 'Content-Type: application/json' -d '{}'"
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
            />
            {importError && <div className="form-error">{importError}</div>}
            <div className="button-row end">
              <button
                className="button ghost"
                onClick={() => {
                  setShowImport(false);
                  setImportText("");
                  setImportError(null);
                }}
              >
                Cancel
              </button>
              <button className="button primary" onClick={handleImport}>
                Parse
              </button>
            </div>
          </section>
        )}

          <div className="sidebar-filter">
          <div className="input-with-icon">
            <Search size={15} />
            <input
              className="input small"
              placeholder="Search loaded history..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>

          <div className="tag-list">
            <div className="tag-chips-container">
              <button className={selectedTag === "" ? "tag-chip active" : "tag-chip"} onClick={() => setSelectedTag("")}>
                All
              </button>
              {allTags.slice(0, 3).map((tagName) => (
                <button
                  key={tagName}
                  className={selectedTag === tagName ? "tag-chip active" : "tag-chip"}
                  onClick={() => setSelectedTag(tagName)}
                >
                  {tagName}
                </button>
              ))}
              {allTags.length > 3 && (
                <div style={{ position: 'relative' }} ref={moreTagsRef}>
                  <button 
                    className="tag-action" 
                    onClick={() => setIsMoreTagsOpen(!isMoreTagsOpen)}
                    style={{ flexShrink: 0 }}
                    title="More Tags"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {isMoreTagsOpen && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      marginTop: '4px',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
                      padding: '6px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      zIndex: 100,
                      minWidth: '150px',
                      maxHeight: '250px',
                      overflowY: 'auto'
                    }}>
                      {allTags.slice(3).map(tagName => (
                        <button
                          key={tagName}
                          className={selectedTag === tagName ? "tag-chip active" : "tag-chip"}
                          style={{ 
                            width: '100%', 
                            justifyContent: 'flex-start', 
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            background: selectedTag === tagName ? 'var(--primary)' : 'transparent',
                            color: selectedTag === tagName ? 'var(--primary-foreground)' : 'var(--foreground)'
                          }}
                          onClick={() => {
                            setAllTags(prev => [tagName, ...prev.filter(t => t !== tagName)]);
                            setSelectedTag(tagName);
                            setIsMoreTagsOpen(false);
                          }}
                        >
                          {tagName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="tag-action" onClick={() => setIsTagManagerOpen(true)} title="Manage Tags" style={{ marginLeft: '8px', flexShrink: 0 }}>
              <Settings size={14} />
            </button>
          </div>
        </div>

        <div className="history-list" onScroll={handleHistoryScroll}>
          {filteredHistory.length === 0 && !isHistoryLoading ? (
            <div className="empty-state compact">No history found</div>
          ) : (
            filteredHistory.map((item) => {
              const visibleTags = item.tags?.slice(0, MAX_VISIBLE_HISTORY_TAGS) || [];
              const hasHiddenTags = (item.tags?.length || 0) > MAX_VISIBLE_HISTORY_TAGS;
              const fullTagList = item.tags?.join(", ") || "No tags";

              return (
                <article key={item.id} className="history-card" onClick={() => handleRerun(item)}>
                  <div className="history-url-row">
                    <span className={methodClass(item.method)}>{item.method}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="history-url">
                          {item.url}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[400px] break-all whitespace-normal">
                        {item.url}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="history-meta">
                    <div className="history-meta-left">
                      <span className={statusClass(item.response_status)}>{item.response_status}</span>
                      <span>{item.duration_ms} ms</span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                            <button className="inline-button" onClick={(event) => startEditingTags(item, event)} style={{ height: '22px' }}>
                              <Tag size={13} style={{ opacity: item.tags?.length ? 1 : 0.5 }} />
                            </button>
                            {visibleTags.length > 0 && (
                              <div className="history-tags">
                                {visibleTags.map((tagName) => (
                                  <span key={tagName}>{tagName}</span>
                                ))}
                                {hasHiddenTags && <span className="tag-overflow">...</span>}
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          {fullTagList}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <button className="inline-button danger-hover" onClick={(event) => handleDeleteHistory(item.id, event)} style={{ height: '22px' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {editingHistoryId === item.id && (
                    <form className="tag-editor" onSubmit={(event) => saveEditedTags(item.id, event)} onClick={(event) => event.stopPropagation()}>
                      <input
                        className="input small"
                        value={editingTagsText}
                        onChange={(event) => setEditingTagsText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingHistoryId(null);
                          }
                        }}
                        placeholder="tag1, tag2"
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button className="button outline small" type="button" onClick={() => setEditingHistoryId(null)}>
                          Cancel
                        </button>
                        <button className="button primary small" type="submit">
                          Save
                        </button>
                      </div>
                    </form>
                  )}
                </article>
              );
            })
          )}
          {isHistoryLoading && (
            <div className="loading-row">
              <Loader2 size={16} className="spin" />
              Loading history
            </div>
          )}
          {!hasMoreHistory && history.length > 0 && !searchQuery.trim() && <div className="end-row">End of history</div>}
        </div>
      </aside>

      <main className="workspace">
        <section className="request-bar panel">
          <div className="request-line">
            <div className="select-wrap">
              <select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>
                {["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"].map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </div>
            <input
              className="input url-input"
              placeholder="https://api.example.com/v1/resource"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleSend()}
            />
            <button className="button primary send-button" onClick={handleSend} disabled={isLoading}>
              {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              Send
            </button>
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
            <input
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
              <button className={reqTab === "headers" ? "active" : ""} onClick={() => setReqTab("headers")}>
                Headers ({enabledHeaderCount})
              </button>
              {canShowBody && (
                <button className={reqTab === "body" ? "active" : ""} onClick={() => setReqTab("body")}>
                  Body
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {reqTab === "headers" && (
                <button className="button outline small" onClick={addHeader}>
                  <Plus size={14} />
                  Add header
                </button>
              )}
            </div>
          </div>

          {reqTab === "headers" && (
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
                          <input
                            type="checkbox"
                            checked={row.enabled}
                            onChange={(event) => handleHeaderChange(index, "enabled", event.target.checked)}
                          />
                          <span>{row.enabled && <Check size={13} />}</span>
                        </label>
                      </td>
                      <td>
                        <input
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
                        <input
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
              <div className="tabs small" style={{ alignSelf: "flex-start" }}>
                <button className={bodyType === "raw" ? "active" : ""} onClick={() => setBodyType("raw")}>Raw</button>
                <button className={bodyType === "form-data" ? "active" : ""} onClick={() => setBodyType("form-data")}>Form-Data</button>
              </div>

              {bodyType === "raw" ? (
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
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 80px minmax(180px, 2fr) 30px", columnGap: "8px", rowGap: "6px", alignItems: "center", maxHeight: "230px", overflowY: "auto" }}>
                  <div className="headers-head">Key</div>
                  <div className="headers-head">Type</div>
                  <div className="headers-head">Value</div>
                  <div className="headers-head" />
                  {formData.map((row, index) => (
                    <div style={{ display: "contents" }} key={index}>
                      <input
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
                      >
                        <option value="text">Text</option>
                        <option value="file">File</option>
                      </select>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input
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

      {isTagManagerOpen && (
        <div className="modal-overlay" onClick={() => setIsTagManagerOpen(false)}>
          <div className="modal-content tag-manager-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Manage Tags</h3>
              <button className="icon-button" onClick={() => setIsTagManagerOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--muted-foreground)' }}>
                Total tags: {tagsWithCount.length}
              </div>
              {tagsWithCount.length === 0 ? (
                <div className="empty-state compact">No tags found</div>
              ) : (
                <div className="tag-manager-list">
                  {tagsWithCount.map((tag) => (
                    <div key={tag.name} className="tag-manager-item">
                      {editingTagName === tag.name ? (
                        <div className="tag-edit-row">
                          <input
                            autoFocus
                            className="input small"
                            value={editingTagDraft}
                            onChange={(e) => setEditingTagDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveTagEdit(tag.name);
                              if (e.key === 'Escape') setEditingTagName(null);
                            }}
                          />
                          <button className="icon-button" onClick={() => handleSaveTagEdit(tag.name)} title="Save"><Check size={14} /></button>
                          <button className="icon-button" onClick={() => setEditingTagName(null)} title="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <div className="tag-info">
                            <span className="tag-name">{tag.name}</span>
                            <span className="tag-count">{tag.count} {tag.count === 1 ? 'request' : 'requests'}</span>
                          </div>
                          {confirmDeleteTagName === tag.name ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>Delete?</span>
                              <button className="button primary small" onClick={() => handleDeleteTag(tag.name)}>Yes</button>
                              <button className="button outline small" onClick={() => setConfirmDeleteTagName(null)}>No</button>
                            </div>
                          ) : (
                            <div className="tag-actions">
                              <button className="icon-button" onClick={() => { setEditingTagName(tag.name); setEditingTagDraft(tag.name); }} title="Edit Tag">
                                <Settings size={14} />
                              </button>
                              <button className="icon-button danger-hover" onClick={() => setConfirmDeleteTagName(tag.name)} title="Delete Tag">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </TooltipProvider>
  );
}
