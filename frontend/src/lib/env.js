export const DEBUG = import.meta.env.DEBUG ?? true;

export const PUBLIC_VERSION = import.meta.env.VITE_VERSION ?? 'N.A';

// URLs
export const API_URL = import.meta.env.VITE_API_URL ?? 'https://api.spectrum.opinions-sur-rue.fr';
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL ?? 'https://spectrum.opinions-sur-rue.fr';

// Theme
export const LOGO_URL = import.meta.env.VITE_LOGO_URL;
export const LOGO_WIDTH = import.meta.env.VITE_LOGO_WIDTH ?? 128;
export const HEADER_TITLE = import.meta.env.VITE_HEADER_TITLE;

// Feature flag
export const ENABLE_AUDIO = import.meta.env.VITE_ENABLE_AUDIO ?? false;
