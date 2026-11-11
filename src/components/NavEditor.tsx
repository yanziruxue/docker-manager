/**
 * 导航仪表盘管理弹窗（v1.51.0，label 分支）：
 * - 分组：新增 / 改名 / 删除 / 上移下移；
 * - 分组卡片设置（v1.51.7，参照 FlatNas）：布局（垂直/水平）、卡片大小、卡片间距、图标大小；
 * - 应用：新增 / 编辑（经 NavAppModal，区分自托管/非自托管）/ 删除 / 上移下移；
 * - Docker 一键聚合：勾选容器（优先有 WebUI/端口的）批量生成为当前分组的应用卡片。
 * 保存通过 onSave(groups) 整体落盘（服务端 normalizeNavGroups 兜底校验）。
 */
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Pencil, Plus, Rocket, Trash2, X } from "lucide-react";
import type { Container, NavAppItem, NavGroup } from "../types";
import { NavAppModal } from "./NavAppModal";

/** 随机 id（与标签库同风格：时间戳 36 进制 + 随机尾） */
function genId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white text-slate-700";

function AppRow({
  app,
  index,
  count,
  onEdit,
  onDelete,
  onMove,
}: {
  app: NavAppItem;
  index: number;
  count: number;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-100 bg-white">
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white"
        style={{ background: app.iconColor || "#3B82F6" }}
      >
        {(app.name || "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-slate-700 truncate flex items-center gap-1.5">
          {app.name}
          {app.kind === "ext" && (
            <span className="text-[10px] px-1 rounded bg-slate-100 text-slate-400">外链</span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 truncate">
          {app.lanUrl ? `内网 ${app.lanUrl}` : "内网未配置"} · {app.url ? `外网 ${app.url}` : "外网未配置"}
        </div>
      </div>
      <button onClick={onEdit} className="p-1 text-slate-400 hover:text-blue-600" title="编辑">
        <Pencil size={13} />
      </button>
      <button onClick={() => onMove(-1)} disabled={index === 0} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="上移">
        <ArrowUp size={13} />
      </button>
      <button onClick={() => onMove(1)} disabled={index === count - 1} className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30" title="下移">
        <ArrowDown size={13} />
      </button>
      <button onClick={onDelete} className="p-1 text-slate-400 hover:text-red-600" title="删除">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/** Docker 一键聚合选择列表（仅展示容器；勾选后批量生成） */
function DockerImport({
  containers,
  onImport,
  onClose,
}: {
  containers: Container[];
  onImport: (picked: Container[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => {
    return [...containers].sort((a, b) => {
      const s = (c: Container) => (c.webuiUrl || c.webuiPort ? 0 : 1);
      return s(a) - s(b) || a.name.localeCompare(b.name);
    });
  }, [containers]);
  const toggle = (id: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">勾选容器生成入口（内网地址自动取 WebUI 端口，外网取其 WebUI URL）</p>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-600">返回</button>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
        {sorted.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg border border-slate-100 bg-white cursor-pointer hover:border-slate-200">
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              onChange={() => toggle(c.id)}
              className="w-3.5 h-3.5 accent-blue-600"
            />
            {c.icon ? (
              <img src={c.icon} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
            ) : (
              <span className="w-5 h-5 rounded bg-slate-200 flex-shrink-0" />
            )}
            <span className="text-[13px] text-slate-700 truncate flex-1">{c.name}</span>
            <span className="text-[11px] text-slate-400 flex-shrink-0">
              {c.webuiPort ? `:${c.webuiPort}` : c.webuiUrl ? "有 URL" : "无地址"}
            </span>
          </label>
        ))}
        {sorted.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">当前引擎没有容器</p>}
      </div>
      <button
        onClick={() => onImport(sorted.filter((c) => picked.has(c.id)))}
        disabled={picked.size === 0}
        className="w-full py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
      >
        生成 {picked.size} 个入口
      </button>
    </div>
  );
}

export function NavEditor({
  groups,
  containers,
  initialGroupId,
  autoAddApp,
  onSave,
  onClose,
}: {
  groups: NavGroup[];
  containers: Container[];
  /** 打开时聚焦的分组 id（导航页当前选中分组）；缺省回落第一个 */
  initialGroupId?: string;
  /** true = 打开时自动给聚焦分组追加一个空白入口（导航页「＋」触发） */
  autoAddApp?: boolean;
  onSave: (groups: NavGroup[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavGroup[]>(() => {
    const base = groups.map((g) => ({ ...g, apps: [...(g.apps || [])] }));
    if (autoAddApp) {
      const i = base.findIndex((g) => g.id === initialGroupId);
      const idx = i >= 0 ? i : 0;
      if (base[idx]) {
        base[idx] = {
          ...base[idx],
          apps: [...base[idx].apps, { id: genId(), name: "新入口", icon: "", iconColor: "#3B82F6", url: "", lanUrl: "", remark: "" }],
        };
      }
    }
    return base;
  });
  const [activeIdx, setActiveIdx] = useState(() => {
    const i = groups.findIndex((g) => g.id === initialGroupId);
    return i >= 0 ? i : 0;
  });
  const [importing, setImporting] = useState(false);
  const [appModal, setAppModal] = useState<{ open: boolean; initial: NavAppItem | null; groupId?: string }>({
    open: false,
    initial: null,
    groupId: undefined,
  });
  const active = draft[activeIdx];

  const updateActive = (patch: Partial<NavGroup>) => {
    setDraft((prev) => prev.map((g, i) => (i === activeIdx ? { ...g, ...patch } : g)));
  };
  const addGroup = () => {
    const g: NavGroup = { id: genId(), name: `分组 ${draft.length + 1}`, apps: [], cardLayout: "vertical", cardSize: 120, gridGap: 16, iconSize: 48 };
    setDraft((prev) => [...prev, g]);
    setActiveIdx(draft.length);
  };
  const removeGroup = (idx: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
    setActiveIdx((cur) => Math.max(0, Math.min(cur, draft.length - 2)));
  };
  const moveGroup = (idx: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const n = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= n.length) return prev;
      [n[idx], n[j]] = [n[j], n[idx]];
      return n;
    });
    setActiveIdx((cur) => (cur === idx ? idx + dir : cur));
  };
  const importApps = (picked: Container[]) => {
    const items: NavAppItem[] = picked.map((c) => ({
      id: genId(),
      name: c.name,
      icon: c.icon || "",
      iconColor: "",
      url: c.webuiUrl || "",
      lanUrl: c.webuiPort ? `:${c.webuiPort}` : "",
      remark: "",
      kind: "self",
    }));
    updateActive({ apps: [...(active?.apps || []), ...items] });
    setImporting(false);
  };
  const handleSaveApp = (gid: string, app: NavAppItem) => {
    setDraft((prev) =>
      prev.map((g) => {
        if (g.id === gid) {
          const exists = g.apps.some((a) => a.id === app.id);
          return {
            ...g,
            apps: exists ? g.apps.map((a) => (a.id === app.id ? app : a)) : [...g.apps, app],
          };
        }
        return { ...g, apps: g.apps.filter((a) => a.id !== app.id) };
      }),
    );
    setAppModal({ open: false, initial: null });
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">管理导航</h3>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* 左列：分组列表 */}
          <div className="w-48 flex-shrink-0 border-r border-slate-100 flex flex-col">
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {draft.map((g, i) => (
                <div
                  key={g.id}
                  className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-[13px] ${
                    i === activeIdx ? "bg-blue-50 text-blue-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() => { setActiveIdx(i); setImporting(false); }}
                >
                  <span className="truncate flex-1">{g.name}</span>
                  <span className="text-[10px] text-slate-400">{g.apps.length}</span>
                  <span className="hidden group-hover:flex items-center">
                    <button onClick={(e) => { e.stopPropagation(); moveGroup(i, -1); }} className="p-0.5 text-slate-400 hover:text-slate-700"><ArrowUp size={11} /></button>
                    <button onClick={(e) => { e.stopPropagation(); moveGroup(i, 1); }} className="p-0.5 text-slate-400 hover:text-slate-700"><ArrowDown size={11} /></button>
                    <button onClick={(e) => { e.stopPropagation(); removeGroup(i); }} className="p-0.5 text-slate-400 hover:text-red-600"><Trash2 size={11} /></button>
                  </span>
                </div>
              ))}
            </div>
            <button onClick={addGroup} className="m-2 py-1.5 text-xs text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 flex items-center justify-center gap-1">
              <Plus size={12} /> 新增分组
            </button>
          </div>

          {/* 右侧：当前分组的名称 / 卡片设置 / 入口列表 */}
          <div className="flex-1 flex flex-col min-w-0">
            {active ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <input
                  className={inputCls + " max-w-[240px] font-medium"}
                  value={active.name}
                  onChange={(e) => updateActive({ name: e.target.value })}
                  placeholder="分组名称"
                />

                {/* 卡片设置（v1.51.7，参照 FlatNas） */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-3">
                  <p className="text-xs font-medium text-slate-600">卡片设置（参照 FlatNas）</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-slate-500 w-16">布局</span>
                    <div className="flex gap-1">
                      {(["vertical", "horizontal"] as const).map((lay) => (
                        <button
                          key={lay}
                          onClick={() => updateActive({ cardLayout: lay })}
                          className={`px-2.5 py-1 text-[12px] rounded-md border ${
                            (active.cardLayout || "vertical") === lay
                              ? "bg-blue-50 text-blue-600 border-blue-300"
                              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                          }`}
                        >
                          {lay === "vertical" ? "垂直" : "水平"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <SliderRow
                    label="卡片大小"
                    value={active.cardSize ?? 120}
                    min={60}
                    max={240}
                    unit="px"
                    onChange={(v) => updateActive({ cardSize: v })}
                  />
                  <SliderRow
                    label="卡片间距"
                    value={active.gridGap ?? 16}
                    min={0}
                    max={60}
                    unit="px"
                    onChange={(v) => updateActive({ gridGap: v })}
                  />
                  <SliderRow
                    label="图标大小"
                    value={active.iconSize ?? 48}
                    min={16}
                    max={96}
                    unit="px"
                    onChange={(v) => updateActive({ iconSize: v })}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setImporting((v) => !v)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    {importing ? <ChevronLeft size={12} /> : <Rocket size={12} />}
                    {importing ? "返回编辑" : "从容器生成"}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setAppModal({ open: true, initial: null, groupId: active.id })}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    <Plus size={12} /> 添加入口
                  </button>
                </div>

                {importing ? (
                  <DockerImport containers={containers} onImport={importApps} onClose={() => setImporting(false)} />
                ) : (
                  <div className="space-y-1.5">
                    {active.apps.map((a, i) => (
                      <AppRow
                        key={a.id}
                        app={a}
                        index={i}
                        count={active.apps.length}
                        onEdit={() => setAppModal({ open: true, initial: a, groupId: active.id })}
                        onDelete={() => updateActive({ apps: active.apps.filter((x) => x.id !== a.id) })}
                        onMove={(dir) => {
                          const apps = [...active.apps];
                          const j = i + dir;
                          if (j < 0 || j >= apps.length) return;
                          [apps[i], apps[j]] = [apps[j], apps[i]];
                          updateActive({ apps });
                        }}
                      />
                    ))}
                    {active.apps.length === 0 && (
                      <p className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
                        还没有入口：手动「添加入口」或「从容器生成」
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
                左侧新增一个分组开始配置
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            取消
          </button>
          <button
            onClick={() => onSave(draft.filter((g) => g.name.trim()))}
            className="px-4 py-1.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            保存
          </button>
        </div>
      </div>

      {/* 添加 / 编辑项目弹窗 */}
      {appModal.open && (
        <NavAppModal
          groups={draft}
          containers={containers}
          initial={appModal.initial}
          initialGroupId={appModal.groupId || active?.id}
          onSave={handleSaveApp}
          onClose={() => setAppModal({ open: false, initial: null })}
        />
      )}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-slate-500 w-16">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-blue-500"
      />
      <span className="text-[11px] text-slate-500 w-12 text-right">{value}{unit}</span>
    </div>
  );
}
