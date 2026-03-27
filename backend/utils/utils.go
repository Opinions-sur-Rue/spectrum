package utils

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"math/rand"
	"net/http"
	"slices"

	log "github.com/sirupsen/logrus"
	"gopkg.in/yaml.v2"
)

func EnableCors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")

		next.ServeHTTP(w, r)
	})
}

func Output(w http.ResponseWriter, accept []string, v interface{}, plain string) {
	output, err := computeOutput(accept, v, plain)
	if err != nil {
		log.WithError(err).Error("Failed to marshal response")
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	fmt.Fprint(w, output)
}

func computeOutput(accept []string, v interface{}, plain string) (string, error) {
	if slices.Contains(accept, "application/json") {
		reply, err := json.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(reply), nil
	} else if slices.Contains(accept, "application/xml") {
		reply, err := xml.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(reply), nil
	} else if slices.Contains(accept, "application/yaml") {
		reply, err := yaml.Marshal(v)
		if err != nil {
			return "", err
		}
		return string(reply), nil
	}
	return plain, nil
}

func GenerateRandomString(length int) string {
	allowedChars := "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"

	randString := make([]byte, length)

	for i := 0; i < length; i++ {
		randString[i] = allowedChars[rand.Intn(len(allowedChars))]
	}

	return "OSR-" + string(randString)
}
