/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0A0A0F',
          900: '#14141C',
          800: '#1F1F2B',
          700: '#2C2C3B',
          600: '#3C3C4E',
          500: '#54546A',
        },
        // Laranja da Ápice
        brand: {
          50: '#FDF3EF',
          100: '#FAE2D8',
          200: '#F5C4B0',
          300: '#EE9D7E',
          400: '#E6714A',
          500: '#DE4C22',
          600: '#C43C16',
          700: '#9F2F11',
          800: '#7B250D',
          900: '#5D1C0A',
        },
        // Azul da seta do logo
        accent: {
          50: '#EEEFFA',
          100: '#DADCF4',
          300: '#8E92DC',
          500: '#2B2FA0',
          600: '#232687',
          700: '#1B1D6B',
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
