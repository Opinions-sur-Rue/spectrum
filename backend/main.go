package main

import (
	"encoding/xml"
	"net/http"
	"os"

	"Opinions-sur-Rue/spectrum/api"
	_ "Opinions-sur-Rue/spectrum/docs"
	"Opinions-sur-Rue/spectrum/utils"

	"github.com/gorilla/mux"
	log "github.com/sirupsen/logrus"
	httpSwagger "github.com/swaggo/http-swagger/v2"
)

func EmptyResponse(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

//	@Summary		Healthcheck
//	@Description	Get the status of the API
//	@Tags			health
//	@Produce		json,xml,application/yaml,plain
//	@Success		200	{object}	Health
//	@Router			/status [get]
func HealthCheck(w http.ResponseWriter, r *http.Request) {
	var health Health
	health.Status = "up"

	version, present := os.LookupEnv("API_VERSION")
	if present {
		health.Version = version
	}

	utils.Output(w, r.Header["Accept"], health, health.Status)
}

type Health struct {
	XMLName xml.Name `json:"-" xml:"health" yaml:"-"`
	Version string   `json:"version,omitempty" xml:"version,omitempty" yaml:"version,omitempty"`
	Status  string   `json:"status" xml:"status" yaml:"status"`
}

func initLogging() {
	log.SetLevel(log.DebugLevel)
	//log.SetFormatter(&log.JSONFormatter{})
}

//	@title			OSR Spectrum API
//	@version		1.0
//	@description	The backend powering "Opinions Sur Rue" online spectrum platform.
//
//	@contact.name	API Support
//	@contact.email	api@utile.space
//
//	@license.name	utile.space API License
//	@license.url	https://utile.space/api/
//
//	@BasePath		/api
func main() {
	initLogging()

	apiRouter := mux.NewRouter()

	apiRouter.Use(utils.EnableCors)

	apiRouter.HandleFunc("/", EmptyResponse).Methods(http.MethodGet)

	apiRouter.HandleFunc("/spectrum/ws", api.SpectrumWebsocket).Methods(http.MethodGet)

	apiRouter.HandleFunc("/status", HealthCheck).Methods(http.MethodGet)

	apiRouter.PathPrefix("/docs/").Handler(httpSwagger.Handler(
		httpSwagger.DeepLinking(true),
		httpSwagger.DocExpansion("none"),
		httpSwagger.DomID("swagger-ui"),
	)).Methods(http.MethodGet)

	port, present := os.LookupEnv("API_PORT")
	if !present {
		port = "3000"
	}

	log.Info("Starting server on port ", port)
	log.Fatal(http.ListenAndServe(":"+port, apiRouter))
}
