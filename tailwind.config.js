/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070C16',
          900: '#0B1220',
          800: '#111A2B',
          700: '#1B2639',
          600: '#27344A',
          500: '#3A4A63',
        },
        brand: {
          50: '#ECFAFF',
          100: '#D2F2FF',
          300: '#7DD8F7',
          400: '#38BDF8',
          500: '#0EA5E9',
          600: '#0284C7',
          700: '#0369A1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(8, 15, 30, .06), 0 8px 24px -12px rgba(8, 15, 30, .18)',
      },
    },
  },
  plugins: [],
}
