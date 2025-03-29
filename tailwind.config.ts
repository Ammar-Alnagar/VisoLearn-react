import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  darkMode: 'media', // Or 'class' if you want manual toggle
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Inter"', // Ensure Inter is primary sans-serif
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
      },
      // Add custom animations or colors if needed for ChatGPT look
      keyframes: {
         pulse: {
           '0%, 100%': { opacity: '1' },
           '50%': { opacity: '.5' },
         }
      },
      animation: {
         pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      }
    },
  },
  plugins: [
      require('@tailwindcss/forms'), // Optional: improves form styling consistency
  ],
} satisfies Config;
