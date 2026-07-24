/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: '',
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      fontFamily: {
        sans: ['Golos Text', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Archivo', 'Manrope', 'system-ui', 'sans-serif'],
        manrope: ['Manrope', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        caps: '0.14em',
      },
      // Readability lift (см. UI_REDESIGN_SPEC.md §4.1): xs 12→13px,
      // sm 14→14.5px; '2xs' — новый минимальный санкционированный размер
      // (чипы, табличный капс). lg…5xl прописаны явно = Tailwind-дефолты,
      // чтобы ничего не сдвинулось.
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }], // 12px — чипы, таблично-заголовочный капс
        xs: ['0.8125rem', { lineHeight: '1.125rem' }], // 13px (было 12) — мета, подписи
        sm: ['0.90625rem', { lineHeight: '1.375rem' }], // 14.5px (было 14) — основной текст
        base: ['1rem', { lineHeight: '1.5rem' }], // 16px
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: '#0c0d10',
        brand: { DEFAULT: '#FFD400', dim: '#C9A800', dark: '#E6BE00', ink: '#000000' },
        // Design system colors — theme-aware via --ds-*-rgb (set inside
        // .crm-shell / .crm-shell[data-theme='light'] in index.css), same
        // rgb(var(--x) / <alpha-value>) mechanism as the `w`/`p` tokens below.
        ds: {
          bg: 'rgb(var(--ds-bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--ds-panel-rgb) / <alpha-value>)',
          panel2: 'rgb(var(--ds-panel2-rgb) / <alpha-value>)',
          line: 'rgb(var(--ds-line-rgb) / <alpha-value>)',
          accent: '#FFD400',
          'accent-dim': '#C9A800',
          ink: 'rgb(var(--ds-ink-rgb) / <alpha-value>)',
          muted: 'rgb(var(--ds-muted-rgb) / <alpha-value>)',
          muted2: 'rgb(var(--ds-muted2-rgb) / <alpha-value>)',
          good: '#8BD46A',
          danger: '#FF6B6B',
        },
        // Student-portal tokens — driven by CSS vars under .portal (theme-aware)
        p: {
          bg: 'var(--p-bg)',
          panel: 'var(--p-panel)',
          panel2: 'var(--p-panel2)',
          line: 'var(--p-line)',
          text: 'var(--p-text)',
          muted: 'var(--p-muted)',
          muted2: 'var(--p-muted2)',
          good: 'var(--p-good)',
          accent: 'var(--p-accent)',
          'accent-dim': 'var(--p-accent-dim)',
          danger: 'var(--p-danger)',
        },
        w: {
          bg: 'rgb(var(--w-bg-rgb) / <alpha-value>)',
          panel: 'rgb(var(--w-panel-rgb) / <alpha-value>)',
          panel2: 'rgb(var(--w-panel2-rgb) / <alpha-value>)',
          line: 'rgb(var(--w-line-rgb) / <alpha-value>)',
          ink: 'rgb(var(--w-ink-rgb) / <alpha-value>)',
          muted: 'rgb(var(--w-muted-rgb) / <alpha-value>)',
          muted2: 'rgb(var(--w-muted2-rgb) / <alpha-value>)',
          accent: 'rgb(var(--w-accent-rgb) / <alpha-value>)',
          accentDim: 'rgb(var(--w-accent-dim-rgb) / <alpha-value>)',
          accentText: 'rgb(var(--w-accent-text-rgb) / <alpha-value>)',
          danger: 'rgb(var(--w-danger-rgb) / <alpha-value>)',
          good: 'rgb(var(--w-good-rgb) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        // One shared radius scale for the whole app (workspace/portal/CRM):
        // controls (buttons/inputs/selects/chips) -> panels (dropdowns, nested
        // rows) -> cards (the one primary-surface radius) -> pills (full).
        ctl: '10px',
        panel: '14px',
        card: '20px',
        pill: '9999px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}
