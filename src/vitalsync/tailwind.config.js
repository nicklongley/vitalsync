/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── VitalSync Brand Palette ──
        midnight: '#0F172A',
        'slate-deep': '#1E293B',
        emerald: {
          DEFAULT: '#10B981',
          50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7',
          400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857',
          800: '#065F46', 900: '#064E3B', 950: '#022C22',
        },
        cyan: {
          DEFAULT: '#06B6D4',
          400: '#22D3EE', 500: '#06B6D4', 600: '#0891B2', 700: '#0E7490',
        },
        amber: { DEFAULT: '#F59E0B' },
        rose: { DEFAULT: '#F43F5E' },
        violet: { DEFAULT: '#8B5CF6', 400: '#A78BFA', 500: '#8B5CF6', 600: '#7C3AED' },
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'metric-hero': ['3.5rem', { lineHeight: '1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'metric-lg': ['2rem', { lineHeight: '1', fontWeight: '600' }],
        'metric-md': ['1.25rem', { lineHeight: '1', fontWeight: '600' }],
      },
      backdropBlur: {
        xl: '24px',
      },
      backgroundImage: {
        'gradient-cta': 'linear-gradient(135deg, #10B981 0%, #06B6D4 100%)',
        'gradient-card': 'linear-gradient(180deg, rgba(30,41,59,0.7) 0%, rgba(15,23,42,0.9) 100%)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' }, '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
