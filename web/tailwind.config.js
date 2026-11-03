/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)', // CSS değişkeni olarak tanımlanıyor
        "primary-content": 'var(--color-primary-content)',
        "primary-opacity": 'var(--color-primary-opacity)',
        secondary: 'var(--color-secondary)',
        "secondary-content": 'var(--color-secondary-content)',
        "secondary-opacity": 'var(--color-secondary-opacity)',
      },
      screens: {
        "xl": "1920px",
      },
      animation: {
        opacity: "opacity 0.2s ease-out",
        popup: "popup 0.2s ease-out",
      },
      keyframes: {
        opacity: {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        popup: {
          "0%": { transform: "scale(0.9)", opacity: 0.8 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
      },
    }
  },
  plugins: [
    function ({ addUtilities }) {
      addUtilities({
        '.flex-center': {
          display: 'flex',
          'justify-content': 'center',
          'align-items': 'center',
        },
      }, ['responsive', 'hover']);
    }
  ],
}