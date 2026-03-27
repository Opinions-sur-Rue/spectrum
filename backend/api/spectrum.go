package api

import (
	"net/http"
	"sync"

	"Opinions-sur-Rue/spectrum/domain/spectrum"
	"github.com/gorilla/websocket"
	log "github.com/sirupsen/logrus"
)

var (
	spectrumHub *spectrum.Hub
	hubOnce     sync.Once
)

// InitHub initialises the Hub with the provided context and starts its goroutines.
// Must be called once before serving WebSocket connections.
// The context controls the lifetime of Hub.Run and Hub.Routine — cancel it to shut down cleanly.
func InitHub(ctx context.Context) {
	hubOnce.Do(func() {
		spectrumHub = spectrum.NewHub()
		go spectrumHub.Run(ctx)
	})
}

func getSpectrumHub() *spectrum.Hub {
	return spectrumHub
}

var upgraderSpectrum = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// @Summary		SpectrumWebsocket to run spectrum with a party of 2 to 6 players
// @Description	Websocket to open to run spectrums
// @Tags			spectrum
// @Success		101
// @Router			/spectrum/ws [get]
func SpectrumWebsocket(w http.ResponseWriter, r *http.Request) {
	c, err := upgraderSpectrum.Upgrade(w, r, nil)
	if err != nil {
		log.Error("upgrade:", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer c.Close()

	hub := getSpectrumHub()
	client := spectrum.NewClient(hub, c)
	hub.Register <- client

	var wg sync.WaitGroup

	wg.Add(2)

	go func() {
		client.WritePump()
		wg.Done()
	}()

	go func() {
		client.ReadPump()
		wg.Done()
	}()

	wg.Wait()
}
