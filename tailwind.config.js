/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./public/*.html",
        "./public/components/**/*.html",
        "./public/js/**/*.js",
        "./public/css/**/*.css"
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                ios: { bg: '#F2F2F7', card: '#FFFFFF', input: '#E5E5EA' },
                darkios: { bg: '#000000', card: '#1C1C1E', input: '#2C2C2E' },
                blue: {
                    50: 'rgb(var(--color-primary-50) / <alpha-value>)',
                    100: 'rgb(var(--color-primary-100) / <alpha-value>)',
                    200: 'rgb(var(--color-primary-200) / <alpha-value>)',
                    300: 'rgb(var(--color-primary-300) / <alpha-value>)',
                    400: 'rgb(var(--color-primary-400) / <alpha-value>)',
                    500: 'rgb(var(--color-primary-500) / <alpha-value>)',
                    600: 'rgb(var(--color-primary-600) / <alpha-value>)',
                    700: 'rgb(var(--color-primary-700) / <alpha-value>)',
                    800: 'rgb(var(--color-primary-800) / <alpha-value>)',
                    900: 'rgb(var(--color-primary-900) / <alpha-value>)',
                }
            },
            fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'] },
            animation: {
                'slide-up': 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                'shimmer': 'shimmer 2s ease-out 0.3s forwards'
            },
            keyframes: {
                slideUp: { '0%': { transform: 'translateY(30px)', opacity: 0 }, '100%': { transform: 'translateY(0)', opacity: 1 } },
                shimmer: { '0%': { transform: 'translateX(-150%) skewX(-15deg)', opacity: 0 }, '20%': { opacity: 1 }, '100%': { transform: 'translateX(300%) skewX(-15deg)', opacity: 0 } }
            }
        }
    },
    plugins: [],
}
