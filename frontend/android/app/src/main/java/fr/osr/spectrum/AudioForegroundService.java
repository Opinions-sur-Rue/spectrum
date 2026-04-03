package fr.osr.spectrum;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Foreground service that keeps the app alive in background while voice chat is active.
 * Required on Android to maintain microphone access and prevent the OS from killing
 * the WebView/WebSocket/PeerJS audio session.
 *
 * Also requests audio focus (AUDIOFOCUS_GAIN) so other apps playing audio (e.g. YouTube PiP)
 * are paused while the user is speaking, preventing confusion from conflicting audio streams.
 *
 * Started via the SpectrumPlugin Capacitor plugin when the user activates the microphone.
 * Stopped when the user deactivates the microphone or leaves the room.
 */
public class AudioForegroundService extends Service {

    public static final String ACTION_START = "fr.osr.spectrum.ACTION_START_AUDIO";
    public static final String ACTION_STOP  = "fr.osr.spectrum.ACTION_STOP_AUDIO";

    private static final String CHANNEL_ID     = "spectrum_audio_channel";
    private static final int    NOTIFICATION_ID = 1001;

    private AudioManager      audioManager;
    private AudioFocusRequest audioFocusRequest;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();
        if (ACTION_STOP.equals(action)) {
            abandonAudioFocus();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Default: ACTION_START
        requestAudioFocus();
        startForeground(NOTIFICATION_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        abandonAudioFocus();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build())
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(focusChange -> {
                    // Focus lost: another app took audio (e.g. incoming call)
                    // We don't stop the service — the user can resume when ready
                })
                .build();
            audioManager.requestAudioFocus(audioFocusRequest);
        } else {
            // Pre-Oreo fallback
            //noinspection deprecation
            audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN
            );
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(audioFocusRequest);
            audioFocusRequest = null;
        } else {
            //noinspection deprecation
            audioManager.abandonAudioFocus(null);
        }
    }

    private Notification buildNotification() {
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.voice_chat_active))
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Spectrum Voice Chat",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Keeps voice chat active in background");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }
}
