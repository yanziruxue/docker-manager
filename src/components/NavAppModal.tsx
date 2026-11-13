/**
 * 添加 / 编辑导航项目弹窗（v1.51.9 重构）：单一表单，字段按用户清单固定为
 * 分组（下拉切换）/ 名称 / 描述 / ☐自托管 / 内网链接（仅勾选自托管时显示）/ 外网链接 /
 * 图标 / 备注。
 * - 「自托管」复选框替代旧版双类型 tab：勾选=self（内外网分区跳转），不勾选=ext（点击直接打开外网链接）。
 * - 「描述」写 description（卡片副标题）；「备注」写 remark（hover 提示），两者语义分离且旧数据回落兼容。
 * - v1.51.14：底部高级字段折叠区已移除，主表单仅保留用户清单内字段；标题颜色 / 链接备链 /
 *   公开标记 / 图标缩放改为保存时从 initial 原样透传，既有数据不丢，表单不再提供编辑入口。
 * - v1.51.15：图标区统一改用堆栈图标逻辑（IconAutoComplete：输入名称自动匹配图库、点选写入 URL）。
 * - v1.51.16：勾选自托管后右侧新增「容器列表」按钮，展开全局容器列表（含已停止的容器），
 *   选择容器后把名称 / 内网端口 / 外网 WebUI 地址 / 图标一次填入对应字段。
 * - v1.52.7：项目归属改为两级「分区 → 该分区下的分组」，切换分区自动回落首分组；
 *   扁平 groups 仅保留给「名称全局唯一」校验，不再用于归属下拉。
 * 保存经 onSave(groupId, app) 由 NavPage 直接落盘；编辑态可经 onDelete(appId) 删除项目（v1.51.11）。
 */
import { useMemo, useState } from "react";
import { Download, Globe, List, Trash2, X } from "lucide-react";
import type { Container, NavAppItem, NavZone } from "../types";
import { IconAutoComplete } from "./IconAutoComplete";
import { NavIconDownloadModal } from "./NavIconDownloadModal";

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
  zones,
  containers,
  iconMap,
  initial,
  initialGroupId,
  onSave,
  onDelete,
  onClose,
}: {
  /** 导航分区（v1.52.0）：内部展开全部分组用于归属下拉 / 名称唯一 / 容器已添加判定 */
  zones: NavZone[];
  /** 全局容器列表（含已停止的容器，v1.51.16：用于一次填入 4 个字段） */
  containers: Container[];
  /** 图标库映射（导航专属库同名优先 + Docker 库兜底），用于按项目名称匹配图标 */
  iconMap: Record<string, string>;
  /** 编辑已有项目时传入；null/undefined = 新增 */
  initial?: NavAppItem | null;
  /** 新增时默认归属的分组 id（通常为当前分组） */
  initialGroupId?: string;
  onSave: (groupId: string, app: NavAppItem) => void;
  /** 编辑态删除项目（v1.51.11）：由 NavPage 从所有分组移除同 id 条目并落盘 */
  onDelete?: (appId: string) => void;
  onClose: () => void;
}) {
  const editing = !!initial;
  // v1.52.0：分区→分组→卡片；扁平分组仅用于名称全局唯一 / 编辑态定位，不再用于归属下拉
  const groups = useMemo(
    () => (zones || []).flatMap((z) => z.groups || []),
    [zones],
  );

  const [groupId, setGroupId] = useState<string>(() => {
    if (initial) {
      const hit = groups.find((g) => g.apps?.some((a) => a.id === initial.id));
      if (hit) return hit.id;
    }
    if (initialGroupId && groups.some((g) => g.id === initialGroupId)) return initialGroupId;
    return groups[0]?.id || "";
  });
  // v1.52.7：归属两级——由 groupId 反查父分区（编辑态自动定位，避免下拉 value 落空）
  const [zoneId, setZoneId] = useState<string>(() =>
    (zones || []).find((z) => (z.groups || []).some((g) => g.id === groupId))?.id
    || (zones || []).find((z) => (z.groups || []).length > 0)?.id
    || (zones || [])[0]?.id
    || "",
  );
  const activeZone = (zones || []).find((z) => z.id === zoneId) || null;
  const zoneGroups = activeZone?.groups || [];
  /** 切换分区：分组回落到该分区首分组；该分区无分组时置空（保存按钮随之禁用） */
  const changeZone = (nextZoneId: string) => {
    setZoneId(nextZoneId);
    const z = (zones || []).find((x) => x.id === nextZoneId);
    setGroupId(z?.groups?.[0]?.id || "");
  };

  const [selfHosted, setSelfHosted] = useState<boolean>(initial?.kind !== "ext");
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [remark, setRemark] = useState(initial?.remark || "");
  const [lanUrl, setLanUrl] = useState(initial?.lanUrl || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [icon, setIcon] = useState(initial?.icon || "");
  const [showContainers, setShowContainers] = useState(false);
  const [containerQuery, setContainerQuery] = useState("");
  const [iconDownloadOpen, setIconDownloadOpen] = useState(false);

  /** 容器列表（v1.51.16）：不过滤 status，已停止的容器同样可选；运行中 / 有图标优先 */
  const containerOptions = useMemo(() => {
    const q = containerQuery.trim().toLowerCase();
    return [...(containers || [])]
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.image || "").toLowerCase().includes(q))
      .sort((a, b) => {
        const run = (c: Container) => (c.status === "running" ? 0 : 1);
        const ico = (c: Container) => (c.icon ? 0 : 1);
        return run(a) - run(b) || ico(a) - ico(b) || a.name.localeCompare(b.name);
      });
  }, [containers, containerQuery]);

  /** 已有项目名集合（跨全部分组，小写；编辑态排除自身），用于容器灰显与重名校验 */
  const existingNames = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) {
      for (const a of g.apps || []) {
        if (initial && a.id === initial.id) continue;
        if (a.name) s.add(a.name.trim().toLowerCase());
      }
    }
    return s;
  }, [groups, initial]);

  /** 选择容器 → 一次填入 4 个字段；端口优先 LABELS WebUI 端口，回退真实宿主端口映射。
   *  v1.52.4：图标按项目（容器）名称从图标库匹配，不沿用容器列表里的容器图标。 */
  const applyContainerPreset = (c: Container) => {
    setName(c.name);
    const port = c.webuiPort || c.ports?.find((p) => p.host)?.host || "";
    setLanUrl(port ? `:${port}` : "");
    setUrl(c.webuiUrl || "");
    setIcon(iconMap[c.name.trim().toLowerCase()] || "");
    setShowContainers(false);
    setContainerQuery("");
  };

  // 名称全局唯一（跨所有分组不可重复，编辑态排除自身）
  const nameTaken = name.trim().length > 0 && existingNames.has(name.trim().toLowerCase());
  const canSave = name.trim().length > 0 && url.trim().length > 0 && !!groupId && !nameTaken;
  const confirm = () => {
    if (!canSave || !groupId) return;
    const app: NavAppItem = {
      id: initial?.id || genId(),
      name: name.trim(),
      // v1.52.4：图标留空时按项目名称从图标库匹配（手工粘贴 URL / 点选结果不动）
      icon: icon.trim() || iconMap[name.trim().toLowerCase()] || "",
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
    <>
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* v1.52.7：标题 + 归属两级「分区 → 该分区下的分组」，切换分区自动回落首分组 */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800 flex-shrink-0">{editing ? "编辑项目" : "添加新项目"}</h3>
          <div className="flex-1" />
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] text-slate-400">分区</span>
            <select
              value={zoneId}
              onChange={(e) => changeZone(e.target.value)}
              className="px-1.5 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 max-w-[100px]"
              title="项目所属分区"
            >
              {(zones || []).map((z) => (
                <option key={z.id} value={z.id}>{z.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <span className="text-[11px] text-slate-400">分组</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={zoneGroups.length === 0}
              className="px-1.5 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 max-w-[100px] disabled:opacity-40"
              title="该分区下的分组"
            >
              {zoneGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* v1.52.7：该分区下无分组时禁止保存（groupId 为空），引导先在分区与分组设置中新建 */}
          {zoneGroups.length === 0 && (
            <p className="text-[12px] text-amber-600">该分区下还没有分组，请先在「分区与分组设置」中新建分组</p>
          )}
          {/* 名称 */}
          <Field label="名称" required>
            <input
              className={inputCls + (nameTaken ? " border-rose-300 focus:ring-rose-500/30 focus:border-rose-400" : "")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的博客"
            />
            {nameTaken && <span className="block text-[11px] text-rose-500 mt-1">所有分组内项目名不可重复</span>}
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

          {/* 自托管开关 + 容器列表入口（v1.51.16：按钮只在勾选后显示） */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <input
                id="nav-self-hosted"
                type="checkbox"
                checked={selfHosted}
                onChange={(e) => {
                  setSelfHosted(e.target.checked);
                  if (!e.target.checked) setShowContainers(false);
                }}
                className="w-4 h-4 accent-fuchsia-600 flex-shrink-0"
              />
              <label htmlFor="nav-self-hosted" className="flex-1 text-[13px] text-slate-700 leading-5 cursor-pointer select-none">
                自托管
              </label>
              {selfHosted && (
                <button
                  type="button"
                  onClick={() => setShowContainers((v) => !v)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border border-fuchsia-200 bg-white text-fuchsia-600 hover:bg-fuchsia-50 flex-shrink-0"
                  title="显示容器列表（含已停止的容器），选择后自动填入名称 / 内网端口 / 外网链接 / 图标"
                >
                  <List size={12} /> 容器列表
                </button>
              )}
            </div>
            {selfHosted && showContainers && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
                <input
                  className={inputCls + " text-[12px]"}
                  value={containerQuery}
                  onChange={(e) => setContainerQuery(e.target.value)}
                  placeholder="搜索容器名称 / 镜像"
                />
                <div className="mt-1.5 max-h-44 overflow-y-auto space-y-1">
                  {containerOptions.length === 0 && (
                    <div className="px-2 py-3 text-center text-[11px] text-slate-400">
                      没有匹配的容器（引擎未连接或暂无容器）
                    </div>
                  )}
                  {containerOptions.map((c) => {
                    const port = c.webuiPort || c.ports?.find((p) => p.host)?.host || "";
                    // 该容器名已作为项目存在（跨全分组）→ 灰显禁用，提示已添加
                    const isAdded = existingNames.has(c.name.trim().toLowerCase());
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={isAdded}
                        onClick={() => applyContainerPreset(c)}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-left rounded-md border transition-colors ${
                          isAdded
                            ? "opacity-40 cursor-not-allowed border-transparent bg-slate-100"
                            : "hover:bg-fuchsia-50 border-transparent hover:border-fuchsia-100"
                        }`}
                        title={isAdded ? "该容器已添加" : "自动填入名称 / 内网端口 / 外网链接 / 图标"}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === "running" ? "bg-emerald-500" : "bg-slate-300"}`} />
                        <span className="flex-1 min-w-0 truncate text-[12px] text-slate-700">{c.name}</span>
                        {c.status !== "running" && <span className="text-[10px] text-slate-400 flex-shrink-0">已停止</span>}
                        {port && <span className="text-[10px] text-fuchsia-500 flex-shrink-0">:{port}</span>}
                        {!c.webuiUrl && <span className="text-[10px] text-amber-500 flex-shrink-0">需手填外网链接</span>}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 px-1 text-[10px] text-slate-400 leading-4">
                  含已停止的容器；选中后覆盖名称 / 内网链接 / 外网链接 / 图标，无 WebUI 地址的容器请手填外网链接。
                </div>
              </div>
            )}
          </div>

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

          {/* 图标（v1.51.15：复用堆栈 IconAutoComplete，输入名称自动匹配 / 点选写入 URL） */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="block text-xs text-slate-500">图标</span>
              <button
                type="button"
                onClick={() => setIconDownloadOpen(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] text-fuchsia-600 border border-fuchsia-200 rounded-md hover:bg-fuchsia-50"
                title="输入图片链接下载到导航图标库（未绑定目录时先绑定）"
              >
                <Download size={11} /> 从链接下载
              </button>
            </div>
            <IconAutoComplete
              value={icon}
              onChange={(val) => setIcon(val)}
              onPick={(urlValue) => setIcon(urlValue)}
              placeholder="输入图标名称自动匹配，或直接粘贴图片 URL"
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
      {/* 下载弹窗与项目弹窗平级，z-[1200] 覆盖在项目弹窗之上 */}
      {iconDownloadOpen && (
        <NavIconDownloadModal
          suggestedName={name.trim()}
          onDownloaded={(u) => setIcon(u)}
          onClose={() => setIconDownloadOpen(false)}
        />
      )}
    </>
  );
}
