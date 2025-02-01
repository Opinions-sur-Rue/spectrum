package spectrum

import (
	"bytes"
	"time"

	"github.com/gorilla/websocket"
	log "github.com/sirupsen/logrus"
)

type Client struct {
	// auto-increment
	id int

	// The websocket connection.
	conn *websocket.Conn

	// Buffered channel of outbound messages.
	send chan []byte

	//
	userID string

	hub *Hub
}

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 512
)

var (
	newline = []byte{'\n'}
	space   = []byte{' '}
)

var lastClientId = 0

func NewClient(hub *Hub, conn *websocket.Conn) *Client {
	lastClientId = lastClientId + 1
	return &Client{
		conn: conn,
		send: make(chan []byte, 256),
		id:   lastClientId,
		hub:  hub,
	}
}

func (c *Client) Send(content []byte) {
	c.send <- content
}

func (c *Client) UserID() string {
	return c.userID
}

func (c *Client) SetUserID(userID string) {
	c.userID = userID
}

// ReadPump pumps messages from the websocket connection to the hub.
//
// The application runs ReadPump in a per-connection goroutine. The application
// ensures that there is at most one reader on a connection by executing all
// reads from this goroutine.
func (c *Client) ReadPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(maxMessageSize)
	err := c.conn.SetReadDeadline(time.Now().Add(pongWait))
	if err != nil {
		log.Warnf("ReadPump error: %v", err)
	}
	c.conn.SetPongHandler(func(string) error { err := c.conn.SetReadDeadline(time.Now().Add(pongWait)); return err })

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Warnf("ReadPump error: %v", err)
			}
			break
		}
		message = bytes.TrimSpace(bytes.Replace(message, newline, space, -1))

		err = c.EvaluateRPC(string(message))
		if err != nil {
			log.Debugf("ReadPump read error: %v", err)
		}
	}
}

// WritePump pumps messages from the hub to the websocket connection.
//
// A goroutine running WritePump is started for each connection. The
// application ensures that there is at most one writer to a connection by
// executing all writes from this goroutine.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			err := c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err != nil {
				log.Warnf("WritePump error: %v", err)
			}
			if !ok {
				// The hub closed the channel.
				err = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				log.Warnf("WritePump channel closed error: %v", err)
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}

			n, err := w.Write(message)
			if n != len(message) {
				log.Warn("Different length written and expected in the websocket")
			}
			if err != nil {
				log.Warnf("WritePump error: %v", err)
			}

			// Add queued chat messages to the current websocket message.
			n = len(c.send)
			for i := 0; i < n; i++ {
				if _, err = w.Write(newline); err != nil {
					log.Warnf("WritePump error: %v", err)
				}

				if _, err = w.Write(<-c.send); err != nil {
					log.Warnf("WritePump error: %v", err)
				}
			}

			if err := w.Close(); err != nil {
				return
			}
		case <-ticker.C:
			if err := c.conn.SetWriteDeadline(time.Now().Add(writeWait)); err != nil {
				log.Warnf("WritePump error: %v", err)
			}

			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
