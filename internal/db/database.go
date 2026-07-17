package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type RequestHistory struct {
	ID              int64     `json:"id"`
	URL             string    `json:"url"`
	Method          string    `json:"method"`
	Headers         string    `json:"headers"` // JSON string
	BodyType        string    `json:"body_type"`
	Body            string    `json:"body"`
	FormData        string    `json:"form_data"` // JSON string
	ResponseStatus  int       `json:"response_status"`
	ResponseBody    string    `json:"response_body"`
	ResponseHeaders string    `json:"response_headers"` // JSON string
	DurationMS      int64     `json:"duration_ms"`
	CreatedAt       time.Time `json:"created_at"`
	Tags            []string  `json:"tags"`
}

type DBManager struct {
	db *sql.DB
}

func NewDBManager() (*DBManager, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user config dir: %v", err)
	}

	appDir := filepath.Join(configDir, "reqly")

	if err := os.MkdirAll(appDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create app config dir: %v", err)
	}

	dbPath := filepath.Join(appDir, "reqly.db")
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %v", err)
	}

	mgr := &DBManager{db: db}
	if err := mgr.migrate(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %v", err)
	}

	return mgr, nil
}

func (m *DBManager) Close() error {
	if m.db != nil {
		return m.db.Close()
	}
	return nil
}

func (m *DBManager) migrate() error {
	queries := []string{
		`PRAGMA foreign_keys = ON;`,
		`CREATE TABLE IF NOT EXISTS requests_history (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			url TEXT NOT NULL,
			method TEXT NOT NULL,
			headers TEXT,
			body TEXT,
			response_status INTEGER,
			response_body TEXT,
			response_headers TEXT,
			duration_ms INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS tags (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS request_tags (
			request_id INTEGER,
			tag_id INTEGER,
			PRIMARY KEY (request_id, tag_id),
			FOREIGN KEY (request_id) REFERENCES requests_history(id) ON DELETE CASCADE,
			FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
		);`,
	}

	for _, query := range queries {
		if _, err := m.db.Exec(query); err != nil {
			return err
		}
	}

	// Migrations for new columns
	_, _ = m.db.Exec(`ALTER TABLE requests_history ADD COLUMN body_type TEXT DEFAULT 'raw'`)
	_, _ = m.db.Exec(`ALTER TABLE requests_history ADD COLUMN form_data TEXT`)

	return nil
}

func (m *DBManager) SaveHistory(req *RequestHistory) (int64, error) {
	tx, err := m.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	query := `INSERT INTO requests_history 
		(url, method, headers, body_type, body, form_data, response_status, response_body, response_headers, duration_ms) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

	res, err := tx.Exec(query, req.URL, req.Method, req.Headers, req.BodyType, req.Body, req.FormData, req.ResponseStatus, req.ResponseBody, req.ResponseHeaders, req.DurationMS)
	if err != nil {
		return 0, err
	}

	reqID, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	// Save tags
	for _, tagName := range req.Tags {
		tagName = strings.TrimSpace(strings.ToLower(tagName))
		if tagName == "" {
			continue
		}

		// Ensure tag exists
		var tagID int64
		err = tx.QueryRow(`INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=name RETURNING id`, tagName).Scan(&tagID)
		if err != nil {
			return 0, err
		}

		// Associate tag with request
		_, err = tx.Exec(`INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)`, reqID, tagID)
		if err != nil {
			return 0, err
		}
	}

	err = tx.Commit()
	if err != nil {
		return 0, err
	}

	return reqID, nil
}

func (m *DBManager) GetHistory(tagFilter string, page, pageSize int) ([]RequestHistory, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 {
		pageSize = 50
	}
	offset := (page - 1) * pageSize

	var query string
	var args []interface{}

	if tagFilter != "" {
		tagFilter = strings.TrimSpace(strings.ToLower(tagFilter))
		query = `SELECT rh.id, rh.url, rh.method, rh.headers, rh.body_type, rh.body, rh.form_data, rh.response_status, rh.response_body, rh.response_headers, rh.duration_ms, rh.created_at, group_concat(t.name) as tags
			FROM requests_history rh
			LEFT JOIN request_tags rt ON rh.id = rt.request_id
			LEFT JOIN tags t ON rt.tag_id = t.id
			WHERE rh.id IN (
				SELECT request_id FROM request_tags rt2 
				JOIN tags t2 ON rt2.tag_id = t2.id 
				WHERE t2.name = ?
			)
			GROUP BY rh.id
			ORDER BY rh.created_at DESC
			LIMIT ? OFFSET ?`
		args = append(args, tagFilter, pageSize, offset)
	} else {
		query = `SELECT rh.id, rh.url, rh.method, rh.headers, rh.body_type, rh.body, rh.form_data, rh.response_status, rh.response_body, rh.response_headers, rh.duration_ms, rh.created_at, group_concat(t.name) as tags
			FROM requests_history rh
			LEFT JOIN request_tags rt ON rh.id = rt.request_id
			LEFT JOIN tags t ON rt.tag_id = t.id
			GROUP BY rh.id
			ORDER BY rh.created_at DESC
			LIMIT ? OFFSET ?`
		args = append(args, pageSize, offset)
	}

	rows, err := m.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var history []RequestHistory
	for rows.Next() {
		var h RequestHistory
		var tagsStr sql.NullString
		var headers sql.NullString
		var bodyType sql.NullString
		var body sql.NullString
		var formData sql.NullString
		var respBody sql.NullString
		var respHeaders sql.NullString
		var createdAtStr string

		err := rows.Scan(
			&h.ID, &h.URL, &h.Method, &headers, &bodyType, &body, &formData,
			&h.ResponseStatus, &respBody, &respHeaders, &h.DurationMS, &createdAtStr, &tagsStr,
		)
		if err != nil {
			return nil, err
		}

		h.Headers = headers.String
		if bodyType.Valid && bodyType.String != "" {
			h.BodyType = bodyType.String
		} else {
			h.BodyType = "raw"
		}
		h.Body = body.String
		h.FormData = formData.String
		h.ResponseBody = respBody.String
		h.ResponseHeaders = respHeaders.String

		if tagsStr.Valid && tagsStr.String != "" {
			h.Tags = strings.Split(tagsStr.String, ",")
		} else {
			h.Tags = []string{}
		}

		// Parse SQLite datetime
		// SQLite often returns it as "YYYY-MM-DD HH:MM:SS" or RFC3339
		t, err := parseTime(createdAtStr)
		if err == nil {
			h.CreatedAt = t
		}

		history = append(history, h)
	}

	return history, nil
}

func parseTime(s string) (time.Time, error) {
	layouts := []string{
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05Z",
		"2006-01-02 15:04:05.999999999-07:00",
	}
	for _, l := range layouts {
		if t, err := time.Parse(l, s); err == nil {
			return t, nil
		}
	}
	// Fallback to SQLite standard UTC conversion if there's no timezone
	if !strings.Contains(s, "Z") && !strings.Contains(s, "+") {
		if t, err := time.ParseInLocation("2006-01-02 15:04:05", s, time.UTC); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse time: %s", s)
}

func (m *DBManager) DeleteHistory(id int64) error {
	_, err := m.db.Exec(`DELETE FROM requests_history WHERE id = ?`, id)
	return err
}

func (m *DBManager) GetAllTags() ([]string, error) {
	rows, err := m.db.Query(`SELECT name FROM tags ORDER BY name ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		tags = append(tags, name)
	}
	return tags, nil
}

func (m *DBManager) UpdateRequestTags(requestID int64, tags []string) error {
	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Clear old associations
	_, err = tx.Exec(`DELETE FROM request_tags WHERE request_id = ?`, requestID)
	if err != nil {
		return err
	}

	// Insert new ones
	for _, tagName := range tags {
		tagName = strings.TrimSpace(strings.ToLower(tagName))
		if tagName == "" {
			continue
		}

		// Ensure tag exists
		var tagID int64
		err = tx.QueryRow(`INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO UPDATE SET name=name RETURNING id`, tagName).Scan(&tagID)
		if err != nil {
			return err
		}

		// Associate
		_, err = tx.Exec(`INSERT OR IGNORE INTO request_tags (request_id, tag_id) VALUES (?, ?)`, requestID, tagID)
		if err != nil {
			return err
		}
	}

	// Clean up unused tags
	_, err = tx.Exec(`DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM request_tags)`)
	if err != nil {
		return err
	}

	return tx.Commit()
}

type TagWithCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func (m *DBManager) GetTagsWithCount() ([]TagWithCount, error) {
	query := `SELECT t.name, COUNT(rt.request_id) 
			  FROM tags t 
			  LEFT JOIN request_tags rt ON t.id = rt.tag_id 
			  GROUP BY t.id 
			  ORDER BY t.name ASC`
	rows, err := m.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []TagWithCount
	for rows.Next() {
		var t TagWithCount
		if err := rows.Scan(&t.Name, &t.Count); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, nil
}

func (m *DBManager) RenameTag(oldName, newName string) error {
	oldName = strings.TrimSpace(strings.ToLower(oldName))
	newName = strings.TrimSpace(strings.ToLower(newName))
	if oldName == "" || newName == "" {
		return fmt.Errorf("tag name cannot be empty")
	}

	tx, err := m.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Check if newName already exists
	var newTagID int64
	err = tx.QueryRow(`SELECT id FROM tags WHERE name = ?`, newName).Scan(&newTagID)
	
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	if err == sql.ErrNoRows {
		// newName doesn't exist, simply update the old tag
		_, err = tx.Exec(`UPDATE tags SET name = ? WHERE name = ?`, newName, oldName)
		if err != nil {
			return err
		}
	} else {
		// newName exists, we need to merge
		var oldTagID int64
		err = tx.QueryRow(`SELECT id FROM tags WHERE name = ?`, oldName).Scan(&oldTagID)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil // old tag doesn't exist, nothing to do
			}
			return err
		}

		// Update all request_tags pointing to oldTagID to point to newTagID
		_, err = tx.Exec(`UPDATE OR IGNORE request_tags SET tag_id = ? WHERE tag_id = ?`, newTagID, oldTagID)
		if err != nil {
			return err
		}

		// Delete oldTagID from request_tags (for any conflicts ignored above)
		_, err = tx.Exec(`DELETE FROM request_tags WHERE tag_id = ?`, oldTagID)
		if err != nil {
			return err
		}

		// Delete old tag
		_, err = tx.Exec(`DELETE FROM tags WHERE id = ?`, oldTagID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *DBManager) DeleteTag(name string) error {
	name = strings.TrimSpace(strings.ToLower(name))
	if name == "" {
		return nil
	}
	_, err := m.db.Exec(`DELETE FROM tags WHERE name = ?`, name)
	return err
}
