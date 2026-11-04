package canvas

import (
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/text"
)

// TitleFromMarkdown is a display label, not independently editable content.
// Parse Markdown so headings inside code fences are not mistaken for titles.
func TitleFromMarkdown(markdown string) string {
	source := []byte(markdown)
	root := goldmark.New().Parser().Parse(text.NewReader(source))
	title := "Untitled note"
	_ = ast.Walk(root, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		heading, ok := node.(*ast.Heading)
		if !entering || !ok || heading.Level != 1 {
			return ast.WalkContinue, nil
		}
		label := headingLabel(heading, source)
		if label == "" {
			return ast.WalkContinue, nil
		}
		runes := []rune(label)
		if len(runes) > MaxNoteTitleRunes {
			runes = runes[:MaxNoteTitleRunes]
		}
		title = string(runes)
		return ast.WalkStop, nil
	})
	return title
}

func headingLabel(heading *ast.Heading, source []byte) string {
	var label strings.Builder
	_ = ast.Walk(heading, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch inline := node.(type) {
		case *ast.Text:
			label.Write(inline.Value(source))
		case *ast.String:
			label.Write(inline.Value)
		case *ast.AutoLink:
			label.Write(inline.Label(source))
		}
		return ast.WalkContinue, nil
	})
	return strings.TrimSpace(label.String())
}
