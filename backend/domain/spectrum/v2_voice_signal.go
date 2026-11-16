package spectrum

import (
	"net/http"
	"strings"
	"sync"

	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
)

// VoiceSignal is the only public SFU signalling entry point. LiveKit's native
// port must remain private; nginx must route signalling here, not directly to it.
func (h *Hub) VoiceSignal(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/spectrum/voice")
	if r.Method != http.MethodGet || (path != "/rtc" && path != "/rtc/v1" && path != "/rtc/validate") {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if !h.voiceEnabled || h.voiceBackend == nil || h.voiceError != nil {
		http.Error(w, "voice unavailable", http.StatusServiceUnavailable)
		return
	}
	queryTokens := r.URL.Query()["access_token"]
	if len(queryTokens) > 1 {
		http.Error(w, "voice forbidden", http.StatusForbidden)
		return
	}
	raw := r.URL.Query().Get("access_token")
	if header := r.Header.Get("Authorization"); header != "" {
		if !strings.HasPrefix(header, "Bearer ") {
			http.Error(w, "voice forbidden", http.StatusForbidden)
			return
		}
		token := strings.TrimPrefix(header, "Bearer ")
		if raw != "" && raw != token {
			http.Error(w, "voice forbidden", http.StatusForbidden)
			return
		}
		raw = token
	}
	if len(raw) == 0 || len(raw) > 16384 {
		http.Error(w, "voice forbidden", http.StatusForbidden)
		return
	}
	admission, err := h.voiceBackend.VerifyAdmission(raw)
	if err != nil {
		http.Error(w, "voice forbidden", http.StatusForbidden)
		return
	}
	h.voiceMu.Lock()
	var once sync.Once
	release := func() { once.Do(h.voiceMu.Unlock) }
	defer release()
	h.mu.RLock()
	allowed := h.voiceAdmissionAllowed(admission)
	h.mu.RUnlock()
	if !allowed {
		http.Error(w, "voice forbidden", http.StatusForbidden)
		return
	}
	r = r.Clone(r.Context())
	r.URL.Path = path
	r.URL.RawPath = ""
	h.voiceBackend.ProxySignal(w, r, release)
}

// Caller holds h.mu and voiceMu. Epochs fence stale signed and SFU-refreshed
// tokens across demotion, kick, leave, expiration, and later readmission.
func (h *Hub) voiceAdmissionAllowed(a voicedomain.Admission) bool {
	for _, room := range h.rooms {
		if room.voiceRoomID != a.Room || room.IsClosed() {
			continue
		}
		if a.Epoch == "" || room.voiceAdmissions[a.Identity] != a.Epoch {
			return false
		}
		userID, present := room.userIDForMember(a.Identity)
		role, member := room.RoleOf(userID)
		if !present || !member {
			return false
		}
		return !a.CanPublish || room.voicePublishAllowed(a.Identity, role.CanPublishVoice(), false, h.serverTranscriptionConfigured())
	}
	return false
}
