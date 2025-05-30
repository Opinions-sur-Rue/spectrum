/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: '#fe2c55',
        secondary: '#25f4ee',
        darkBg: '#121212',
        lightBg: '#ffffff',
        darkText: '#121212',
        lightText: '#f5f5f5',
      },
    },
  },
  plugins: [],
} 