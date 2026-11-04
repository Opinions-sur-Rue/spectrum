package canvas

import (
	"strings"
	"testing"
)

func TestTitleFromMarkdown(t *testing.T) {
	for _, test := range []struct{ name, markdown, want string }{
		{"first h1", "## Not title\n\n# Actual **title**\n\n# Later", "Actual title"},
		{"fenced code", "```md\n# Not heading\n```\n\n# Visible", "Visible"},
		{"setext", "Setext heading\n==============", "Setext heading"},
		{"no heading", "Body only", "Untitled note"},
		{"empty heading", "#\n\n# Content", "Content"},
		{"unicode limit", "# " + strings.Repeat("é", 90), strings.Repeat("é", MaxNoteTitleRunes)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := TitleFromMarkdown(test.markdown); got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

func TestInvalidMarkdownPatchDoesNotChangeDerivedTitle(t *testing.T) {
	board := New()
	note, err := board.CreateNote("author", NoteDraft{Title: "Before", Markdown: "# Before"}, ModerationApproved)
	if err != nil {
		t.Fatal(err)
	}
	title := "After"
	markdown := strings.Repeat("x", MaxNoteMarkdownRunes+1)
	if _, err := board.UpdateNote(note.ID, note.Version, NotePatch{Title: &title, Markdown: &markdown}); err != ErrInvalidMarkdown {
		t.Fatalf("error = %v", err)
	}
	stored, _ := board.GetNote(note.ID)
	if stored.Title != note.Title || stored.Markdown != note.Markdown || stored.Version != note.Version {
		t.Fatalf("failed patch mutated note: %+v", stored)
	}
}
