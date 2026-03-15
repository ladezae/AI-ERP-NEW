import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 一吉品牌色系：質樸、信賴、台灣在地感
        brand: {
          50:  '#f7f4ee',
          100: '#ede5d0',
          200: '#d9c9a0',
          300: '#c4a96e',
          400: '#b08d45',
          500: '#8b6914',   // 主色：溫暖金褐
          600: '#6b4f0e',
          700: '#4e380a',
          800: '#342406',
          900: '#1c1303',
        },
        earth: {
          50:  '#f5f0eb',
          100: '#e8ddd0',
          200: '#d0b89c',
          300: '#b89068',
          400: '#9a6e40',
          500: '#7a5230',   // 深褐：文字、邊框
          600: '#5e3e24',
          700: '#432c19',
          800: '#291b0f',
          900: '#110b04',
        },
        leaf: {
          50:  '#f0f5ec',
          100: '#d9eacf',
          200: '#aed19e',
          300: '#7eb56b',
          400: '#569640',
          500: '#3d7229',   // 葉綠：強調色
          600: '#2e5620',
          700: '#1f3c16',
          800: '#12230c',
          900: '#060f04',
        },
        cream: '#fdf8f0',   // 背景主色：溫暖奶油色
      },
      fontFamily: {
        sans: ['Noto Sans TC', 'sans-serif'],
        serif: ['Noto Serif TC', 'serif'],
      },
    },
  },
  plugins: [],
};
export default config;
