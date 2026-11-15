/**
 * 「从链接下载图标」弹窗（v1.52.4 引入，v1.52.15 重构，v1.53.1 简化）：
 *  - 图标库目录 v1.53.1 起固定为服务端 <data>/图标（ICON_LIB_DIR），不再自由绑定；
 *  - 弹窗展示当前图库目录与图标数，目录不可读时仅提示错误（不再有「前往设置」跳转）；
 *  - 输入图片链接 + 名称（默认预填当前上下文名称：项目名称 / 服务名称 / 堆栈名称，可手动修改）
 *    → 下载写入图标库目录，同名自动匹配；
 *  - 下载成功可一键回填当前正在编辑的图标位（onDownloaded）；
 *  - v1.53.6：新增「SVG 代码」模式——粘贴完整 <svg>…</svg> 源码，服务端校验后保存为 .svg 文件；
 *    链接框里直接粘贴 SVG 源码会自动切到该模式，两种来源共用名称输入、结果预览与应用到项目。
 */
import { useEffect, useState } from "react";
import { Download, FolderOpen, Loader2, X } from "lucide-react";
import { downloadCustomIconApi, listCustomIconsApi, saveSvgIconApi } from "../api";
import type { CustomIconsPayload } from "../custom-icons";
import { useEscapeClose } from "../hooks/useEscapeClose";

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-fuchsia-500/30 focus:border-fuchsia-400 bg-white text-slate-700 disabled:bg-slate-100";

/** 从链接路径末段推断图标名（去扩展名），作为与项目名称匹配的键 */
function nameFromUrl(u: string): string {
  try {
    const last = new URL(u).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).replace(/\.[^.]+$/, "");
  } catch {
    return "";
  }
}

export function NavIconDownloadModal({
  suggestedName,
  onDownloaded,
  onClose,
}: {
  /** 默认名称（当前上下文：项目名称 / 服务名称 / 堆栈名称，便于下载后自动匹配，可手动修改） */
  suggestedName?: string;
  /** 下载成功后回填当前编辑中的图标位 */
  onDownloaded?: (url: string) => void;
  onClose: () => void;
}) {
  // v1.53.4：叠加在项目弹窗之上，后入栈优先——Esc 先关本弹窗，再按一次才关项目弹窗
  useEscapeClose(onClose);

  const [payload, setPayload] = useState<CustomIconsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // v1.53.6：链接下载 / SVG 代码两种来源，共用名称输入与结果预览
  const [mode, setMode] = useState<"url" | "svg">("url");
  const [url, setUrl] = useState("");
  const [svgCode, setSvgCode] = useState("");
  const [name, setName] = useState(suggestedName || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ url: string; file: string } | null>(null);

  useEffect(() => {
    let alive = true;
    listCustomIconsApi()
      .then((r) => alive && setPayload(r))
      .catch((e: any) => alive && setErr(e?.message || "读取图标库状态失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // dir 为 realpath 后的绝对路径；error 非空说明目录不可读，同样视为未就绪
  const bound = !!payload && payload.bound && !payload.error && !!payload.dir;

  /** 链接框里直接粘贴 SVG 源码时自动切到「SVG 代码」模式，避免被当成非法 URL */
  const onUrlChange = (v: string) => {
    if (/^\s*(?:<\?xml|<!--|<svg)/i.test(v)) {
      setMode("svg");
      setSvgCode(v);
      setUrl("");
      return;
    }
    setUrl(v);
  };

  /** 提交：URL 走下载通道；SVG 源码走 /api/custom-icons/svg 直接落盘为 .svg */
  const onSubmit = async () => {
    const isSvg = mode === "svg";
    if (isSvg && !svgCode.trim()) {
      setErr("请粘贴 SVG 代码");
      return;
    }
    if (!isSvg && !url.trim()) {
      setErr("请填写图标链接");
      return;
    }
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const finalName = name.trim() || (isSvg ? (suggestedName || "icon") : (nameFromUrl(url.trim()) || "icon"));
      const r = isSvg
        ? await saveSvgIconApi(svgCode.trim(), finalName)
        : await downloadCustomIconApi(url.trim(), finalName);
      setResult(r);
      setPayload(await listCustomIconsApi());
    } catch (e: any) {
      setErr(e?.message || (isSvg ? "保存 SVG 图标失败" : "下载图标失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <Download size={16} className="text-fuchsia-600" />
          <h3 className="text-base font-semibold text-slate-800">从链接下载图标</h3>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-[13px] text-slate-400 py-6">
              <Loader2 size={14} className="animate-spin" /> 读取图标库状态…
            </div>
          ) : (
            <>
              {/* v1.53.1：图标库目录固定 <data>/图标，恒已绑定；仅展示目录与图标数 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <FolderOpen size={12} /> 图标库目录
                </p>
                {bound ? (
                  <p className="text-[11px] text-emerald-600">
                    {payload?.entries.length || 0} 个图标 · {payload?.dir}
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-600 leading-4">图标库目录暂不可读。</p>
                )}
                {payload?.error && <p className="text-[11px] text-amber-600">{payload.error}</p>}
              </section>

              {/* 下载区：v1.53.6 起支持「链接下载」与「SVG 代码」两种来源 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600">下载图标</p>
                <div className="flex items-center gap-1 rounded-lg bg-slate-200/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => setMode("url")}
                    className={`flex-1 px-2 py-1 text-[12px] rounded-md ${mode === "url" ? "bg-white text-fuchsia-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    链接下载
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("svg")}
                    className={`flex-1 px-2 py-1 text-[12px] rounded-md ${mode === "svg" ? "bg-white text-fuchsia-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                  >
                    SVG 代码
                  </button>
                </div>
                {mode === "svg" ? (
                  <textarea
                    className={`${inputCls} font-mono text-[12px] leading-4`}
                    rows={6}
                    value={svgCode}
                    onChange={(e) => setSvgCode(e.target.value)}
                    placeholder={'粘贴完整 SVG 代码，例如 <svg xmlns="http://www.w3.org/2000/svg" …>…</svg>'}
                    disabled={!bound}
                  />
                ) : (
                  <input
                    className={inputCls}
                    value={url}
                    onChange={(e) => onUrlChange(e.target.value)}
                    placeholder="https://example.com/icon.png（也可直接粘贴 SVG 代码）"
                    disabled={!bound}
                  />
                )}
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`图标名称（默认${suggestedName ? `「${suggestedName}」` : (mode === "svg" ? "icon" : "取链接文件名")}，可手动修改）`}
                  disabled={!bound}
                />
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!bound || busy || (mode === "svg" ? !svgCode.trim() : !url.trim())}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] text-white bg-fuchsia-600 rounded-lg hover:bg-fuchsia-700 disabled:opacity-40"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {mode === "svg" ? "保存为 SVG 文件" : "下载到图标库"}
                </button>
                <p className="text-[11px] text-slate-400 leading-4">
                  链接支持 png / jpg / gif / svg / webp / ico，单张 ≤10MB；「SVG 代码」模式粘贴完整源码即可生成 .svg 文件（含脚本 / 事件 / 外部引用的会被拒绝）。重名自动追加序号，不会覆盖已有图标。同名项目 / 服务 / 堆栈会自动匹配该图标。
                </p>
              </section>

              {err && <p className="text-[12px] text-rose-600 px-1">{err}</p>}

              {result && (
                <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 flex items-center gap-3">
                  <img src={result.url} alt="" className="w-10 h-10 object-contain rounded" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-emerald-700 truncate">已保存：{result.file}</p>
                    <p className="text-[11px] text-emerald-600">同名项目 / 服务 / 堆栈会自动匹配该图标</p>
                  </div>
                  {onDownloaded && (
                    <button
                      type="button"
                      onClick={() => {
                        onDownloaded(result.url);
                        onClose();
                      }}
                      className="px-2.5 py-1.5 text-[12px] text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 flex-shrink-0"
                    >
                      应用到项目
                    </button>
                  )}
                </section>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
