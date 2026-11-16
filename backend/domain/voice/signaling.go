package voice

import (
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"github.com/livekit/protocol/auth"
)

const admissionAttribute = "spectrum.admission"

// Admission contains only verified claims; never authorize decoded JWT payloads.
type Admission struct {
	Room, Identity, Epoch string
	CanPublish            bool
}

func (c *Client) VerifyAdmission(raw string) (Admission, error) {
	v, err := auth.ParseAPIToken(raw)
	if err != nil || v.APIKey() != c.config.Key {
		return Admission{}, ErrUnavailable
	}
	claims, err := v.Verify(c.config.Secret)
	if err != nil || claims.Video == nil {
		return Admission{}, ErrUnavailable
	}
	g := claims.Video
	if !strings.HasPrefix(g.Room, Namespace) || claims.Identity == "" || !g.RoomJoin || g.RoomAdmin || g.RoomCreate || g.RoomList || g.RoomRecord || g.GetCanPublishData() || g.GetCanUpdateOwnMetadata() || !g.GetCanSubscribe() {
		return Admission{}, ErrUnavailable
	}
	if g.GetCanPublish() && (len(g.CanPublishSources) != 1 || g.CanPublishSources[0] != microphoneSource) {
		return Admission{}, ErrUnavailable
	}
	epoch := claims.Attributes[admissionAttribute]
	if epoch == "" {
		return Admission{}, ErrUnavailable
	}
	return Admission{Room: g.Room, Identity: claims.Identity, Epoch: epoch, CanPublish: g.GetCanPublish()}, nil
}

// ProxySignal releases the membership barrier only after LiveKit has answered.
// LiveKit 1.13.11 starts/resumes its participant before upgrading to HTTP 101,
// so a concurrent role change cannot run between admission and SFU registration.
// Never hold that barrier for the lifetime of the upgraded WebSocket.
func (c *Client) ProxySignal(w http.ResponseWriter, r *http.Request, release func()) {
	defer release()
	if r.URL.Path != "/rtc" && r.URL.Path != "/rtc/v1" && r.URL.Path != "/rtc/validate" {
		http.NotFound(w, r)
		return
	}
	target, _ := url.Parse(c.config.InternalURL)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = 8 * time.Second
	defer transport.CloseIdleConnections()
	proxy := &httputil.ReverseProxy{
		Rewrite:   func(p *httputil.ProxyRequest) { p.SetURL(target); p.SetXForwarded() },
		Transport: transport,
		ModifyResponse: func(response *http.Response) error {
			release()
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			release()
			// Never log request URLs: the SDK carries bearer tokens in the query.
			if !errors.Is(err, r.Context().Err()) {
				http.Error(w, "voice unavailable", http.StatusBadGateway)
			}
		},
	}
	// Do not forward caller-controlled admin endpoints or alternate host paths.
	r = r.Clone(r.Context())
	r.Header = r.Header.Clone()
	r.Header.Del("Forwarded")
	for key := range r.Header {
		if strings.HasPrefix(strings.ToLower(key), "x-forwarded-") {
			r.Header.Del(key)
		}
	}
	proxy.ServeHTTP(w, r)
}
