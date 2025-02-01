package utils

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"math/rand"
	"net/http"
	"slices"

	"gopkg.in/yaml.v2"
)

func EnableCors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")

		next.ServeHTTP(w, r)
	})
}

func Output(w http.ResponseWriter, accept []string, v interface{}, plain string) {
	fmt.Fprint(w, computeOutput(accept, v, plain))
}

func computeOutput(accept []string, v interface{}, plain string) string {
	if slices.Contains(accept, "application/json") {
		reply, _ := json.Marshal(v)
		return string(reply)
	} else if slices.Contains(accept, "application/xml") {
		reply, _ := xml.Marshal(v)
		return string(reply)
	} else if slices.Contains(accept, "application/yaml") {
		reply, _ := yaml.Marshal(v)
		return string(reply)
	} else {
		return plain
	}
}

// from ChatGPT
func GenerateRandomString(length int) string {
	// Allowed characters
	allowedChars := "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"

	randString := make([]byte, length)

	for i := 0; i < length; i++ {
		// Choose a random character from the allowedChars
		randString[i] = allowedChars[rand.Intn(len(allowedChars))]
	}

	return "OSR-" + string(randString)
}
