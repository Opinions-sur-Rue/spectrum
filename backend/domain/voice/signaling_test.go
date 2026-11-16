package voice

import (
	"testing"
	"time"

	"github.com/go-jose/go-jose/v3"
	"github.com/go-jose/go-jose/v3/jwt"
	"github.com/livekit/protocol/auth"
)

const fixtureAdmissionEpoch = "epoch"
const fixtureCameraSource = "camera"
const fixtureExpiredToken = "expired"

func TestVerifyAdmissionRequiresSignedBoundedAudioGrantAndEpoch(t *testing.T) {
	c := testClient(t, "http://localhost:7880")
	raw, err := c.JoinToken(Namespace+"room", "m_member", true, fixtureAdmissionEpoch)
	if err != nil {
		t.Fatal(err)
	}
	a, err := c.VerifyAdmission(raw)
	if err != nil || a.Room != Namespace+"room" || a.Identity != "m_member" || a.Epoch != fixtureAdmissionEpoch || !a.CanPublish {
		t.Fatal("valid admission refused", err)
	}
	withoutEpoch, _ := c.JoinToken(Namespace+"room", "m_member", true)
	if _, err := c.VerifyAdmission(withoutEpoch); err == nil {
		t.Fatal("unfenced token accepted")
	}
	for _, kind := range []string{fixtureExpiredToken, "wrong-key", "forged", "admin", fixtureCameraSource, "data"} {
		t.Run(kind, func(t *testing.T) {
			grant := &auth.VideoGrant{RoomJoin: true, Room: Namespace + "room", CanPublishSources: []string{microphoneSource}}
			grant.SetCanSubscribe(true)
			grant.SetCanPublish(true)
			grant.SetCanPublishData(false)
			grant.SetCanUpdateOwnMetadata(false)
			key, secret, ttl := "test-key", testSecret, time.Minute
			switch kind {
			case fixtureExpiredToken:
				ttl = -5 * time.Minute
			case "wrong-key":
				key = "another-key"
			case "forged":
				secret = "another-untrusted-signing-secret"
			case "admin":
				grant.RoomAdmin = true
			case fixtureCameraSource:
				grant.CanPublishSources = []string{fixtureCameraSource}
			case "data":
				grant.SetCanPublishData(true)
			}
			token, _ := auth.NewAccessToken(key, secret).SetIdentity("m_member").SetAttributes(map[string]string{admissionAttribute: fixtureAdmissionEpoch}).SetVideoGrant(grant).SetValidFor(ttl).ToJWT()
			if kind == fixtureExpiredToken {
				signer, _ := jose.NewSigner(jose.SigningKey{Algorithm: jose.HS256, Key: []byte(secret)}, nil)
				token, _ = jwt.Signed(signer).Claims(jwt.Claims{Issuer: key, Subject: "m_member", Expiry: jwt.NewNumericDate(time.Now().Add(-5 * time.Minute))}).Claims(map[string]any{"video": grant, "attributes": map[string]string{admissionAttribute: fixtureAdmissionEpoch}}).CompactSerialize()
			}
			if _, err := c.VerifyAdmission(token); err == nil {
				t.Fatal("unsafe admission accepted")
			}
		})
	}
}
