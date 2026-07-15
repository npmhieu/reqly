# Reqly — Project Overview

## What It Is

Reqly is a lightweight desktop REST API client (a Postman alternative). Built as a native app using **Wails v2** (Go backend + embedded React frontend).

The core aims of the project are:
1. **Data Safe & Private:** Your data stays strictly on your local machine; nothing is sent to any 3rd party servers.
2. **Just Call HTTP:** A simple, distraction-free interface to execute HTTP requests.
3. **History & Re-run:** Automatically save request history and easily re-run past requests.
4. **Tags for Filtering:** Tag requests to quickly filter and find them later.
5. **Parse Import:** Easily paste and parse `cURL` commands and `.http` entries.

| Layer | Stack |
|-------|-------|
| Desktop shell | Wails v2.13 |
| Backend | Go 1.25 |
| HTTP engine | `net/http` |
| Persistence | SQLite (`mattn/go-sqlite3`) |
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Custom CSS + CSS variables, Lucide icons |
| Parsing | `google/shlex` (cURL) |

Default window: **1200×800**.

---

## Directory Structure

```
reqly/
├── main.go                 # Wails entry, embeds frontend/dist
├── app.go                  # Wails-bound API methods
├── wails.json              # Wails project config
├── internal/
│   ├── db/database.go      # SQLite schema + CRUD
│   └── engine/
│       ├── client.go       # HTTP execution
│       ├── parser.go       # cURL & .http parsing
│       └── parser_test.go
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main UI (monolithic)
│   │   ├── App.css
│   │   ├── style.css       # Theme CSS variables
│   │   ├── main.tsx
│   │   ├── components/ThemeProvider.tsx
│   │   └── utils/cn.ts
│   ├── wailsjs/            # Auto-generated Go bindings
│   └── package.json
└── build/                  # Platform build assets
```

---

## Backend (Go / Wails)

### Architecture

- **`main.go`** — Wails app, embeds `frontend/dist`, binds `App` struct
- **`app.go`** — Frontend API surface, DB lifecycle
- **`internal/engine`** — HTTP client + parsers
- **`internal/db`** — SQLite at `~/.config/reqly/reqly.db`

### Models

**`engine.HTTPRequest`** — `url`, `method`, `headers`, `body`

**`engine.HTTPResponse`** — `status`, `status_text`, `headers`, `body`, `duration_ms`

**`db.RequestHistory`** — full request/response record + `tags` ([]string)

**DB tables** — `requests_history`, `tags`, `request_tags` (many-to-many)

### Wails API Methods

| Method | Purpose |
|--------|---------|
| `ExecuteRequest(req, tags)` | Run HTTP request, save to history |
| `GetHistory(tagFilter, page, pageSize)` | Paginated history, optional tag filter |
| `DeleteHistory(id)` | Delete history record |
| `GetAllTags()` | List all tags |
| `UpdateRequestTags(requestID, tags)` | Edit tags on history item |
| `ParseCurl(curlCmd)` | Parse cURL → `HTTPRequest` |
| `ParseHttpEntry(httpEntry)` | Parse `.http` syntax → `HTTPRequest` |

### Engine

- 30s timeout, default `User-Agent: Reqly/1.0`
- Body sent for POST/PUT/PATCH/DELETE only
- cURL parser: `-X`, `-H`, `-d`, line continuations, markdown fences
- `.http` parser: request line, headers, body, `###` separators

---

## Frontend

Single-page app. Almost all UI in **`App.tsx`**. Only other component: **`ThemeProvider.tsx`**.

### Layout

- **Sidebar (360px)** — branding, theme toggle, import, search, tag filters, history list
- **Main workspace** — request bar, headers/body, response panel

### Features

1. **Request builder** — methods, URL, tags, headers grid (enable/disable, autocomplete), body tab
2. **Response viewer** — status badge, latency, JSON pretty-print, copy, headers tab
3. **Import** — paste cURL or `.http` entry
4. **History** — cards (method, URL tooltip, status, duration), click-to-rerun, infinite scroll (50/page), search, tag filter chips, inline tag edit
5. **Themes** — Light / Dark / System, persisted in `localStorage`

### State

No Redux/Zustand. React `useState` + `useCallback` + `useMemo` + `useEffect`. Backend via `frontend/wailsjs/go/main/App`.

---

## Run / Build

### Dev
```bash
wails dev
```
Browser dev server: `http://localhost:34115`

### Frontend only
```bash
cd frontend && npm install && npm run dev
```

### Production
```bash
wails build
```
Output: `build/bin/` (e.g. `reqly.app` on macOS)

### Tests
```bash
go test ./internal/engine/...
```

---

## Key Dependencies

**Go** — `wailsapp/wails/v2`, `mattn/go-sqlite3`, `google/shlex`

**Frontend** — `react` 19, `lucide-react`, `vite`, `typescript`, `clsx`, `tailwind-merge`

UI styling is primarily custom CSS (`App.css`, `style.css`). Tailwind configured but lightly used.

---

## Codebase Size

Small, early-stage Wails app. ~740 lines `App.tsx`, ~320 lines `database.go`. Monolithic frontend, no external state library.
