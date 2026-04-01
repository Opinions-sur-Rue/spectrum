package fr.osr.spectrum;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Capacitor plugin exposing native Android controls to the Spectrum web app.
 *
 * Usage in JS/TS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const SpectrumPlugin = registerPlugin('SpectrumPlugin');
 *   await SpectrumPlugin.requestAudioPermission();
 *   await SpectrumPlugin.startAudioService();
 *   await SpectrumPlugin.stopAudioService();
 */
@CapacitorPlugin(
    name = "SpectrumPlugin",
    permissions = {
        @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone"),
        @Permission(strings = { Manifest.permission.MODIFY_AUDIO_SETTINGS }, alias = "audioSettings"),
    }
)
public class SpectrumPlugin extends Plugin {

    private static final String PERM_RECORD_AUDIO = Manifest.permission.RECORD_AUDIO;

    /**
     * Request RECORD_AUDIO permission at runtime.
     * Returns { granted: true } if permission is granted, { granted: false } otherwise.
     */
    @PluginMethod
    public void requestAudioPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), PERM_RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(getContext(), PERM_RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    @PluginMethod
    public void startAudioService(PluginCall call) {
        Intent intent = new Intent(getContext(), AudioForegroundService.class);
        intent.setAction(AudioForegroundService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopAudioService(PluginCall call) {
        Intent intent = new Intent(getContext(), AudioForegroundService.class);
        intent.setAction(AudioForegroundService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }
}
