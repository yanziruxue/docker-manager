/**
 * 导航页「从链接下载图标」弹窗（v1.52.4）：
 *  - 未绑定导航图标库时先绑定（服务端绝对路径，独立于 Docker / 堆栈图标库）；
 *  - 已绑定后输入图片链接 + 名称（建议与项目名称同名）→ 下载写入图标库目录；
 *  - 下载成功可一键回填当前正在编辑的项目图标。
 */
import { useEffect, useState } from "react";
import { Download, FolderOpen, Loader2, X } from "lucide-react";
import { bindNavIconDirApi, downloadNavIconApi, listNavIconsApi } from "../api";
import type { CustomIconsPayload } from "../custom-icons";

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
  /** 默认名称（当前项目名，便于下载后自动匹配） */
  suggestedName?: string;
  /** 下载成功后回填当前项目图标 */
  onDownloaded?: (url: string) => void;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<CustomIconsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirInput, setDirInput] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState(suggestedName || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ url: string; file: string } | null>(null);

  useEffect(() => {
    let alive = true;
    listNavIconsApi()
      .then((r) => {
        if (!alive) return;
        setPayload(r);
        setDirInput(r.dir || "");
      })
      .catch((e: any) => alive && setErr(e?.message || "读取图标库状态失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // dir 为 realpath 后的绝对路径；error 非空说明目录不可读，同样需重新绑定
  const bound = !!payload && payload.bound && !payload.error && !!payload.dir;

  const onBind = async () => {
    setBusy(true);
    setErr("");
    try {
      const next = await bindNavIconDirApi(dirInput.trim());
      setPayload(next);
      if (next.error) setErr(next.error);
    } catch (e: any) {
      setErr(e?.message || "绑定图标库失败");
    } finally {
      setBusy(false);
    }
  };

  const onUnbind = async () => {
    setBusy(true);
    setErr("");
    try {
      setDirInput("");
      setPayload(await bindNavIconDirApi(""));
    } catch (e: any) {
      setErr(e?.message || "解绑图标库失败");
    } finally {
      setBusy(false);
    }
  };

  const onDownload = async () => {
    if (!url.trim()) {
      setErr("请填写图标链接");
      return;
    }
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const finalName = name.trim() || nameFromUrl(url.trim()) || "icon";
      const r = await downloadNavIconApi(url.trim(), finalName);
      setResult(r);
      setPayload(await listNavIconsApi());
    } catch (e: any) {
      setErr(e?.message || "下载图标失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
              {/* 绑定区：与 Docker / 堆栈图标库完全独立 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1">
                  <FolderOpen size={12} /> 导航页图标库目录
                </p>
                <p className="text-[11px] text-slate-400 leading-4">
                  仅用于导航页，与 Docker / 堆栈图标库相互独立。请填写<strong>运行本服务的机器上</strong>已存在的绝对路径，服务账号需有写入权限。
                </p>
                <input
                  className={inputCls}
                  value={dirInput}
                  onChange={(e) => setDirInput(e.target.value)}
                  placeholder="/opt/dockermanagementyanzi/config/nav-icons"
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={onBind}
                    disabled={busy}
                    className="px-3 py-1.5 text-[12px] text-white bg-fuchsia-600 rounded-lg hover:bg-fuchsia-700 disabled:opacity-40"
                  >
                    {busy ? "处理中…" : bound ? "更换目录" : "检测并绑定"}
                  </button>
                  {bound && (
                    <button
                      type="button"
                      onClick={onUnbind}
                      disabled={busy}
                      className="px-3 py-1.5 text-[12px] text-slate-500 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40"
                    >
                      解绑
                    </button>
                  )}
                  {bound && (
                    <span className="text-[11px] text-emerald-600">已绑定 · {payload?.entries.length || 0} 个图标</span>
                  )}
                </div>
                {payload?.error && <p className="text-[11px] text-amber-600">{payload.error}</p>}
              </section>

              {/* 下载区：仅在已绑定时可用 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2">
                <p className="text-xs font-medium text-slate-600">下载图标</p>
                <input
                  className={inputCls}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/icon.png"
                  disabled={!bound}
                />
                <input
                  className={inputCls}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="图标名称（与项目名称同名即可自动匹配，留空取链接文件名）"
                  disabled={!bound}
                />
                <button
                  type="button"
                  onClick={onDownload}
                  disabled={!bound || busy || !url.trim()}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] text-white bg-fuchsia-600 rounded-lg hover:bg-fuchsia-700 disabled:opacity-40"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} 下载到图标库
                </button>
                {!bound && <p className="text-[11px] text-amber-600">请先在上方绑定图标库目录</p>}
                <p className="text-[11px] text-slate-400 leading-4">
                  支持 png / jpg / gif / svg / webp / ico，单张 ≤2MB；重名自动追加序号，不会覆盖已有图标。
                </p>
              </section>

              {err && <p className="text-[12px] text-rose-600 px-1">{err}</p>}

              {result && (
                <section className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 flex items-center gap-3">
                  <img src={result.url} alt="" className="w-10 h-10 object-contain rounded" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-emerald-700 truncate">已保存：{result.file}</p>
                    <p className="text-[11px] text-emerald-600">同名项目会自动匹配该图标</p>
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
