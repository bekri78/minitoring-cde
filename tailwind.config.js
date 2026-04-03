module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#080c10',
        panel: '#0a0f16',
        border: '#1a2a3a',
        accent: '#00d4ff',
        'text-base': '#c8d8e8',
        'text-dim': '#4a6a7a',
        green: '#00ff88',
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', 'monospace'],
        ui: ['Rajdhani', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
