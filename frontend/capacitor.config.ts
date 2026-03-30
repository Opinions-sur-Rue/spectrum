import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'fr.osr.spectrum',
  appName: 'Spectrum',
  webDir: 'build',
  server: {
    androidScheme: 'https'
  }
};

export default config;
