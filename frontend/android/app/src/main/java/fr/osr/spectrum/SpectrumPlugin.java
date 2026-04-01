package fr.osr.spectrum;

import android.content.Intent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin exposing native Android controls to the Spectrum web app.
 * Currently handles the audio foreground service lifecycle.
 *
 * Usage in JS/TS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const SpectrumPlugin = registerPlugin('SpectrumPlugin');
 *   await SpectrumPlugin.startAudioService();
 *   await SpectrumPlugin.stopAudioService();
 */
@CapacitorPlugin(name = "SpectrumPlugin")
public class SpectrumPlugin extends Plugin {

    @PluginMethod
    public void startAudioService(PluginCall call) {
        Intent intent = new Intent(getContext(), AudioForegroundService.class);
        intent.setAction(AudioForegroundService.ACTION_START);
        getContext().startForegroundService(intent);
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
