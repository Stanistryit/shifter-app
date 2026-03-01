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
                darkios: { bg: '#000000', card: '#1C1C1E', input: '#2C2C2E' }
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
