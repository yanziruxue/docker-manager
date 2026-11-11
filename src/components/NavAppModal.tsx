/**
 * 添加 / 编辑导航项目弹窗（v1.51.9 重构）：单一表单，字段按用户清单固定为
 * 分组（下拉切换）/ 名称 / 描述 / ☐自托管 / 内网链接（仅勾选自托管时显示）/ 外网链接 /
 * 图标（可引用 Docker 容器图标）/ 备注。
 * - 「自托管」复选框替代旧版双类型 tab：勾选=self（内外网分区跳转），不勾选=ext（点击直接打开外网链接）。
 * - 「描述」写 description（卡片副标题）；「备注」写 remark（hover 提示），两者语义分离且旧数据回落兼容。
 * - 图标区支持从 Docker 容器自动带出图标与内外网链接、自定义图标库智能匹配、图片 URL / 图标库名称直填。
 * - v1.51.14：底部高级字段折叠区已移除，主表单仅保留用户清单内字段；标题颜色 / 链接备链 /
 *   公开标记 / 图标缩放改为保存时从 initial 原样透传，既有数据不丢，表单不再提供编辑入口。
 * 保存经 onSave(groupId, app) 由 NavPage 直接落盘；编辑态可经 onDelete(appId) 删除项目（v1.51.11）。
 */
import { useMemo, useState } from "react";
import { Check, Globe, Trash2, X, Zap } from "lucide-react";
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
  onDelete,
  onClose,
}: {
  groups: NavGroup[];
  containers: Container[];
  /** 编辑已有项目时传入；null/undefined = 新增 */
  initial?: NavAppItem | null;
  /** 新增时默认归属的分组 id（通常为当前分组） */
  initialGroupId?: string;
  onSave: (groupId: string, app: NavAppItem) => void;
  /** 编辑态删除项目（v1.51.11）：由 NavPage 从所有分组移除同 id 条目并落盘 */
  onDelete?: (appId: string) => void;
  onClose: () => void;
}) {
  const iconMap = useNavIconMap();
  const editing = !!initial;

  const [groupId, setGroupId] = useState<string>(() => {
    if (initial) {
      const hit = groups.find((g) => g.apps?.some((a) => a.id === initial.id));
      if (hit) return hit.id;
    }
    if (initialGroupId && groups.some((g) => g.id === initialGroupId)) return initialGroupId;
    return groups[0]?.id || "";
  });

  const [selfHosted, setSelfHosted] = useState<boolean>(initial?.kind !== "ext");
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [remark, setRemark] = useState(initial?.remark || "");
  const [lanUrl, setLanUrl] = useState(initial?.lanUrl || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [icon, setIcon] = useState(initial?.icon || "");

  // v1.51.14：高级字段不再可编辑，仅用于图标预览（编辑态沿用既有值）
  const previewZoom = initial?.iconZoom ?? 100;
  const previewTitleColor = initial?.titleColor || "#0F172A";

  const src = useMemo(() => resolveNavIconSrc(icon, iconMap), [icon, iconMap]);
  const cached = useMemo(() => {
    const v = String(icon || "").trim();
    return !!v && !/^(https?:\/\/|data:|\/api\/)/i.test(v) && !!iconMap[v.toLowerCase()];
  }, [icon, iconMap]);

  /** 引用 Docker 图标：带图标的容器优先；只补空字段，绝不覆盖用户已填内容 */
  const sortedContainers = useMemo(
    () => [...containers].sort((a, b) => {
      const w = (c: Container) => (c.icon ? 0 : 1);
      return w(a) - w(b) || a.name.localeCompare(b.name);
    }),
    [containers],
  );

  const fillFromContainer = (id: string) => {
    const c = containers.find((x) => x.id === id);
    if (!c) return;
    if (!name.trim()) setName(c.name);
    if (!icon.trim() && c.icon) setIcon(c.icon);
    if (!url.trim() && c.webuiUrl) setUrl(c.webuiUrl);
    if (!lanUrl.trim() && c.webuiPort && selfHosted) setLanUrl(`:${c.webuiPort}`);
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

  const canSave = name.trim().length > 0 && url.trim().length > 0 && !!groupId;
  const confirm = () => {
    if (!canSave || !groupId) return;
    const app: NavAppItem = {
      id: initial?.id || genId(),
      name: name.trim(),
      icon: icon.trim(),
      iconColor: initial?.iconColor || "#3B82F6",
      description: description.trim(),
      remark: remark.trim(),
      kind: selfHosted ? "self" : "ext",
      url: url.trim(),
      // v1.51.14：高级字段原样透传，编辑已有项目不丢数据
      titleColor: initial?.titleColor || "#0F172A",
      urlBackups: initial?.urlBackups || [],
    };
    if (selfHosted) {
      app.lanUrl = lanUrl.trim();
      app.lanBackups = initial?.lanBackups || [];
      app.isPublic = initial?.isPublic ?? false;
      app.iconZoom = initial?.iconZoom ?? 100;
    }
    onSave(groupId, app);
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 + 分组下拉（可切换项目归属分组） */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">{editing ? "编辑项目" : "添加新项目"}</h3>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400">分组</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="px-2 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 max-w-[150px]"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* 名称 */}
          <Field label="名称" required>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的博客" />
          </Field>

          {/* 描述（卡片副标题） */}
          <Field label="描述">
            <textarea
              className={inputCls + " resize-none h-16"}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="显示在卡片上的说明文字（水平布局按行显示）"
            />
          </Field>

          {/* 自托管开关 */}
          <label className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selfHosted}
              onChange={(e) => setSelfHosted(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-fuchsia-600 flex-shrink-0"
            />
            <span className="text-[13px] text-slate-700 leading-5">
              自托管
              <span className="block text-[11px] text-slate-400 leading-4">
                勾选后可配置内网链接，访问时按内外网自动切换；不勾选则点击直接打开外网链接
              </span>
            </span>
          </label>

          {/* 内网链接（仅自托管显示） */}
          {selfHosted && (
            <Field label="内网链接">
              <input className={inputCls} value={lanUrl} onChange={(e) => setLanUrl(e.target.value)} placeholder=":8807 或 http://192.168.1.x:8080" />
              <span className="block text-[11px] text-slate-400 mt-1">选填，内网访问时优先跳转</span>
            </Field>
          )}

          {/* 外网链接 */}
          <Field label="外网链接" required>
            <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          </Field>

          {/* 图标（可引用 Docker 容器图标） */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
            <p className="text-xs font-medium text-slate-600">图标</p>
            <div className="flex items-start gap-3">
              <div className="w-14 h-14 rounded-xl bg-white border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                {src ? (
                  <img src={src} alt="" className="object-contain" style={{ width: `${previewZoom}%`, height: `${previewZoom}%` }} draggable={false} />
                ) : (
                  <span className="text-xl font-bold" style={{ color: previewTitleColor }}>
                    {(name || "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex-1 space-y-2 min-w-0">
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) fillFromContainer(e.target.value);
                    e.target.value = "";
                  }}
                  className={inputCls + " text-[12px]"}
                  title="引用 Docker 容器图标，并自动带出名称与内外网链接"
                >
                  <option value="">引用 Docker 容器图标…</option>
                  {sortedContainers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.icon ? "（有图标）" : ""}{c.webuiPort ? `（:${c.webuiPort}）` : ""}
                    </option>
                  ))}
                </select>
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
                    title="按名称在自定义图标库自动匹配"
                  >
                    <Zap size={12} /> 智能匹配
                  </button>
                </div>
              </div>
            </div>
            <input
              className={inputCls}
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="图片 URL / 自定义图标库名称（留空=名称首字母）"
            />
          </div>

          {/* 备注 */}
          <Field label="备注">
            <textarea
              className={inputCls + " resize-none h-16"}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="仅自己备忘，鼠标悬停卡片时显示"
            />
          </Field>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
          {editing && onDelete && (
            <button
              type="button"
              onClick={() => {
                if (!initial) return;
                if (!window.confirm(`确定删除项目「${initial.name}」？`)) return;
                onDelete(initial.id);
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              title="删除该项目"
            >
              <Trash2 size={13} /> 删除项目
            </button>
          )}
          <div className="flex-1" />
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
