import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    borderRadius: {
      none: '0px',
      sm: 'var(--radius-sm)',
      DEFAULT: 'var(--radius-md)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
      xl: 'var(--radius-xl)',
      '2xl': 'var(--radius-xl)',
      '3xl': 'var(--radius-xl)',
      full: '9999px',
    },
    boxShadow: {
      sm: '0 0 #0000',
      DEFAULT: '0 0 #0000',
      md: '0 0 #0000',
      lg: '0 0 #0000',
      // xl / 2xl carry overlay elevation (floating surfaces); inline tiers
      // stay flat per the mono system. Theme-aware via globals.css tokens.
      xl: 'var(--shadow-overlay)',
      '2xl': 'var(--shadow-overlay-lg)',
      inner: '0 0 #0000',
      none: '0 0 #0000',
    },
    extend: {
      colors: {
        bg: {
          primary: 'rgb(var(--bg-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--bg-tertiary-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
          hover: 'var(--bg-hover)',
        },
        border: {
          DEFAULT: 'var(--border-primary)',
          secondary: 'var(--border-secondary)',
          focus: 'var(--border-focus)',
          strong: 'var(--border-strong)',
        },
        text: {
          primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)',
          inverse: 'var(--text-inverse)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
          line: 'var(--accent-line)',
        },
        status: {
          success: 'rgb(var(--status-success-rgb) / <alpha-value>)',
          warning: 'var(--status-warning)',
          error: 'rgb(var(--status-error-rgb) / <alpha-value>)',
          info: 'var(--status-info)',
        },
      },
      ringColor: {
        DEFAULT: 'rgb(var(--accent-rgb) / 1)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      // Motion ("Snappy"): one-shot, compositor-only (opacity + translate/scale),
      // 130ms in / 90ms out. Uses the standalone `translate`/`scale` properties
      // so keyframes never clobber layout transforms (e.g. centered dialogs).
      // Nothing loops. Reduced-motion users get ~instant states (globals.css).
      animation: {
        'ff-pop-in': 'ff-pop-in 130ms cubic-bezier(.2,0,0,1)',
        'ff-pop-out': 'ff-pop-out 90ms cubic-bezier(.4,0,1,1) forwards',
        'ff-rise-in': 'ff-rise-in 130ms cubic-bezier(.2,0,0,1)',
        'ff-rise-out': 'ff-rise-out 90ms cubic-bezier(.4,0,1,1) forwards',
        'ff-fade-in': 'ff-fade-in 130ms linear',
        'ff-fade-out': 'ff-fade-out 90ms linear forwards',
        'ff-slide-in': 'ff-slide-in 130ms cubic-bezier(.2,0,0,1)',
        'ff-row-in': 'ff-row-in 160ms cubic-bezier(.2,0,0,1)',
        'ff-grow-x': 'ff-grow-x 160ms cubic-bezier(.2,0,0,1)',
      },
      keyframes: {
        'ff-pop-in': { from: { opacity: '0', translate: '0 -4px', scale: '.98' }, to: { opacity: '1', translate: '0 0', scale: '1' } },
        'ff-pop-out': { from: { opacity: '1' }, to: { opacity: '0', translate: '0 -4px', scale: '.98' } },
        'ff-rise-in': { from: { opacity: '0', translate: '0 4px', scale: '.98' }, to: { opacity: '1', translate: '0 0', scale: '1' } },
        'ff-rise-out': { from: { opacity: '1' }, to: { opacity: '0', translate: '0 4px', scale: '.98' } },
        'ff-fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'ff-fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'ff-slide-in': { from: { opacity: '0', translate: '12px 0' }, to: { opacity: '1', translate: '0 0' } },
        'ff-row-in': { from: { opacity: '0', translate: '0 -4px' }, to: { opacity: '1', translate: '0 0' } },
        'ff-grow-x': { from: { scale: '0 1' }, to: { scale: '1 1' } },
      },
    },
  },
  plugins: [
    plugin(({ addVariant }) => {
      addVariant('pointer-coarse', '@media (pointer: coarse)')
    }),
  ],
}

export default config
