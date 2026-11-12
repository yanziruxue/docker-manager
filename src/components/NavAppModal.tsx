/**
 * 添加 / 编辑导航项目弹窗（v1.51.9 重构）：单一表单，字段按用户清单固定为
 * 分组（下拉切换）/ 名称 / 描述 / ☐自托管 / 内网链接（仅勾选自托管时显示）/ 外网链接 /
 * 图标 / 备注。
 * - 「自托管」复选框替代旧版双类型 tab：勾选=self（内外网分区跳转），不勾选=ext（点击直接打开外网链接）。
 * - 「描述」写 description（卡片副标题）；「备注」写 remark（hover 提示），两者语义分离且旧数据回落兼容。
 * - v1.51.14：底部高级字段折叠区已移除，主表单仅保留用户清单内字段；标题颜色 / 链接备链 /
 *   公开标记 / 图标缩放改为保存时从 initial 原样透传，既有数据不丢，表单不再提供编辑入口。
 * - v1.51.15：图标区统一改用堆栈图标逻辑（IconAutoComplete：输入名称自动匹配图库、点选写入 URL），
 *   移除智能匹配 / 已缓存徽标 / 引用 Docker 容器图标 / 图标预览等自研功能。
 * 保存经 onSave(groupId, app) 由 NavPage 直接落盘；编辑态可经 onDelete(appId) 删除项目（v1.51.11）。
 */
import { useState } from "react";
import { Globe, Trash2, X } from "lucide-react";
import type { NavAppItem, NavGroup } from "../types";
import { IconAutoComplete } from "./IconAutoComplete";

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
  initial,
  initialGroupId,
  onSave,
  onDelete,
  onClose,
}: {
  groups: NavGroup[];
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

          {/* 图标（v1.51.15：复用堆栈 IconAutoComplete，输入名称自动匹配 / 点选写入 URL） */}
          <div>
            <span className="block text-xs text-slate-500 mb-1">图标</span>
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
  );
}
