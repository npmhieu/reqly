package engine

import (
	"errors"
	"strings"

	"github.com/google/shlex"
)

// cleanMarkdownFences strips markdown code fences (like ```http request or ```)
// from the very first and/or very last non-empty lines of the input.
func cleanMarkdownFences(text string) string {
	lines := strings.Split(text, "\n")

	// Find first non-empty line index
	startIdx := -1
	for i, l := range lines {
		if strings.TrimSpace(l) != "" {
			startIdx = i
			break
		}
	}

	// Find last non-empty line index
	endIdx := -1
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" {
			endIdx = i
			break
		}
	}

	if startIdx != -1 && strings.HasPrefix(strings.TrimSpace(lines[startIdx]), "```") {
		lines[startIdx] = "" // clear it
	}
	if endIdx != -1 && endIdx != startIdx && strings.HasPrefix(strings.TrimSpace(lines[endIdx]), "```") {
		lines[endIdx] = "" // clear it
	}

	return strings.Join(lines, "\n")
}

// ParseCurl parses a raw cURL command string into an HTTPRequest
func ParseCurl(curlCommand string) (*HTTPRequest, error) {
	curlCommand = cleanMarkdownFences(curlCommand)

	// Clean up multi-line backslashes
	lines := strings.Split(curlCommand, "\n")
	var cleanedLines []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasSuffix(line, "\\") {
			line = strings.TrimSuffix(line, "\\")
			line = strings.TrimSpace(line)
		}
		if line != "" {
			cleanedLines = append(cleanedLines, line)
		}
	}
	cleanedCommand := strings.Join(cleanedLines, " ")
	cleanedCommand = strings.TrimSpace(cleanedCommand)

	if cleanedCommand == "" {
		return nil, errors.New("empty cURL command")
	}

	// Try to prepend curl if omitted
	if !strings.HasPrefix(strings.ToLower(cleanedCommand), "curl") {
		cleanedCommand = "curl " + cleanedCommand
	}

	tokens, err := shlex.Split(cleanedCommand)
	if err != nil {
		return nil, err
	}

	req := &HTTPRequest{
		Method:  "GET",
		Headers: make(map[string]string),
	}

	hasBody := false
	for i := 0; i < len(tokens); i++ {
		token := tokens[i]
		if token == "curl" && i == 0 {
			continue
		}

		switch token {
		case "-X", "--request":
			if i+1 < len(tokens) {
				req.Method = strings.ToUpper(tokens[i+1])
				i++
			}
		case "-H", "--header":
			if i+1 < len(tokens) {
				headerVal := tokens[i+1]
				parts := strings.SplitN(headerVal, ":", 2)
				if len(parts) == 2 {
					req.Headers[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
				}
				i++
			}
		case "-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode":
			if i+1 < len(tokens) {
				req.Body = tokens[i+1]
				hasBody = true
				i++
			}
		default:
			// Skip arguments for common flags we aren't parsing
			if strings.HasPrefix(token, "-") {
				// List of flags that take arguments in curl
				argFlags := map[string]bool{
					"-u": true, "--user": true,
					"-A": true, "--user-agent": true,
					"-e": true, "--referer": true,
					"-o": true, "--output": true,
					"-m": true, "--max-time": true,
					"--connect-timeout": true,
					"-b": true, "--cookie": true,
					"-c": true, "--cookie-jar": true,
				}
				if argFlags[token] {
					i++ // skip the next token which is the flag's value
				}
				continue
			}

			// Positional argument -> assume URL
			if req.URL == "" {
				req.URL = token
			}
		}
	}

	if req.URL == "" {
		return nil, errors.New("could not find URL in curl command")
	}

	req.URL = strings.Trim(req.URL, "\"'")

	if hasBody && req.Method == "GET" {
		req.Method = "POST"
	}

	return req, nil
}

// ParseHttpEntry parses a raw .http file or HTTP client syntax entry
func ParseHttpEntry(text string) (*HTTPRequest, error) {
	text = cleanMarkdownFences(text)

	lines := strings.Split(text, "\n")
	var reqLineIdx = -1

	// Find the request line (skip comments and empty lines)
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") {
			continue
		}
		if strings.HasPrefix(trimmed, "###") {
			continue
		}
		reqLineIdx = i
		break
	}

	if reqLineIdx == -1 {
		return nil, errors.New("no request line found in .http entry")
	}

	reqLine := strings.TrimSpace(lines[reqLineIdx])
	parts := strings.Fields(reqLine)
	if len(parts) == 0 {
		return nil, errors.New("invalid request line")
	}

	var method, urlStr string
	firstWord := strings.ToUpper(parts[0])
	isMethod := false
	methods := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS", "CONNECT", "TRACE"}
	for _, m := range methods {
		if firstWord == m {
			isMethod = true
			break
		}
	}

	if isMethod {
		method = firstWord
		if len(parts) > 1 {
			urlStr = parts[1]
		} else {
			return nil, errors.New("missing URL in request line")
		}
	} else {
		method = "GET"
		urlStr = parts[0]
	}

	req := &HTTPRequest{
		Method:  method,
		URL:     urlStr,
		Headers: make(map[string]string),
	}

	// Parse headers (from reqLineIdx+1 until empty line or body start)
	bodyStartIdx := -1
	for i := reqLineIdx + 1; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			bodyStartIdx = i + 1
			break
		}

		// Comment or request separator marks end of headers
		if strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "###") {
			bodyStartIdx = i
			break
		}

		if !strings.Contains(trimmed, ":") {
			// Doesn't look like a header, might be the body
			bodyStartIdx = i
			break
		}

		headerParts := strings.SplitN(line, ":", 2)
		if len(headerParts) == 2 {
			req.Headers[strings.TrimSpace(headerParts[0])] = strings.TrimSpace(headerParts[1])
		}
	}

	// Parse body if any
	if bodyStartIdx != -1 && bodyStartIdx < len(lines) {
		var bodyLines []string
		for i := bodyStartIdx; i < len(lines); i++ {
			trimmedLine := strings.TrimSpace(lines[i])
			if strings.HasPrefix(trimmedLine, "###") {
				break
			}
			bodyLines = append(bodyLines, lines[i])
		}
		req.Body = strings.Join(bodyLines, "\n")
		req.Body = strings.Trim(req.Body, "\r\n")
	}

	return req, nil
}
