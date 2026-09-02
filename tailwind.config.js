/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tokens do tema — definidos em src/index.css, um valor por tema.
        app: 'rgb(var(--app) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        elevated: 'rgb(var(--elevated) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',
        field: 'rgb(var(--field) / <alpha-value>)',
        hover: 'rgb(var(--hover) / <alpha-value>)',
        content: {
          DEFAULT: 'rgb(var(--text) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          soft: 'rgb(var(--text-soft) / <alpha-value>)',
          faint: 'rgb(var(--text-faint) / <alpha-value>)',
        },
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',

        // Laranja da Ápice (ação) e azul do logo (apoio).
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          text: 'rgb(var(--brand-text) / <alpha-value>)',
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
        accent: {
          50: '#EEEFFA',
          100: '#DADCF4',
          300: '#8E92DC',
          500: '#2E31B0',
          600: '#252893',
          700: '#1C1E75',
        },
        ink: {
          950: '#0A0A0F',
          900: '#14141C',
          800: '#1F1F2B',
          700: '#2C2C3B',
          600: '#3C3C4E',
          500: '#54546A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / .05), 0 8px 24px -12px rgb(0 0 0 / .18)',
      },
    },
  },
  plugins: [],
}
