/**
 * 导航页「页面设置」弹窗（v1.51.8）：作用于整页外观与环境，与分组卡片设置（v1.51.7）解耦。
 * 四个分区：背景图片（URL + 本地上传 + 预览 + 模糊）/ 环境天气效果 / 内外网默认模式 / 白昼模式。
 * 保存经 onSave 整体落盘（服务端 normalizeNavPageSettings 兜底校验）。
 */
import { useRef, useState } from "react";
import { X } from "lucide-react";
import type { NavPageSettings, NavWeather, NavTheme, NavNetworkMode } from "../types";
import { uploadNavAssetApi } from "../api";

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400 bg-white text-slate-700";

/** 背景图体积上限（与服务端 NAV_ASSET_MAX_BYTES 保持一致） */
const NAV_ASSET_MAX_BYTES = 20 * 1024 * 1024;

const WEATHER_OPTIONS: { value: NavWeather; label: string }[] = [
  { value: "none", label: "无" },
  { value: "rain", label: "雨天" },
  { value: "snow", label: "雪天" },
  { value: "sakura", label: "樱花" },
  { value: "leaves", label: "落叶" },
];

const NETWORK_OPTIONS: { value: NavNetworkMode; label: string }[] = [
  { value: "auto", label: "自动识别" },
  { value: "lan", label: "强制内网" },
  { value: "wan", label: "强制外网" },
];

const THEME_OPTIONS: { value: NavTheme; label: string }[] = [
  { value: "auto", label: "跟随系统" },
  { value: "light", label: "白昼" },
  { value: "dark", label: "夜间" },
];

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-[12px] rounded-md border ${
            value === o.value
              ? "bg-rose-50 text-rose-600 border-rose-300"
              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NavPageSettingsModal({
  initial,
  onSave,
  onClose,
}: {
  initial: NavPageSettings;
  onSave: (s: NavPageSettings) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavPageSettings>({
    bgImage: initial.bgImage || "",
    bgBlur: initial.bgBlur ?? 0,
    weather: initial.weather || "none",
    theme: initial.theme || "auto",
    navNetworkMode: initial.navNetworkMode || "auto",
  });
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<NavPageSettings>) => setDraft((d) => ({ ...d, ...p }));

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr("");
    try {
      // ★ 上传前先挡下超限/非图片文件，避免服务端 413 后才报错（且提示更明确）
      if (file.size > NAV_ASSET_MAX_BYTES) {
        throw new Error(`图片过大（${(file.size / 1024 / 1024).toFixed(2)} MB），请上传 ≤20MB 的图片`);
      }
      if (file.type && !file.type.startsWith("image/")) {
        throw new Error("请选择图片文件（jpg/png/webp/gif/svg/ico）");
      }
      const { url } = await uploadNavAssetApi(file, file.name);
      patch({ bgImage: url });
    } catch (err: any) {
      setUploadErr(err?.message || "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">页面设置</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 背景图片 */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">背景图片</p>
            <input
              className={inputCls}
              placeholder="背景图片 URL（http(s)/data: 或留空用默认渐变）"
              value={draft.bgImage || ""}
              onChange={(e) => patch({ bgImage: e.target.value.trim() })}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="px-3 py-1.5 text-xs text-white bg-rose-500 rounded-lg hover:bg-rose-600 disabled:opacity-40"
              >
                {uploading ? "上传中…" : "本地上传"}
              </button>
              {draft.bgImage && (
                <button
                  type="button"
                  onClick={() => patch({ bgImage: "" })}
                  className="px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  清除
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
            </div>
            <p className="text-[11px] text-slate-400">支持 jpg / png / webp / gif / svg / ico，单张 ≤20MB</p>
            {uploadErr && <p className="text-[11px] text-red-500">{uploadErr}</p>}
            {draft.bgImage && (
              <div className="mt-1">
                <img
                  src={draft.bgImage}
                  alt="背景预览"
                  className="w-full max-h-28 object-cover rounded-lg border border-slate-200"
                />
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[12px] text-slate-500 w-16">模糊</span>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={draft.bgBlur ?? 0}
                    onChange={(e) => patch({ bgBlur: Number(e.target.value) })}
                    className="flex-1 accent-rose-500"
                  />
                  <span className="text-[11px] text-slate-500 w-12 text-right">{draft.bgBlur ?? 0}px</span>
                </div>
              </div>
            )}
          </section>

          {/* 环境天气效果 */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">环境天气效果</p>
            <select
              className={inputCls}
              value={draft.weather || "none"}
              onChange={(e) => patch({ weather: e.target.value as NavWeather })}
            >
              {WEATHER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </section>

          {/* 内外网设置 */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">内外网设置（默认访问模式）</p>
            <Segmented
              value={draft.navNetworkMode || "auto"}
              options={NETWORK_OPTIONS}
              onChange={(v) => patch({ navNetworkMode: v })}
            />
            <p className="text-[11px] text-slate-400 mt-1.5">覆盖单卡自动判定；自动=按访问 IP 分区</p>
          </section>

          {/* 白昼模式 */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">白昼模式</p>
            <Segmented
              value={draft.theme || "auto"}
              options={THEME_OPTIONS}
              onChange={(v) => patch({ theme: v })}
            />
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={() => onSave(draft)}
            className="px-4 py-1.5 text-sm text-white bg-rose-500 rounded-lg hover:bg-rose-600"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
