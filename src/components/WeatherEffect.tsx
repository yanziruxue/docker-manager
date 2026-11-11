/**
 * 导航页环境天气效果（v1.51.8，参照 FlatNas）：纯前端 canvas 粒子覆盖层，
 * 不依赖任何外部天气 API（避免引入密钥/网络依赖）。支持 无/雨/雪/樱花/落叶 五种。
 * 以 `pointer-events-none` 固定覆盖整页，自身不拦截任何点击；随 `weather` prop 切换/重绘。
 */
import { useEffect, useRef } from "react";
import type { NavWeather } from "../types";

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  sway: number;
  phase: number;
  opacity: number;
  color: string;
}

const RAIN_COLOR = "rgba(255,255,255,0.45)";
const SNOW_COLOR = "rgba(255,255,255,0.85)";
const SAKURA_COLORS = ["#ffd1e3", "#ffb7d5", "#ffc6dd", "#ff9ec6"];
const LEAF_COLORS = ["#e8a04b", "#d9772f", "#c85a2b", "#b8441f", "#e0b35a"];

export function WeatherEffect({ weather }: { weather: NavWeather }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!weather || weather === "none") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const pick = (arr: string[]) => arr[(Math.random() * arr.length) | 0];
    const area = width * height;

    // 各类效果粒子数量（按面积自适应 + 上限保性能）
    let count = 0;
    if (weather === "rain") count = Math.min(280, Math.round(height / 4));
    else if (weather === "snow") count = Math.min(220, Math.round(area / 9000));
    else count = Math.min(80, Math.round(area / 26000)); // sakura / leaves

    const parts: P[] = [];
    for (let i = 0; i < count; i++) {
      if (weather === "rain") {
        parts.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 1.2,
          vy: 9 + Math.random() * 6,
          size: 8 + Math.random() * 10,
          rot: 0,
          vr: 0,
          sway: 0,
          phase: 0,
          opacity: 0.3 + Math.random() * 0.4,
          color: RAIN_COLOR,
        });
      } else if (weather === "snow") {
        parts.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0.6 + Math.random() * 1.4,
          size: 1.5 + Math.random() * 3,
          rot: 0,
          vr: 0,
          sway: 0.4 + Math.random() * 0.8,
          phase: Math.random() * Math.PI * 2,
          opacity: 0.5 + Math.random() * 0.5,
          color: SNOW_COLOR,
        });
      } else {
        // sakura / leaves：飘落 + 旋转 + 横向摇摆
        const isSakura = weather === "sakura";
        parts.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: 0,
          vy: 0.5 + Math.random() * 1.1,
          size: isSakura ? 5 + Math.random() * 5 : 7 + Math.random() * 6,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.04,
          sway: 0.6 + Math.random() * 1.2,
          phase: Math.random() * Math.PI * 2,
          opacity: 0.55 + Math.random() * 0.45,
          color: isSakura ? pick(SAKURA_COLORS) : pick(LEAF_COLORS),
        });
      }
    }

    let raf = 0;
    const drawPetal = (p: P) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      // 简易花瓣/叶片：椭圆（长:短 ≈ 1.7:1）
      ctx.ellipse(0, 0, p.size, p.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };

    const loop = () => {
      ctx.clearRect(0, 0, width, height);
      for (const p of parts) {
        if (weather === "rain") {
          ctx.globalAlpha = p.opacity;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 2, p.y + p.size);
          ctx.stroke();
          p.y += p.vy;
          p.x += p.vx;
          if (p.y > height) {
            p.y = -p.size;
            p.x = Math.random() * width;
          }
        } else if (weather === "snow") {
          p.phase += 0.02;
          p.x += Math.sin(p.phase) * p.sway;
          p.y += p.vy;
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          if (p.y > height) {
            p.y = -p.size;
            p.x = Math.random() * width;
          }
        } else {
          // sakura / leaves
          p.phase += 0.015;
          p.x += Math.sin(p.phase) * p.sway;
          p.y += p.vy;
          p.rot += p.vr;
          drawPetal(p);
          if (p.y > height + p.size) {
            p.y = -p.size;
            p.x = Math.random() * width;
            p.rot = Math.random() * Math.PI * 2;
          }
          if (p.x < -p.size) p.x = width + p.size;
          else if (p.x > width + p.size) p.x = -p.size;
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [weather]);

  if (!weather || weather === "none") return null;
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      aria-hidden="true"
    />
  );
}
