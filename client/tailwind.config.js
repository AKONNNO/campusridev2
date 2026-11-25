/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // KNUST gold + slate-night palette, tuned for high contrast / outdoors.
        brand: {
          50: '#fdf9ec',
          100: '#f9efc7',
          200: '#f2df8f',
          300: '#e9cd57',
          400: '#dfba2e',
          500: '#C9A227',
          600: '#a8861b',
          700: '#856916',
          800: '#6e5716',
          900: '#5c4917',
        },
        night: {
          DEFAULT: '#0f172a',
          700: '#16203a',
          800: '#1e293b',
          900: '#101725',
        },
      },
      minHeight: {
        'screen-safe': '100dvh',
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.12), 0 1px 2px -1px rgb(0 0 0 / 0.12)',
      },
    },
  },
  plugins: [],
};
