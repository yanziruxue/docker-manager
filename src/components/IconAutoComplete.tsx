import React, { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "./UI";
import { listCustomIconsApi, listStackIconsApi } from "../api";

/**
 * 图标输入框「输入名称自动匹配」（v1.50.33）：参考标签选择器交互——
 * 聚焦或输入时实时过滤图库（自定义图标目录 + 本堆栈 icon/ 文件夹），
 * 下拉点选即写入图标 URL；已有 URL / 内嵌 SVG 时不弹补全，避免干扰。
 */

interface IconLibEntry {
  name: string; // 原始文件名（含扩展名）
  url: string; // 取图 URL
  stem: string; // 去扩展名小写（匹配键）
}

export function IconAutoComplete({
  value,
  onChange,
  onPick,
  engineId,
  stackName,
  placeholder,
  className = "",
}: {
  value: string;
  /** 直接输入变化（URL / SVG / 名称）—— 透传给上层 handleIconInputChange */
  onChange: (val: string) => void;
  /** 从下拉点选图标：直接写入最终 URL */
  onPick: (url: string) => void;
  engineId?: string;
  stackName?: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<IconLibEntry[]>([]);
  const [loadedFor, setLoadedFor] = useState<string>("");
  const rootRef = useRef<HTMLDivElement>(null);

  // 是否把当前文本当「名称查询」：空值（聚焦看全部）/ 纯名称；URL、data URI、SVG 源码不弹补全
  const isNameQuery =
    value.length === 0 || (!/[:/<]/.test(value) && value.length <= 80);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const load = async () => {
    const key = `${engineId || ""}|${stackName || ""}`;
    if (loadedFor === key) return;
    setLoadedFor(key);
    setLoading(true);
    try {
      const [custom, files] = await Promise.all([
        // v1.51.15：自定义图标库是全局资源，导航页无 engine 上下文也要能拉到
        listCustomIconsApi().catch(() => null),
        engineId && stackName
          ? listStackIconsApi(engineId, stackName).catch(() => [] as string[])
          : Promise.resolve([] as string[]),
      ]);
      const list: IconLibEntry[] = [];
      const seen = new Set<string>();
      const push = (name: string, url: string) => {
        const stem = name.replace(/\.[^.]+$/, "").toLowerCase();
        if (seen.has(stem)) return; // 自定义优先，同名兜底；按 stem 去重
        seen.add(stem);
        list.push({ name, url, stem });
      };
      (custom?.entries || []).forEach((e) => push(e.name, e.url));
      files.forEach((f) =>
        push(f, `/api/stack-icons/${encodeURIComponent(stackName || "")}/${encodeURIComponent(f)}`)
      );
      setEntries(list);
    } finally {
      setLoading(false);
    }
  };

  const onFocus = () => {
    setOpen(true);
    void load();
  };

  const q = value.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => e.stem.includes(q) || e.name.toLowerCase().includes(q))
    : entries;

  const pick = (url: string) => {
    onPick(url);
    setOpen(false);
  };

  return (
    <div className="relative flex-1" ref={rootRef}>
      <Input
        value={value}
        onChange={(val) => {
          onChange(val);
          if (val && isNameQuery) setOpen(true);
          else setOpen(false);
        }}
        onFocus={onFocus}
        placeholder={placeholder}
        className={className}
      />
      {open && isNameQuery && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-lg border border-slate-200 shadow-lg overflow-hidden">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> 读取图库...
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-400 text-center">
              图标库为空：可在「设置中心 → 页面设置」绑定图标文件夹{engineId && stackName ? "，或上传图标存入本堆栈 icon/ 目录" : ""}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-400 text-center">无匹配图标</div>
          ) : (
            <div className="max-h-60 overflow-y-auto py-1">
              {filtered.map((e) => (
                <button
                  key={e.url}
                  type="button"
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => pick(e.url)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                  title={e.name}
                >
                  <img src={e.url} alt="" className="w-5 h-5 rounded flex-shrink-0" />
                  <span className="truncate">{e.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
