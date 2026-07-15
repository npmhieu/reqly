package engine

import (
	"testing"
)

func TestParseHttpEntry(t *testing.T) {
	input := `### api list my chat
GET https://api.dev.upzi.vn/chat/external/chats/my?limit=100&page=1
Authorization: Bearer Zjg2YzhlYTIwYTBhMmZlZGYzZmFhZjMxNGIyNzQ2NGNjODY5MGM0NzE2NmY4ZWMzNzZjMzU2NDk4NGI4NDFmNg
Accept-Language: en
X-Source: app-ios
X-Realm: VNWJS
Content-Type: application/json`

	req, err := ParseHttpEntry(input)
	if err != nil {
		t.Fatalf("ParseHttpEntry failed: %v", err)
	}

	if req.Method != "GET" {
		t.Errorf("expected Method GET, got %s", req.Method)
	}

	if req.URL != "https://api.dev.upzi.vn/chat/external/chats/my?limit=100&page=1" {
		t.Errorf("expected URL, got %s", req.URL)
	}

	if req.Headers["Authorization"] != "Bearer Zjg2YzhlYTIwYTBhMmZlZGYzZmFhZjMxNGIyNzQ2NGNjODY5MGM0NzE2NmY4ZWMzNzZjMzU2NDk4NGI4NDFmNg" {
		t.Errorf("expected Authorization header, got %s", req.Headers["Authorization"])
	}

	if req.Headers["Content-Type"] != "application/json" {
		t.Errorf("expected Content-Type header, got %s", req.Headers["Content-Type"])
	}
}

func TestParseHttpEntryWithMarkdownFences(t *testing.T) {
	input := "```http request\n" +
		"### api list my chat\n" +
		"GET https://api.dev.upzi.vn/chat/external/chats/my?limit=100&page=1\n" +
		"Authorization: Bearer Zjg2YzhlYTIwYTBhMmZlZGYzZmFhZjMxNGIyNzQ2NGNjODY5MGM0NzE2NmY4ZWMzNzZjMzU2NDk4NGI4NDFmNg\n" +
		"Accept-Language: en\n" +
		"X-Source: app-ios\n" +
		"X-Realm: VNWJS\n" +
		"Content-Type: application/json\n" +
		"```"

	req, err := ParseHttpEntry(input)
	if err != nil {
		t.Fatalf("ParseHttpEntry failed: %v", err)
	}

	if req.Method != "GET" {
		t.Errorf("expected Method GET, got %s", req.Method)
	}

	if req.URL != "https://api.dev.upzi.vn/chat/external/chats/my?limit=100&page=1" {
		t.Errorf("expected URL, got %s", req.URL)
	}

	if req.Headers["Authorization"] != "Bearer Zjg2YzhlYTIwYTBhMmZlZGYzZmFhZjMxNGIyNzQ2NGNjODY5MGM0NzE2NmY4ZWMzNzZjMzU2NDk4NGI4NDFmNg" {
		t.Errorf("expected Authorization header, got %s", req.Headers["Authorization"])
	}
}
