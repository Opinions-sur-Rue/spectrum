package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func Test_computeOutput(t *testing.T) {
	tt := map[string]struct {
		acceptHeader []string
		reply        interface{}
		plain        string
		expected     string
	}{
		"json": {
			acceptHeader: []string{
				"application/json",
			},
			reply:    "reply",
			plain:    "plain",
			expected: "\"reply\"",
		},
		"yaml": {
			acceptHeader: []string{
				"application/yaml",
			},
			reply:    "reply",
			plain:    "plain",
			expected: "reply\n",
		},
		"xml": {
			acceptHeader: []string{
				"application/xml",
			},
			reply:    "reply",
			plain:    "plain",
			expected: "<string>reply</string>",
		},
		"plain": {
			acceptHeader: []string{},
			reply:        "reply",
			plain:        "plain",
			expected:     "plain",
		},
	}

	for name, tc := range tt {
		t.Run(name, func(t *testing.T) {
			result := computeOutput(tc.acceptHeader, tc.reply, tc.plain)
			assert.Equal(t, tc.expected, result)
		})
	}
}
