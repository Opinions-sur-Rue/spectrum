package main

import (
	"context"
	"encoding/xml"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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

// @Summary		Healthcheck
// @Description	Get the status of the API
// @Tags			health
// @Produce		json,xml,application/yaml,plain
// @Success		200	{object}	Health
// @Router			/status [get]
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
	level, err := log.ParseLevel(os.Getenv("LOG_LEVEL"))
	if err != nil {
		level = log.InfoLevel // safe default for production
	}
	log.SetLevel(level)
	log.SetFormatter(&log.JSONFormatter{})
}

// @title			OSR Spectrum API
// @version		1.0
// @description	The backend powering "Opinions Sur Rue" online spectrum platform.
//
// @contact.name	API Support
// @contact.email	api@utile.space
//
// @license.name	utile.space API License
// @license.url	https://utile.space/api/
//
// @BasePath		/api
func main() {
	initLogging()

	// Context cancelled on SIGTERM or SIGINT — propagated to Hub goroutines.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Initialize Hub with the cancellable context so its goroutines stop on shutdown.
	api.InitHub(ctx)

	apiRouter := mux.NewRouter()

	apiRouter.Use(utils.EnableCors)

	apiRouter.HandleFunc("/", EmptyResponse).Methods(http.MethodGet)

	apiRouter.HandleFunc("/status", HealthCheck).Methods(http.MethodGet)
	apiRouter.HandleFunc("/spectrum/ws", api.SpectrumWebsocket).Methods(http.MethodGet)

	apiRouter.PathPrefix("/docs/").Handler(httpSwagger.Handler(
		httpSwagger.DeepLinking(true),
		httpSwagger.DocExpansion("none"),
		httpSwagger.DomID("swagger-ui"),
	)).Methods(http.MethodGet)

	port, present := os.LookupEnv("API_PORT")
	if !present {
		port = "3000"
	}

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: apiRouter,
	}

	// Start server in background.
	go func() {
		log.Info("Starting server on port ", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.WithError(err).Fatal("Server error")
		}
	}()

	// Block until signal received.
	<-ctx.Done()
	stop()
	log.Info("Shutdown signal received, draining connections...")

	// Give active connections up to 10s to finish.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.WithError(err).Error("Graceful shutdown failed, forcing close")
	} else {
		log.Info("Server stopped cleanly")
	}
}
