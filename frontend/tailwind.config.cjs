/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Sora', 'Trebuchet MS', 'Segoe UI', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif']
      }
    }
  },
  plugins: []
};
