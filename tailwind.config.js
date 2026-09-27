/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: "#1e293b",
          hover: "#334155",
          active: "#3b82f6",
        },
        // Unraid 官方色板（取自 default-color-palette.css，命名保留其 token 语义）
        ink: "#1d1b1b", // 主文字（--black）
        surface: "#f2f2f2", // 次级表面（--gray-100）
        accent: "#0099ff", // 控件蓝（--blue-700）
        brand: {
          500: "#ff8c2f", // Unraid Brand Orange
          800: "#f15a2c", // Unraid Brand Orange Dark
        },
      },
      screens: {
        // Unraid 仪表盘的三列断点为 1600px；本项目左侧有固定侧边栏，
        // 故按「视口 - 侧边栏 - 内边距」反推为 1800px，保证每列仍有 ~490px 可用宽度。
        "3xl": "1800px",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "slide-down": "slideDown 0.2s ease-out",
        "pulse-slow": "pulse 2s ease-in-out infinite",
        // 不确定态进度条（无法计算百分比时的来回滑动指示）
        indeterminate: "indeterminate 1.4s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        slideDown: {
          "0%": { transform: "translateY(-10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        indeterminate: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(300%)" },
        },
      },
    },
  },
  plugins: [],
};
