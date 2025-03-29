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
      // Add custom animations or colors for ChatGPT look
      colors: {
        'chatgpt-gray': '#f0f0f0', // Light gray background for ChatGPT messages
        'chatgpt-text': '#343541', // Dark text color for ChatGPT messages
        'user-blue': '#007bff',     // Example blue for user messages
      },
      keyframes: {
        typing: {
          "0%": {
            width: "0%",
            visibility: "hidden"
          },
          "100%": {
            width: "100%"
          }
        },
        blink: {
          "50%": {
            borderColor: "transparent"
          },
          "100%": {
            borderColor: "white"
          }
        }
      },
      animation: {
        typing: "typing 2s steps(20) infinite alternate, blink .7s infinite"
      }
    },
  },
  plugins: [
      require('@tailwindcss/forms'), // Optional: improves form styling consistency
  ],
} satisfies Config;
