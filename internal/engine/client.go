package engine

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type FormDataItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Type  string `json:"type"` // "text" or "file"
}

type HTTPRequest struct {
	URL      string            `json:"url"`
	Method   string            `json:"method"`
	Headers  map[string]string `json:"headers"`
	BodyType string            `json:"body_type"`
	Body     string            `json:"body"`
	FormData []FormDataItem    `json:"form_data"`
}

type HTTPResponse struct {
	Status     int               `json:"status"`
	StatusText string            `json:"status_text"`
	Headers    map[string]string `json:"headers"`
	Body       string            `json:"body"`
	DurationMS int64             `json:"duration_ms"`
}

func ExecuteRequest(ctx context.Context, req *HTTPRequest) (*HTTPResponse, error) {
	method := strings.ToUpper(req.Method)
	if method == "" {
		method = "GET"
	}

	var bodyReader io.Reader
	var contentType string

	if method == "POST" || method == "PUT" || method == "PATCH" || method == "DELETE" {
		if req.BodyType == "form-data" {
			bodyBuffer := &bytes.Buffer{}
			writer := multipart.NewWriter(bodyBuffer)

			for _, item := range req.FormData {
				if item.Type == "file" {
					file, err := os.Open(item.Value)
					if err != nil {
						return nil, err
					}
					part, err := writer.CreateFormFile(item.Key, filepath.Base(item.Value))
					if err != nil {
						file.Close()
						return nil, err
					}
					io.Copy(part, file)
					file.Close()
				} else {
					writer.WriteField(item.Key, item.Value)
				}
			}
			writer.Close()
			bodyReader = bodyBuffer
			contentType = writer.FormDataContentType()
		} else if req.Body != "" {
			bodyReader = bytes.NewBufferString(req.Body)
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, method, req.URL, bodyReader)
	if err != nil {
		return nil, err
	}

	// Set Content-Type if it's multipart
	if contentType != "" {
		httpReq.Header.Set("Content-Type", contentType)
	}

	// Set default User-Agent if not specified and add other headers
	hasUserAgent := false
	for k, v := range req.Headers {
		if strings.ToLower(k) == "user-agent" {
			hasUserAgent = true
		}
		// If content type was set automatically by multipart, don't overwrite it with empty or wrong user header
		if strings.ToLower(k) == "content-type" && contentType != "" {
			continue
		}
		httpReq.Header.Set(k, v)
	}
	if !hasUserAgent {
		httpReq.Header.Set("User-Agent", "Reqly/1.0")
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	startTime := time.Now()
	resp, err := client.Do(httpReq)
	duration := time.Since(startTime).Milliseconds()

	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	respHeaders := make(map[string]string)
	for k, v := range resp.Header {
		respHeaders[k] = strings.Join(v, ", ")
	}

	return &HTTPResponse{
		Status:     resp.StatusCode,
		StatusText: resp.Status,
		Headers:    respHeaders,
		Body:       string(respBodyBytes),
		DurationMS: duration,
	}, nil
}
