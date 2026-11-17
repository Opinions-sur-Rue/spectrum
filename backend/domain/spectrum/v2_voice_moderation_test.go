package spectrum

import (
	"errors"
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
	voicedomain "Opinions-sur-Rue/spectrum/domain/voice"
)

func resumeEnvelope(t *testing.T, consent bool) *valueobjects.Envelope {
	t.Helper()
	envelope, err := valueobjects.NewEnvelope("voice.resume", map[string]any{fieldRequestID: "self-resume", "transcriptionConsent": consent})
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func TestAdminMuteTargetsOnePublisherAndFencesCachedTokens(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	physical, generation, oldEpoch := room.voiceRoomID, room.voiceGeneration, room.voiceAdmissions[id]
	if _, err := admin.issueVoiceCredentials(); err != nil {
		t.Fatal(err)
	}
	adminEpoch := room.voiceAdmissions[room.memberIDs[admin.userID]]
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	if !room.voiceMuted[id] || driver.permissions[physical+":"+id] || len(driver.permissions) != 1 {
		t.Fatal("target publication was not exclusively revoked")
	}
	if role, _ := room.RoleOf(actor.userID); role != RoleParticipant {
		t.Fatal("mute changed stage membership")
	}
	if room.voiceRoomID != physical || room.voiceGeneration != generation || len(driver.deleted) != 0 || len(driver.removed) != 0 {
		t.Fatal("mute disturbed other audio participants")
	}
	if room.voiceAdmissions[room.memberIDs[admin.userID]] != adminEpoch {
		t.Fatal("mute revoked another participant")
	}
	if hub.voiceAdmissionAllowed(voicedomain.Admission{Room: physical, Identity: id, Epoch: oldEpoch, CanPublish: true}) {
		t.Fatal("cached publisher token survived mute")
	}
	credentials, err := actor.issueVoiceCredentialsWithConsent(true)
	if err != nil || credentials.CanPublish {
		t.Fatal("ordinary join bypassed moderation mute", err)
	}
	if room.voiceAdmissions[id] == oldEpoch {
		t.Fatal("old publishing epoch resurrected")
	}
	if err := handleVoiceResume(actor, resumeEnvelope(t, false)); err != nil {
		t.Fatal(err)
	}
	if room.voiceMuted[id] || !driver.permissions[physical+":"+id] {
		t.Fatal("explicit self-resume did not restore permission")
	}
	if hub.voiceAdmissionAllowed(voicedomain.Admission{Room: physical, Identity: id, Epoch: oldEpoch, CanPublish: true}) {
		t.Fatal("self-resume resurrected pre-mute token")
	}
}

func TestMuteRejectsUntrustedSelectorsAndNonAdmins(t *testing.T) {
	// Case labels describe the selector being attacked rather than reusing role
	// values, so a future role rename cannot silently change what is covered.
	for _, kind := range []string{"private-signin", "outside", "bench-member", "stage-peer", "co-admin"} {
		t.Run(kind, func(t *testing.T) {
			hub, admin, actor, room, driver := voiceFixture(t)
			caller, target := admin, room.memberIDs[actor.userID]
			switch kind {
			case "private-signin":
				target = actor.userID
			case "outside":
				target = fixtureOutsideMemberID
			case "co-admin":
				target = room.memberIDs[admin.userID]
			case "bench-member":
				hub.users[fixtureBenchID] = NewUser(fixtureBenchID)
				if err := hub.JoinSpectator(room.id, fixtureBenchID); err != nil {
					t.Fatal(err)
				}
				target = room.memberIDs[fixtureBenchID]
			case "stage-peer":
				caller, target = actor, room.memberIDs[admin.userID]
			}
			if err := handleVoiceMute(caller, stageEnvelope(t, "voice.mute", target)); !errors.Is(err, ErrForbidden) {
				t.Fatal("untrusted mute accepted", err)
			}
			if len(room.voiceMuted) != 0 || len(driver.permissions) != 0 {
				t.Fatal("rejected mute mutated state")
			}
		})
	}
}

func TestAdminCannotResumeAnotherMembersMicrophone(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	forged, _ := valueobjects.NewEnvelope("voice.resume", map[string]string{fieldRequestID: "forged", "memberId": id})
	if err := handleVoiceResume(admin, forged); !errors.Is(err, ErrForbidden) {
		t.Fatal("admin resumed another member", err)
	}
	if !room.voiceMuted[id] || driver.permissions[room.voiceRoomID+":"+id] {
		t.Fatal("forged resume unmuted target")
	}
}

func TestMuteSFUFailureDoesNotClaimSuccess(t *testing.T) {
	_, admin, actor, room, driver := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	epoch := room.voiceAdmissions[id]
	driver.permissionErr = errors.New("SFU unavailable")
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err == nil {
		t.Fatal("failed SFU operation accepted")
	}
	if room.voiceMuted[id] || room.voiceAdmissions[id] != epoch {
		t.Fatal("failed mute committed moderation state")
	}
}

func TestSelfResumeRequiresCurrentConsentAndNeverRestoresAcrossDemotion(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	t.Setenv("SPECTRUM_TRANSCRIPTION_ENABLED", "true")
	t.Setenv("SPECTRUM_TRANSCRIPTION_MODE", "server")
	t.Setenv("SPECTRUM_TRANSCRIPTION_TOKEN", "test-only-transcription-token")
	room.settings.TranscriptionEnabled = true
	id := room.memberIDs[actor.userID]
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	if _, accepted := room.transcriptionConsents[id]; accepted {
		t.Fatal("normal join saved consent through moderation mute")
	}
	if err := handleVoiceResume(actor, resumeEnvelope(t, false)); !errors.Is(err, ErrForbidden) {
		t.Fatal("self-resume bypassed consent", err)
	}
	if err := handleVoiceResume(actor, resumeEnvelope(t, true)); err != nil {
		t.Fatal(err)
	}
	if room.voiceMuted[id] || !driver.permissions[room.voiceRoomID+":"+id] || !room.voicePublishAllowed(id, true, false, hub.serverTranscriptionConfigured()) {
		t.Fatal("explicit consent did not grant self-resume")
	}
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", id)); err != nil {
		t.Fatal(err)
	}
	if err := handleVoiceResume(actor, resumeEnvelope(t, true)); !errors.Is(err, ErrForbidden) {
		t.Fatal("spectator restored publishing", err)
	}
}

func TestPolicyChangeDoesNotUndoModerationMute(t *testing.T) {
	_, admin, actor, room, _ := voiceFixture(t)
	id := room.memberIDs[actor.userID]
	if err := handleVoiceMute(admin, stageEnvelope(t, "voice.mute", id)); err != nil {
		t.Fatal(err)
	}
	change, _ := valueobjects.NewEnvelope("room.settings", map[string]string{fieldTranscriptionLang: "en"})
	if err := handleRoomSettings(admin, change); err != nil {
		t.Fatal(err)
	}
	credentials, err := actor.issueVoiceCredentialsWithConsent(true)
	if err != nil || credentials.CanPublish || !room.voiceMuted[id] {
		t.Fatal("policy retirement undid moderation mute", err)
	}
}
