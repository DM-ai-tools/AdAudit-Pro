/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07090F',
        navy: '#0D1220',
        panel: '#141C2E',
        orange: {
          DEFAULT: '#FF6B2B',
          2: '#F8A51B',
        },
        teal: '#00C9A7',
        cyan: '#22B8D1',
        border: '#1E2D48',
        body: '#C0CCDB',
        muted: '#6B7D96',
      },
      fontFamily: {
        sans: ['Roboto', 'Open Sans', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-orange': 'linear-gradient(135deg, #FF6B2B, #F8A51B)',
      },
      boxShadow: {
        'glow-orange': '0 0 30px rgba(255, 107, 43, 0.15)',
        'glow-teal': '0 0 20px rgba(0, 201, 167, 0.1)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 1.5s infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
  plugins: [],
};
