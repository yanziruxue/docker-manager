/**
 * 添加 / 编辑导航项目弹窗（v1.51.7）：
 * - 两种类型：自托管（富表单，按 FlatNas「添加新项目」布局：标题/标题颜色/描述/外网链接+备用/内网链接+备用/图标区/公开）
 *   与非自托管（仅 名称 / 链接 / 图标 / 描述，点击直接打开链接）。
 * - 顶部「分组」下拉 = 决定该项目加到哪个分组（对应截图顶部的 app 下拉）。
 * - 自托管「从容器自动填写」：选 Docker 容器后自动填充 标题/图标/内外网地址（即「可以自动填写，可以添加 docker」）。
 * - 图标区：预览 + 已缓存徽标 + ⚡智能匹配（按标题在自定义图标库 map 中自动匹配名称）+ 缩放滑块 + 图片 URL 输入。
 * 保存通过 onSave(groupId, app) 回调交给 NavEditor 整体落盘。
 */
import { useMemo, useState } from "react";
import { Check, Globe, Plus, X, Zap } from "lucide-react";
import type { Container, NavAppItem, NavGroup } from "../types";
import { resolveNavIconSrc, useNavIconMap } from "./NavBoard";

function genId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 focus:border-fuchsia-400 bg-white text-slate-700";

export function NavAppModal({
  groups,
  containers,
  initial,
  initialGroupId,
  onSave,
  onClose,
}: {
  groups: NavGroup[];
  containers: Container[];
  /** 编辑已有项目时传入；null/undefined = 新增 */
  initial?: NavAppItem | null;
  /** 新增时默认归属的分组 id（通常为当前分组） */
  initialGroupId?: string;
  onSave: (groupId: string, app: NavAppItem) => void;
  onClose: () => void;
}) {
  const iconMap = useNavIconMap();
  const editing = !!initial;

  const [kind, setKind] = useState<"self" | "ext">(initial?.kind === "ext" ? "ext" : "self");
  const [groupId, setGroupId] = useState<string>(() => {
    if (initial) {
      const hit = groups.find((g) => g.apps?.some((a) => a.id === initial.id));
      if (hit) return hit.id;
    }
    if (initialGroupId && groups.some((g) => g.id === initialGroupId)) return initialGroupId;
    return groups[0]?.id || "";
  });

  const [name, setName] = useState(initial?.name || "");
  const [titleColor, setTitleColor] = useState(initial?.titleColor || "#0F172A");
  const [remark, setRemark] = useState(initial?.remark || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [lanUrl, setLanUrl] = useState(initial?.lanUrl || "");
  const [icon, setIcon] = useState(initial?.icon || "");
  const [iconZoom, setIconZoom] = useState<number>(initial?.iconZoom || 100);
  const [isPublic, setIsPublic] = useState<boolean>(!!initial?.isPublic);
  const [urlBackups, setUrlBackups] = useState<string[]>(initial?.urlBackups || []);
  const [lanBackups, setLanBackups] = useState<string[]>(initial?.lanBackups || []);

  const src = useMemo(() => resolveNavIconSrc(icon, iconMap), [icon, iconMap]);
  const cached = useMemo(() => {
    const v = String(icon || "").trim();
    return !!v && !/^(https?:\/\/|data:|\/api\/)/i.test(v) && !!iconMap[v.toLowerCase()];
  }, [icon, iconMap]);

  const sortedContainers = useMemo(
    () => [...containers].sort((a, b) => a.name.localeCompare(b.name)),
    [containers],
  );

  const fillFromContainer = (id: string) => {
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    setName(c.name);
    if (c.icon) setIcon(c.icon);
    setUrl(c.webuiUrl || "");
    setLanUrl(c.webuiPort ? `:${c.webuiPort}` : "");
  };

  const smartMatch = () => {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return;
    const entries = Object.keys(iconMap);
    const hit =
      entries.find((k) => k.toLowerCase() === key) ||
      entries.find((k) => k.toLowerCase().includes(key) || key.includes(k.toLowerCase()));
    if (hit) setIcon(hit);
  };

  const addBackup = (which: "url" | "lan") => {
    if (which === "url") setUrlBackups((p) => [...p, ""]);
    else setLanBackups((p) => [...p, ""]);
  };
  const setBackup = (which: "url" | "lan", i: number, val: string) => {
    if (which === "url")
      setUrlBackups((p) => p.map((x, idx) => (idx === i ? val : x)));
    else setLanBackups((p) => p.map((x, idx) => (idx === i ? val : x)));
  };
  const removeBackup = (which: "url" | "lan", i: number) => {
    if (which === "url") setUrlBackups((p) => p.filter((_, idx) => idx !== i));
    else setLanBackups((p) => p.filter((_, idx) => idx !== i));
  };

  const canSave = name.trim().length > 0 && url.trim().length > 0 && groupId;
  const confirm = () => {
    if (!canSave || !groupId) return;
    const app: NavAppItem = {
      id: initial?.id || genId(),
      name: name.trim(),
      icon: icon.trim(),
      iconColor: initial?.iconColor || "#3B82F6",
      remark: remark.trim(),
      kind,
      url: url.trim(),
    };
    if (kind === "self") {
      app.titleColor = titleColor;
      app.lanUrl = lanUrl.trim();
      app.isPublic = isPublic;
      app.iconZoom = iconZoom;
      app.urlBackups = urlBackups.map((x) => x.trim()).filter(Boolean);
      app.lanBackups = lanBackups.map((x) => x.trim()).filter(Boolean);
    }
    onSave(groupId, app);
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部：标题 + 分组下拉 + 公开 + 关闭（对应截图「app」下拉=分组 + 公开开关） */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{editing ? "编辑项目" : "添加新项目"}</h3>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">分组</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="px-2 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-px h-5 bg-slate-200" />
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <span className="text-[11px] text-slate-500">公开</span>
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${isPublic ? "bg-fuchsia-500" : "bg-slate-300"}`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isPublic ? "left-[18px]" : "left-0.5"}`}
              />
            </button>
          </label>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {/* 类型切换 */}
        <div className="flex gap-2 px-5 pt-3">
          {(["self", "ext"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-[13px] rounded-full border transition-colors ${
                kind === k
                  ? "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-300 font-medium"
                  : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {k === "self" ? "自托管" : "非自托管"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* 非自托管：名称 / 链接 / 图标 / 描述 */}
          {kind === "ext" ? (
            <>
              <Field label="名称" required>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的博客" />
              </Field>
              <Field label="链接" required>
                <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
              </Field>
              <Field label="图标（自定义图标库名称或完整 URL，留空=首字母）">
                <input className={inputCls} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="如 qbittorrent 或 https://…" />
              </Field>
              <Field label="描述">
                <textarea
                  className={inputCls + " resize-none h-20"}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="一行一句简介（非自托管外链描述）"
                />
              </Field>
              <IconBlock src={src} cached={cached} iconZoom={iconZoom} iconColor={initial?.iconColor} />
            </>
          ) : (
            <>
              {/* 自托管：从容器自动填写 */}
              <Field label="从 Docker 容器自动填写（可选）">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) fillFromContainer(e.target.value);
                    e.target.value = "";
                  }}
                  className="w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30"
                >
                  <option value="">选择容器自动填充…</option>
                  {sortedContainers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.webuiPort ? `（:${c.webuiPort}）` : c.webuiUrl ? "（有 URL）" : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="标题" required>
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的博客" />
                </Field>
                <Field label="标题颜色">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={titleColor}
                      onChange={(e) => setTitleColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-slate-200 bg-white cursor-pointer p-0.5"
                    />
                    <input
                      className={inputCls + " flex-1"}
                      value={titleColor}
                      onChange={(e) => setTitleColor(e.target.value)}
                      placeholder="#0F172A"
                    />
                  </div>
                </Field>
              </div>

              <Field label="描述（水平模式显示，每行对应一行文字）">
                <textarea
                  className={inputCls + " resize-none h-20"}
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder={"第一行（上）\n第二行（中）\n第三行（下）"}
                />
              </Field>

              <Field label="外网链接" required>
                <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
              </Field>
              {urlBackups.map((b, i) => (
                <div key={i} className="flex items-center gap-2 -mt-1">
                  <input
                    className={inputCls + " flex-1"}
                    value={b}
                    onChange={(e) => setBackup("url", i, e.target.value)}
                    placeholder="外网备用地址"
                  />
                  <button onClick={() => removeBackup("url", i)} className="p-1 text-slate-400 hover:text-red-600" title="删除">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => addBackup("url")} className="text-[12px] text-fuchsia-600 hover:text-fuchsia-700 -mt-1">
                ＋备用地址
              </button>

              <Field label="内网链接" >
                <input className={inputCls} value={lanUrl} onChange={(e) => setLanUrl(e.target.value)} placeholder=":8807 或 http://192.168.1.x:8080" />
                <span className="block text-[11px] text-slate-400 mt-1">选填，内网访问时优先跳转</span>
              </Field>
              {lanBackups.map((b, i) => (
                <div key={i} className="flex items-center gap-2 -mt-1">
                  <input
                    className={inputCls + " flex-1"}
                    value={b}
                    onChange={(e) => setBackup("lan", i, e.target.value)}
                    placeholder="内网备用地址"
                  />
                  <button onClick={() => removeBackup("lan", i)} className="p-1 text-slate-400 hover:text-red-600" title="删除">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => addBackup("lan")} className="text-[12px] text-fuchsia-600 hover:text-fuchsia-700 -mt-1">
                ＋备用地址
              </button>

              {/* 图标区：预览 + 已缓存 + 智能匹配 + 缩放 + 图片URL */}
              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {src ? (
                      <img src={src} alt="" className="object-contain" style={{ width: `${iconZoom}%`, height: `${iconZoom}%` }} draggable={false} />
                    ) : (
                      <span className="text-xl font-bold" style={{ color: titleColor }}>
                        {(name || "?").slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      {cached ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
                          <Check size={11} /> 已缓存
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 text-[11px] rounded-md bg-slate-100 text-slate-400 border border-slate-200">
                          未缓存
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={smartMatch}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[12px] rounded-md bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-200 hover:bg-fuchsia-100"
                        title="按标题在自定义图标库自动匹配"
                      >
                        <Zap size={12} /> 智能匹配
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500 w-10">缩放</span>
                      <input
                        type="range"
                        min={50}
                        max={200}
                        value={iconZoom}
                        onChange={(e) => setIconZoom(Number(e.target.value))}
                        className="flex-1 accent-fuchsia-500"
                      />
                      <span className="text-[11px] text-slate-500 w-10 text-right">{iconZoom}%</span>
                    </div>
                  </div>
                </div>
                <input
                  className={inputCls}
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  placeholder="图片 URL 地址…（或自定义图标库名称）"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={confirm}
            disabled={!canSave}
            className="px-4 py-1.5 text-sm text-white bg-fuchsia-600 rounded-lg hover:bg-fuchsia-700 disabled:opacity-40 flex items-center gap-1"
          >
            <Globe size={13} /> {editing ? "保存" : "确认添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 非自托管也复用同一图标预览块（精简） */
function IconBlock({
  src,
  cached,
  iconZoom,
  iconColor,
}: {
  src: string;
  cached: boolean;
  iconZoom: number;
  iconColor?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 flex items-center gap-3">
      <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
        {src ? (
          <img src={src} alt="" className="object-contain" style={{ width: `${iconZoom}%`, height: `${iconZoom}%` }} draggable={false} />
        ) : (
          <span className="text-xl font-bold" style={{ color: iconColor || "#3B82F6" }}>
            🔗
          </span>
        )}
      </div>
      <div className="flex-1">
        {cached ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
            <Check size={11} /> 已缓存
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-1 text-[11px] rounded-md bg-slate-100 text-slate-400 border border-slate-200">
            未缓存
          </span>
        )}
        <p className="text-[11px] text-slate-400 mt-1">非自托管外链图标（留空显示 🔗）</p>
      </div>
    </div>
  );
}
