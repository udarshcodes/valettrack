/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#06090D', // near black background
          900: '#0B1017', // elevated card dark
          850: '#101721', // card borders & interactive surfaces
          800: '#16202C', // secondary cards
          700: '#233245', // borders & dividers
        },
        lime: {
          DEFAULT: '#10E599', // electric lime accent
          hover: '#05D688',
          glow: 'rgba(16, 229, 153, 0.15)',
        },
        amber: {
          warm: '#F59E0B',
          glow: 'rgba(245, 158, 11, 0.15)',
        },
        coral: {
          DEFAULT: '#F43F5E',
          glow: 'rgba(244, 63, 94, 0.15)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        'plus-jakarta': ['"Plus Jakarta Sans"', 'sans-serif'],
        'instrument-serif': ['"Instrument Serif"', 'serif'],
      }
    },
  },
  plugins: [],
}
