package main

import (
	"context"
	"encoding/json"
	"fmt"
	"reqly/internal/db"
	"reqly/internal/engine"
	"log"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
	db  *db.DBManager
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	mgr, err := db.NewDBManager()
	if err != nil {
		log.Printf("ERROR: Failed to initialize SQLite database: %v", err)
		return
	}
	a.db = mgr
}

// shutdown is called when the application is closing
func (a *App) shutdown(ctx context.Context) {
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			log.Printf("ERROR: Failed to close database: %v", err)
		}
	}
}

// ExecuteRequest executes an HTTP request, saves it to history, and returns the response
func (a *App) ExecuteRequest(req engine.HTTPRequest, tags []string) (*engine.HTTPResponse, error) {
	resp, err := engine.ExecuteRequest(&req)
	if err != nil {
		return nil, err
	}

	if a.db != nil {
		reqHeadersJSON, _ := json.Marshal(req.Headers)
		respHeadersJSON, _ := json.Marshal(resp.Headers)
		formDataJSON, _ := json.Marshal(req.FormData)

		historyItem := &db.RequestHistory{
			URL:             req.URL,
			Method:          req.Method,
			Headers:         string(reqHeadersJSON),
			BodyType:        req.BodyType,
			Body:            req.Body,
			FormData:        string(formDataJSON),
			ResponseStatus:  resp.Status,
			ResponseBody:    resp.Body,
			ResponseHeaders: string(respHeadersJSON),
			DurationMS:      resp.DurationMS,
			Tags:            tags,
		}

		_, err = a.db.SaveHistory(historyItem)
		if err != nil {
			log.Printf("ERROR: Failed to save request to history: %v", err)
		}
	}

	return resp, nil
}

// GetHistory retrieves paginated request history, optionally filtered by a tag.
func (a *App) GetHistory(tagFilter string, page int, pageSize int) ([]db.RequestHistory, error) {
	if a.db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return a.db.GetHistory(tagFilter, page, pageSize)
}

// DeleteHistory removes a history record
func (a *App) DeleteHistory(id int64) error {
	if a.db == nil {
		return fmt.Errorf("database not initialized")
	}
	return a.db.DeleteHistory(id)
}

// GetAllTags retrieves all tags
func (a *App) GetAllTags() ([]string, error) {
	if a.db == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	return a.db.GetAllTags()
}

// UpdateRequestTags updates the tags for a specific request
func (a *App) UpdateRequestTags(requestID int64, tags []string) error {
	if a.db == nil {
		return fmt.Errorf("database not initialized")
	}
	return a.db.UpdateRequestTags(requestID, tags)
}

// GetTagsWithCount retrieves all tags with their usage count
func (a *App) GetTagsWithCount() ([]db.TagWithCount, error) {
	return a.db.GetTagsWithCount()
}

// RenameTag renames a tag and merges it if the new name already exists
func (a *App) RenameTag(oldName, newName string) error {
	return a.db.RenameTag(oldName, newName)
}

// DeleteTag deletes a tag entirely
func (a *App) DeleteTag(name string) error {
	return a.db.DeleteTag(name)
}

// ParseCurl parses a raw cURL command
func (a *App) ParseCurl(curlCmd string) (*engine.HTTPRequest, error) {
	log.Printf("[Go Backend] Received ParseCurl request with input length %d", len(curlCmd))
	req, err := engine.ParseCurl(curlCmd)
	if err != nil {
		log.Printf("[Go Backend] ParseCurl error: %v", err)
		return nil, err
	}
	log.Printf("[Go Backend] ParseCurl parsed successfully. Method: %s, URL: %s, Headers: %d keys", req.Method, req.URL, len(req.Headers))
	return req, nil
}

// ParseHttpEntry parses a raw .http format entry
func (a *App) ParseHttpEntry(httpEntry string) (*engine.HTTPRequest, error) {
	log.Printf("[Go Backend] Received ParseHttpEntry request with input length %d", len(httpEntry))
	req, err := engine.ParseHttpEntry(httpEntry)
	if err != nil {
		log.Printf("[Go Backend] ParseHttpEntry error: %v", err)
		return nil, err
	}
	log.Printf("[Go Backend] ParseHttpEntry parsed successfully. Method: %s, URL: %s, Headers: %d keys", req.Method, req.URL, len(req.Headers))
	return req, nil
}

// SelectFile opens a native dialog for file selection
func (a *App) SelectFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select File",
	})
}
