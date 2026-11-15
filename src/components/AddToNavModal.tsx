/**
 * 容器页右键「添加到导航页」弹窗（v1.53.7）。
 *
 * - 归属两级：分区 → 该分区下的分组（切换分区自动回落首分组），与 NavAppModal 一致；
 * - 字段从容器预填（名称 / `:端口` 内网简写 / LABELS 外网 URL），可手动修改；
 * - 弹窗交互遵循项目长期约定：点外部不关、仅 X / 取消 / 确定可关，Esc 走共享栈。
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { Container, NavAppItem, NavZone } from "../types";
import { useEscapeClose } from "../hooks/useEscapeClose";
import {
  buildNavAppFromContainer,
  defaultNavFieldsFromContainer,
} from "../nav-from-container";

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 focus:border-fuchsia-400 bg-white text-slate-700";

export function AddToNavModal({
  container,
  zones,
  onSave,
  onClose,
}: {
  container: Container;
  zones: NavZone[];
  /** 真实落盘（父级调 /api/nav-groups）；抛错时弹窗内展示，不静默关闭 */
  onSave: (groupId: string, app: NavAppItem) => Promise<void>;
  onClose: () => void;
}) {
  useEscapeClose(onClose);

  const safeZones = zones || [];
  const firstZone = safeZones.find((z) => (z.groups || []).length > 0) || safeZones[0];
  const [zoneId, setZoneId] = useState(firstZone?.id || "");
  const [groupId, setGroupId] = useState(firstZone?.groups?.[0]?.id || "");
  const initial = defaultNavFieldsFromContainer(container);
  const [name, setName] = useState(initial.name);
  const [lanUrl, setLanUrl] = useState(initial.lanUrl);
  const [url, setUrl] = useState(initial.url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const activeZone = safeZones.find((z) => z.id === zoneId) || null;
  const zoneGroups = activeZone?.groups || [];
  const changeZone = (nextZoneId: string) => {
    setZoneId(nextZoneId);
    setGroupId(safeZones.find((z) => z.id === nextZoneId)?.groups?.[0]?.id || "");
  };

  /** 名称全局唯一（跨全部分区/分组，与 NavAppModal 同规则） */
  const existingNames = useMemo(() => {
    const s = new Set<string>();
    for (const z of safeZones) {
      for (const g of z.groups || []) {
        for (const a of g.apps || []) {
          if (a.name) s.add(a.name.trim().toLowerCase());
        }
      }
    }
    return s;
  }, [safeZones]);
  const nameTaken = !!name.trim() && existingNames.has(name.trim().toLowerCase());
  const hasUrl = !!lanUrl.trim() || !!url.trim();
  const canSave = !!groupId && !!name.trim() && !nameTaken && hasUrl && !busy;

  const confirm = async () => {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    const app = buildNavAppFromContainer(container, { name, lanUrl, url });
    try {
      await onSave(groupId, app);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "添加失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">添加到导航页</h3>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[12px] text-slate-500 leading-5">
            <div className="font-medium text-slate-700 truncate">{container.name}</div>
            <div className="truncate">镜像：{container.image || "—"}</div>
            <div>状态：{container.status}</div>
          </div>

          {safeZones.length === 0 ? (
            <p className="text-[13px] text-amber-600 leading-5">
              导航页尚无分区或分组。请先到「导航页」新建一个分区（会自动带一个默认分组），再回来添加。
            </p>
          ) : (
            <>
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">项目名称 <span className="text-rose-500">*</span></span>
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="导航卡片上显示的名称" />
                {nameTaken && <span className="block mt-1 text-[11px] text-rose-500">该名称已存在于导航页，请换一个</span>}
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs text-slate-500 mb-1">分区 <span className="text-rose-500">*</span></span>
                  <select className={inputCls} value={zoneId} onChange={(e) => changeZone(e.target.value)}>
                    {safeZones.map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs text-slate-500 mb-1">分组 <span className="text-rose-500">*</span></span>
                  <select className={inputCls} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                    {zoneGroups.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                  {zoneGroups.length === 0 && (
                    <span className="block mt-1 text-[11px] text-amber-600">该分区下没有分组</span>
                  )}
                </label>
              </div>

              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">内网链接（支持 <code>:端口</code> 简写）</span>
                <input className={inputCls} value={lanUrl} onChange={(e) => setLanUrl(e.target.value)} placeholder=":8080" />
              </label>
              <label className="block">
                <span className="block text-xs text-slate-500 mb-1">外网链接</span>
                <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
              </label>
              <p className="text-[11px] text-slate-400 leading-4">
                内外网链接至少填一个；卡片会按访问环境自动选择，图标留空时按项目名称自动匹配图标库。
              </p>
              {!hasUrl && (
                <p className="text-[11px] text-amber-600 leading-4">
                  该容器未识别到 WebUI 端口或外网链接，请手动填写其中一个。
                </p>
              )}
            </>
          )}
          {err && <p className="text-[12px] text-rose-600">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 text-[13px] text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
          >
            取消
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!canSave}
            className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] text-white bg-fuchsia-600 rounded-lg hover:bg-fuchsia-700 disabled:opacity-40"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} 添加到导航页
          </button>
        </div>
      </div>
    </div>
  );
}
