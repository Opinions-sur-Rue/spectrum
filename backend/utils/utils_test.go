package utils

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

const (
	testReply = "reply"
	testPlain = "plain"
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
			reply:    testReply,
			plain:    testPlain,
			expected: "\"reply\"",
		},
		"yaml": {
			acceptHeader: []string{
				"application/yaml",
			},
			reply:    testReply,
			plain:    testPlain,
			expected: "reply\n",
		},
		"xml": {
			acceptHeader: []string{
				"application/xml",
			},
			reply:    testReply,
			plain:    testPlain,
			expected: "<string>reply</string>",
		},
		"plain": {
			acceptHeader: []string{},
			reply:        testReply,
			plain:        testPlain,
			expected:     testPlain,
		},
	}

	for name, tc := range tt {
		t.Run(name, func(t *testing.T) {
			result, err := computeOutput(tc.acceptHeader, tc.reply, tc.plain)
			assert.NoError(t, err)
			assert.Equal(t, tc.expected, result)
		})
	}
}
