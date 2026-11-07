package spectrum

import (
	"testing"

	"Opinions-sur-Rue/spectrum/domain/valueobjects"
)

func enableTestTranscription(t *testing.T) {
	t.Helper()
	t.Setenv("SPECTRUM_TRANSCRIPTION_ENABLED", "true")
	t.Setenv("SPECTRUM_TRANSCRIPTION_TOKEN", "test-worker-fixture")
}

func TestTranscriptionDeploymentModeDoesNotImplicitlyFallBack(t *testing.T) {
	hub, _, _, _, _ := voiceFixture(t)
	enableTestTranscription(t)
	for _, mode := range []string{"", transcriptionModeServer, transcriptionModeBrowser, "unsupported"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("SPECTRUM_TRANSCRIPTION_MODE", mode)
			server := mode == "" || mode == transcriptionModeServer
			if hub.serverTranscriptionConfigured() != server {
				t.Fatal("unexpected server-worker availability")
			}
			if browserTranscriptionEnabled() != (mode == transcriptionModeBrowser) {
				t.Fatal("unexpected browser availability")
			}
		})
	}
}

func TestWorkerNeedsConsentAndRejectsRetiredGeneration(t *testing.T) {
	hub, admin, actor, room, _ := voiceFixture(t)
	enableTestTranscription(t)
	room.settings.TranscriptionEnabled = true
	credentials, err := actor.issueVoiceCredentials()
	if err != nil || credentials.CanPublish {
		t.Fatalf("microphone allowed before consent: %+v %v", credentials, err)
	}
	jobs, err := hub.TranscriptionJobs()
	if err != nil || len(jobs) != 1 || len(jobs[0].Speakers) != 0 {
		t.Fatalf("nonconsenting speakers admitted: %+v %v", jobs, err)
	}
	credentials, err = actor.issueVoiceCredentialsWithConsent(true)
	if err != nil || !credentials.CanPublish {
		t.Fatalf("consenting participant refused: %+v %v", credentials, err)
	}
	jobs, err = hub.TranscriptionJobs()
	if err != nil || len(jobs) != 1 || len(jobs[0].Speakers) != 1 || jobs[0].Speakers[0] != room.memberIDs[actor.userID] {
		t.Fatalf("jobs = %+v, err = %v", jobs, err)
	}
	job := jobs[0]
	if job.Language != "fr" {
		t.Fatalf("job language = %q", job.Language)
	}
	if _, err := hub.AppendWorkerTranscript(job.TranscriptAdmission, room.id, job.Speakers[0], "utt", "Bonjour", 0, 1000, "fr", true); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomDemote(admin, stageEnvelope(t, "room.demote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if err := handleRoomPromote(admin, stageEnvelope(t, "room.promote", room.memberIDs[actor.userID])); err != nil {
		t.Fatal(err)
	}
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	if _, err := hub.AppendWorkerTranscript(job.TranscriptAdmission, room.id, job.Speakers[0], "late", "Stale", 0, 1000, "en", true); err != ErrTranscriptSpeaker {
		t.Fatalf("retired output accepted: %v", err)
	}
}

func TestTranscriptionLanguageIsAdminOnlyAndRetiresOldWork(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	enableTestTranscription(t)
	room.settings.TranscriptionEnabled = true
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	jobs, _ := hub.TranscriptionJobs()
	old := jobs[0]
	envelope, _ := valueobjects.NewEnvelope("room.settings", map[string]string{"transcriptionLanguage": "en"})
	if err := handleRoomSettings(actor, envelope); err != ErrForbidden {
		t.Fatal("participant changed transcription language")
	}
	if len(driver.deleted) != 0 {
		t.Fatal("forbidden change retired voice")
	}
	if err := handleRoomSettings(admin, envelope); err != nil {
		t.Fatal(err)
	}
	if room.Settings().TranscriptionLanguage != "en" || room.voiceRoomID != "" || len(room.transcriptionConsents) > 0 {
		t.Fatal("language change did not invalidate old work")
	}
	if _, err := hub.AppendWorkerTranscript(old.TranscriptAdmission, room.id, old.Speakers[0], "late", "Bonjour", 0, 1000, "fr", true); err != ErrTranscriptSpeaker {
		t.Fatal("old-language result entered transcript")
	}
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	jobs, _ = hub.TranscriptionJobs()
	if jobs[0].Language != "en" {
		t.Fatal("new job did not carry English selection")
	}
	if _, err := hub.AppendWorkerTranscript(jobs[0].TranscriptAdmission, room.id, old.Speakers[0], "wrong", "Bonjour", 0, 1000, "fr", true); err != ErrTranscriptContent {
		t.Fatal("worker bypassed pinned language")
	}
	invalid, _ := valueobjects.NewEnvelope("room.settings", map[string]string{"transcriptionLanguage": "translate"})
	if err := handleRoomSettings(admin, invalid); err != ErrTranscriptContent {
		t.Fatal("invalid language accepted")
	}
}

func TestTranscriptionSettingRetiresVoiceAndRequiresNewConsent(t *testing.T) {
	hub, admin, actor, room, driver := voiceFixture(t)
	enableTestTranscription(t)
	room.settings.TranscriptionEnabled = true
	if _, err := actor.issueVoiceCredentialsWithConsent(true); err != nil {
		t.Fatal(err)
	}
	oldRoom := room.voiceRoomID
	envelope, _ := valueobjects.NewEnvelope("room.settings", map[string]bool{"transcriptionEnabled": false})
	if err := handleRoomSettings(admin, envelope); err != nil {
		t.Fatal(err)
	}
	if room.voiceRoomID != "" || len(driver.deleted) != 1 || driver.deleted[0] != oldRoom || len(room.transcriptionConsents) != 0 {
		t.Fatal("toggle did not retire voice and consent")
	}
	if jobs, err := hub.TranscriptionJobs(); err != nil || len(jobs) != 0 {
		t.Fatal("paused room was offered to worker")
	}
	envelope, _ = valueobjects.NewEnvelope("room.settings", map[string]bool{"transcriptionEnabled": true})
	if err := handleRoomSettings(admin, envelope); err != nil {
		t.Fatal(err)
	}
	credentials, err := actor.issueVoiceCredentials()
	if err != nil || credentials.CanPublish {
		t.Fatal("old consent survived setting toggle")
	}
}

func TestSpectatorCannotConsentIntoPublishing(t *testing.T) {
	hub, _, actor, room := stageFixture(t)
	hub.voiceBackend, hub.voiceEnabled = &fakeVoice{}, true
	enableTestTranscription(t)
	room.settings.TranscriptionEnabled = true
	credentials, err := actor.issueVoiceCredentialsWithConsent(true)
	if err != nil || credentials.CanPublish || len(room.transcriptionConsents) != 0 {
		t.Fatal("spectator bypassed stage through consent")
	}
}
