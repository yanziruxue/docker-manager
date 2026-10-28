import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Dashboard } from "./pages/Dashboard";
import { Containers } from "./pages/Containers";
import { Stacks } from "./pages/Stacks";
import { Images } from "./pages/Images";
import { Volumes } from "./pages/Volumes";
import { NetworkManager } from "./pages/NetworkManager";
import { Settings } from "./pages/Settings";
import { Notifications } from "./pages/Notifications";
import {
  fetchEngines,
  fetchActiveEngineId,
  setActiveEngineIdApi,
  fetchEngineContainers,
  fetchEngineImages,
  fetchEngineVolumes,
  fetchEngineStacks,
  fetchEngineActivity,
  fetchSettings,
  saveSettingsApi,
  checkUpdateApi,
  applyUpdateApi,
  fetchAppVersion,
  getAuthInitStatus,
  getMe,
  ping,
  logout,
  ApiError,
  checkImageUpdatesApi,
  getImageUpdateStatusApi,
  type AuthUser,
} from "./api";
import { waitForRestartAndReload } from "./lib/restart-wait";
import { SetupWizard } from "./components/auth/SetupWizard";
import { LoginPage } from "./components/auth/LoginPage";
import {
  transformContainers,
  transformImages,
  transformVolumes,
  transformStacks,
  transformActivityLogs,
} from "./transforms";
import type { PageKey, Container, DockerImage, DockerVolume, DockerEngine, Stack, SystemSettings, ActivityLog, EngineResourceStats, UpdateInfo, ImageUpdateDetail, ImageUpdateSummaryView, ImageUpdateStatusView } from "./types";

/** 把后端检查明细摊平成 { repo:tag -> 是否有更新 }；多 tag 镜像的每个标签都写入，保证表格逐行能匹配 */
function toRefMap(details: ImageUpdateDetail[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const d of details) {
    const refs = d.refs && d.refs.length > 0 ? d.refs : [d.image];
    for (const ref of refs) out[ref] = d.hasUpdate;
  }
  return out;
}

export default function App() {
  const [page, setPage] = useState<PageKey>("dashboard");

  // 引擎状态
  const [engines, setEngines] = useState<DockerEngine[]>([]);
  const [activeEngineId, setActiveEngineIdState] = useState<string>("");
  const activeEngine = engines.find((e) => e.id === activeEngineId);

  // 引擎数据
  const [containers, setContainers] = useState<Container[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [volumes, setVolumes] = useState<DockerVolume[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [resourceStats, setResourceStats] = useState<EngineResourceStats | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  // 镜像版本检查结果（进页面读缓存，点「检查更新」重算）；byRef 以 repo:tag 为键匹配表格行
  const [imageUpdateStatus, setImageUpdateStatus] = useState<ImageUpdateStatusView | null>(null);
  const [imageUpdateError, setImageUpdateError] = useState<string | null>(null);
  // 应用自身（OTA）更新信息：**单一数据源** —— 同时驱动全局侧边栏「设置中心」角标
  // 与「设置中心 → 系统更新」页展示（进入页面即显示已检测到的更新，无需再手动点「检查更新」）
  const [appUpdateInfo, setAppUpdateInfo] = useState<UpdateInfo | null>(null);
  /** 后端实际运行的版本号（侧栏展示用，避免浏览器缓存旧前端导致版本显示滞后） */
  const [runtimeVersion, setRuntimeVersion] = useState("");
  const appUpdateAvailable = !!appUpdateInfo?.hasUpdate;
  // 最新 settings 引用：6 小时定时轮询的 doCheck 闭包需读取用户最新保存的 autoUpdate / ignoredVersion
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ============ 鉴权门卫 ============
  // authState: loading(启动检测) → setup(首次初始化) / login(未登录) / reinit(账号待重新设置) / authed(已登录)
  const [authState, setAuthState] = useState<"loading" | "setup" | "login" | "reinit" | "authed">("loading");
  const [me, setMe] = useState<AuthUser | null>(null);
  /** 登录页顶部提示（账号重新设置完成后，引导用新凭据登录） */
  const [loginNotice, setLoginNotice] = useState<string | undefined>(undefined);
  /** 安装时选定的服务运行账户（非空 ⇒ 初始设置页锁定用户名不可改，v1.40.6） */
  const [lockedUsername, setLockedUsername] = useState<string>("");

  // 启动检测：并发判断「是否已初始化」与「当前是否已登录」
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [init, meRes] = await Promise.all([
          getAuthInitStatus().catch(() => ({ initialized: false, needsReinit: false, serviceUsername: "" })),
          getMe().catch(() => null),
        ]);
        if (cancelled) return;
        // 老凭据版本升级后：必须重走一遍「用户名 + 密码 + 找回码」设置。
        // 已有会话说明此前已用旧凭据登录过，可直接进入重设表单；否则先回登录页。
        if (init.needsReinit) {
          if (meRes) setMe(meRes);
          setAuthState(meRes ? "reinit" : "login");
          return;
        }
        if (meRes) {
          setMe(meRes);
          setAuthState("authed");
        } else if (!init.initialized) {
          setAuthState("setup");
          // v1.40.6：记录安装时选定的服务运行账户，初始设置页据此锁定用户名
          setLockedUsername(init.serviceUsername || "");
        } else {
          setAuthState("login");
        }
      } catch {
        if (!cancelled) setAuthState("login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 运行中会话失效（任意非鉴权接口返回 401）→ 回到登录页
  useEffect(() => {
    const onUnauth = () => {
      setMe(null);
      setAuthState("login");
    };
    window.addEventListener("auth:unauthorized", onUnauth);
    return () => window.removeEventListener("auth:unauthorized", onUnauth);
  }, []);

  // 后端兜底返回 403 REINIT_REQUIRED（账号待重新设置）→ 切到「账号重新设置」流程
  useEffect(() => {
    const onReinit = () => {
      setAuthState((s) => (s === "authed" ? "reinit" : s));
    };
    window.addEventListener("auth:reinit-required", onReinit);
    return () => window.removeEventListener("auth:reinit-required", onReinit);
  }, []);

  // 会话心跳：服务端为「空闲超时（仅真实活动续期）」—— 续期只发生在真实用户活动触发的 /api/auth/me
  // （活动节流 getMe，服务端 renewSession 滑动）；业务请求 / 后台数据轮询 / WS 握手经 requireAuth →
  // getSessionUser 只做只读校验、不续期，因此页面后台轮询不会维持会话，空闲满 TTL 仍能过期。
  // 前端策略（**纯服务端权威，杜绝误踢**）：
  //  - 监听真实用户活动（mousemove/keydown/pointerdown/wheel/touchstart），活动时节流发 /api/auth/me 续期；
  //  - 低频（60s）探活 /api/auth/ping（只读、不续期）：会话真过期时服务端返回 401，
  //    经全局 401 兜底（auth:unauthorized）回到登录页 —— 人离开页面开着也能自动登出；
  //  - **不再用前端本地计时主动登出**：前端无法可靠感知服务端是否仍在续期，本地计时误判会导致
  //    「正在操作却被踢」（服务端因业务请求持续续期，但前端 lastActivity 已陈旧）。
  //  唯一登出触发条件 = 服务端 401（任意业务接口或 ping 探活）。
  useEffect(() => {
    if (authState !== "authed") return;
    let stopped = false;
    const lastRenew = { t: 0 }; // 最近一次活动续期请求时刻（节流用）
    const markActivity = () => {
      const now = Date.now();
      // 真实活动 → 触发续期（节流到 30s/次，避免 mousemove 高频发请求）
      if (now - lastRenew.t > 30000) {
        lastRenew.t = now;
        getMe().catch(() => {
          /* 续期失败忽略；若会话已过期（401）由 notifyUnauthorized 全局派发 auth:unauthorized 登出 */
        });
      }
    };
    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "pointerdown",
      "wheel",
      "touchstart",
    ];
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));
    // 低频探活（只读、不续期）：人离开页面开着时，会话真过期后服务端返回 401 → 自动登出
    const pingId = setInterval(() => {
      if (stopped) return;
      ping().catch(() => {
        /* 401 由全局 auth:unauthorized 兜底处理，这里忽略 */
      });
    }, 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(pingId);
      events.forEach((ev) => window.removeEventListener(ev, markActivity));
    };
  }, [authState]);

  const handleAuthDone = (user: AuthUser) => {
    setLoginNotice(undefined);
    setMe(user);
    // 老凭据版本账号（needsReinit）：登录成功后不进入应用，先重走一遍账号设置
    setAuthState(user.needsReinit ? "reinit" : "authed");
  };

  /** 账号重新设置完成：后端已作废全部会话 → 回登录页，用新凭据重新登录 */
  const handleReinitDone = () => {
    setMe(null);
    setLoginNotice("账号已重新设置，请使用新的用户名和密码登录");
    setAuthState("login");
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* 忽略登出请求错误，仍强制回登录页 */
    }
    setMe(null);
    setLoginNotice(undefined);
    setAuthState("login");
  };

  // 侧边栏折叠状态（localStorage 持久化）
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch { /* ignore */ }
      return next;
    });
  };

  // 通知已读状态（localStorage 持久化，按通知 ID 记录）
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("readNotificationIds");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const unreadCount = activities.filter((a) => !readNotificationIds.has(a.id)).length;

  const pageTitles: Record<PageKey, { title: string; breadcrumb: string[] }> = {
    dashboard: { title: "仪表盘", breadcrumb: ["首页", "仪表盘"] },
    containers: { title: "容器管理", breadcrumb: ["首页", "容器管理"] },
    stacks: { title: "堆栈管理", breadcrumb: ["首页", "堆栈管理"] },
    images: { title: "镜像管理", breadcrumb: ["首页", "镜像管理"] },
    volumes: { title: "数据卷管理", breadcrumb: ["首页", "数据卷管理"] },
    networks: { title: "网络管理", breadcrumb: ["首页", "网络管理"] },
    notifications: { title: "通知中心", breadcrumb: ["首页", "通知中心"] },
    settings: { title: "设置中心", breadcrumb: ["首页", "设置中心"] },
  };

  // 自动更新：检测到新版后自动下载应用，并监听后端重启后刷新前端（避免停留在旧前端 bundle）
  // ⚠️ 此处 `applyUpdateApi()` 刚被调用，二进制可能仍在下载（旧进程会正常响应很久），
  //    故传 `blindReloadAfterMs: null` **不做盲刷新**：刷新只由「观测到失联后恢复」或
  //    「探活返回 403 REINIT_REQUIRED（新进程铁证）」触发。详见 src/lib/restart-wait.ts。
  const restartWaitRef = useRef<(() => void) | null>(null);
  const triggerAutoUpdate = () => {
    applyUpdateApi().catch(() => {
      /* fire-and-forget：失败由更新状态端点反映，此处静默 */
    });
    // 重复触发时先取消上一个等待循环，避免同一页面叠出多个探测轮询
    restartWaitRef.current?.();
    restartWaitRef.current = waitForRestartAndReload({ blindReloadAfterMs: null });
  };
  // 卸载时收掉等待循环。
  // ⚠️ 单独一个「仅挂载/卸载」的 effect：**不能**并进下面那个依赖 authState 的 effect ——
  //    升级期间若因 403 切到「账号重新设置」态，该 effect 会重跑并取消等待，反而丢掉刷新。
  useEffect(() => {
    return () => {
      restartWaitRef.current?.();
      restartWaitRef.current = null;
    };
  }, []);

  // 初始化：加载引擎列表、活跃引擎 ID、设置中心
  // 依赖 authState：仅在登录态就绪后拉取（未登录时 /api 一律 401，提前拉取会静默失败且登录后不会重试）
  useEffect(() => {
    if (authState !== "authed") return;
    let updateTimer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const [list, settingsData, versionInfo] = await Promise.all([
          fetchEngines(),
          fetchSettings().catch(() => null),
          fetchAppVersion().catch(() => null),
        ]);
        setEngines(list);
        if (settingsData) setSettings(settingsData);
        if (versionInfo?.version) setRuntimeVersion(versionInfo.version);
        // 登录后默认显示页面（v1.42.9）：仅在登录态就绪、settings 已加载时跳转一次，
        // 不覆盖用户当次会话内的手动导航（authState 变化才会重跑本 effect）。
        const VALID_PAGES: PageKey[] = [
          "dashboard", "containers", "stacks", "images",
          "volumes", "networks", "notifications", "settings",
        ];
        const dp = settingsData?.modal?.defaultPage;
        if (dp && VALID_PAGES.includes(dp as PageKey)) {
          setPage(dp as PageKey);
        }
        // 自动检查更新：覆盖「网页刷新 / 后端启动 / 每 6 小时」三触发条件
        // 挂载即查一次（启动/页面加载）；之后每 6 小时周期轮询（长开页面也能及时发现更新）
        if (settingsData?.update?.autoCheck) {
          const doCheck = () =>
            checkUpdateApi()
              .then((info) => {
                const upd = settingsRef.current?.update;
                const ignored = upd?.ignoredVersion || "";
                // 被忽略的版本不提示（侧边栏角标与「系统更新」页均不展示）
                const show = info.hasUpdate && info.latestVersion !== ignored;
                setAppUpdateInfo(show ? info : null);
                if (show && upd?.autoUpdate) {
                  // 自动更新：触发后端下载应用（进度与重启刷新由 triggerAutoUpdate 接管）
                  triggerAutoUpdate();
                }
              })
              .catch(() => {
                /* 网络不可达等：静默，角标保持隐藏 */
              });
          doCheck();
          updateTimer = setInterval(doCheck, 6 * 60 * 60 * 1000);
        }
        try {
          const activeId = await fetchActiveEngineId();
          setActiveEngineIdState(activeId);
        } catch {
          if (list.length > 0) {
            setActiveEngineIdState(list[0].id);
          }
        }
      } catch (err) {
        console.error("加载引擎列表失败:", err);
      }
    })();
    return () => {
      if (updateTimer) clearInterval(updateTimer);
    };
  }, [authState]);

  // 活跃引擎变化时拉取数据
  const loadEngineData = useCallback(async (engineId: string) => {
    if (!engineId) return;
    setDataLoading(true);
    setDataError(null);
    try {
      const [rawContainers, rawImages, rawVolumes, rawStacks, rawActivities] = await Promise.all([
        fetchEngineContainers(engineId).catch(() => []),
        fetchEngineImages(engineId).catch(() => []),
        fetchEngineVolumes(engineId).catch(() => ({ Volumes: [] })),
        fetchEngineStacks(engineId).catch(() => []),
        fetchEngineActivity(engineId).catch(() => []),
      ]);
      const xfContainers = transformContainers(rawContainers);

      // 交叉引用：堆栈 WebUI Labels 的图标/WebUI 地址/标签 传导到对应容器
      // 匹配规则（按优先级）：
      //   1. serviceName 与容器名精确匹配（compose 中显式指定 container_name）
      //   2. compose 默认命名 <project>-<service> 或 <project>-<service>-<index>
      // 标签按 id 对齐全局标签库：重命名/改色后展示层即时同步，被删除的标签自动失效
      const tagLibrary = settingsRef.current?.tags || [];
      const resolveTag = (t: any) => (t && tagLibrary.find((lib: any) => lib.id === t.id)) || null;
      const xfStacks = transformStacks(rawStacks);
      for (const st of xfStacks) {
        if (!st.webuiLabels || st.webuiLabels.length === 0) continue;
        for (const label of st.webuiLabels) {
          // 按标签库刷新该服务条目上的标签快照（重命名/改色/删除即时生效）
          if (Array.isArray(label.tags)) {
            label.tags = label.tags
              .map(resolveTag)
              .filter((t: any): t is { id: string; name: string; color: string } => !!t);
          }
          if (!label.iconUrl && !label.webuiUrl && (!label.tags || label.tags.length === 0)) continue;
          const matched = xfContainers.filter((c) =>
            c.name === label.serviceName ||
            c.name === `${st.name}-${label.serviceName}` ||
            new RegExp(`^${st.name}-${label.serviceName}-\\d+$`).test(c.name)
          );
          for (const c of matched) {
            if (label.iconUrl) c.icon = label.iconUrl;
            if (label.webuiUrl) c.webuiUrl = label.webuiUrl;
            // 标签合并去重（同 id 只保留一个）
            if (label.tags && label.tags.length > 0) {
              const exist = new Set((c.tags || []).map((t) => t.id));
              c.tags = [...(c.tags || []), ...label.tags.filter((t: any) => !exist.has(t.id))];
            }
          }
        }
      }

      // 交叉引用：标记容器所属堆栈（stackId），供容器管理页「堆栈」列显示
      // 匹配规则（v1.43.29 起按可靠性排序）：
      //   ① 真实容器短 id 精确匹配（最可靠，compose container_name 自定义也能命中）
      //   ② 真实容器名精确匹配（同上）
      //   ③~⑤ 名称推断回退（旧数据兼容）：服务名 / <project>-<service> / <project>-<service>-<index>
      for (const st of xfStacks) {
        if (!st.containers || st.containers.length === 0) continue;
        for (const svc of st.containers) {
          const matched = xfContainers.filter((c) =>
            (svc.containerId ? c.id === svc.containerId : false) ||
            (svc.containerName ? c.name === svc.containerName : false) ||
            c.name === svc.name ||
            c.name === `${st.name}-${svc.name}` ||
            new RegExp(`^${st.name}-${svc.name}-\\d+$`).test(c.name)
          );
          for (const c of matched) c.stackId = st.id;
        }
      }

      // 交叉引用：解析容器镜像名（c.Image 可能返回 sha256 摘要而非镜像名）
      const xfImages = transformImages(rawImages);
      for (const c of xfContainers) {
        if (c.image && c.image.startsWith("sha256:")) {
          // 通过 imageId 匹配镜像，用 repository:tag 替换 sha256
          const matchedImg = xfImages.find((img) => {
            if (!c.imageId) return false;
            const rawId = c.imageId.replace("sha256:", "");
            return rawId.startsWith(img.id) || img.sha256 === rawId;
          });
          if (matchedImg) {
            c.image = `${matchedImg.repository}:${matchedImg.tag}`;
          }
        }
      }
      setContainers(xfContainers);

      // 交叉引用：填充镜像的关联容器名称（名称 + ID 双匹配）
      const containersForRef = xfContainers;
      for (const img of xfImages) {
        img.associatedContainers = containersForRef
          .filter((c) => {
            // 名称匹配：容器 image 字段包含镜像仓库名
            if (c.image.includes(img.repository)) return true;
            // ID 回退匹配：容器的 imageId 以镜像 sha256 开头
            if (c.imageId) {
              const rawId = c.imageId.replace("sha256:", "");
              if (rawId.startsWith(img.id)) return true;
            }
            return false;
          })
          .map((c) => c.name);
      }
      setImages(xfImages);

      // 交叉引用：填充数据卷的关联容器
      const xfVolumes = transformVolumes(rawVolumes);
      for (const vol of xfVolumes) {
        const usingContainers: string[] = [];
        for (const c of rawContainers) {
          const mounts = c.Mounts || [];
          // 检查容器的挂载中是否引用了此数据卷
          for (const m of mounts) {
            if (m.Type === "volume" && (m.Name === vol.name || m.Source?.includes(vol.name))) {
              const cName = (c.Names?.[0] || "").replace(/^\//, "");
              if (cName && !usingContainers.includes(cName)) {
                usingContainers.push(cName);
              }
            }
          }
        }
        vol.associatedContainers = usingContainers;
      }
      setVolumes(xfVolumes);
      setStacks(xfStacks);
      setActivities(transformActivityLogs(rawActivities));
    } catch (err: any) {
      setDataError(err.message || "数据加载失败");
      setContainers([]);
      setImages([]);
      setVolumes([]);
      setStacks([]);
      setActivities([]);
    } finally {
      setDataLoading(false);
    }
  }, []);

  // 跨页导航携带的焦点容器：从堆栈子表等入口跳转到容器页后自动打开其详情（消费后即清空）
  const [focusContainerName, setFocusContainerName] = useState<string>("");
  const handleNavigate = (target: string, opts?: { focusContainerName?: string }) => {
    setFocusContainerName(opts?.focusContainerName ?? "");
    setPage(target as PageKey);
  };

  useEffect(() => {
    if (activeEngineId) {
      loadEngineData(activeEngineId);
    }
  }, [activeEngineId, loadEngineData]);

  // 仪表盘资源监控：SSE 实时推送（服务端 1s 聚合，多标签页共享一条查询）
  // 仅在仪表盘页活跃时订阅，离开页面自动断开；引擎暂不可达时保留上次数据
  useEffect(() => {
    if (!activeEngineId || page !== "dashboard") return;
    const es = new EventSource(`/api/engines/${activeEngineId}/resource-stats/stream`);
    // 服务端会话过期：EventSource 读不到 HTTP 401，服务端发 unauthorized 事件帧（v1.43.11）
    es.addEventListener("unauthorized", () => {
      window.dispatchEvent(new Event("auth:unauthorized"));
    });
    es.onmessage = (ev) => {
      try {
        setResourceStats(JSON.parse(ev.data));
      } catch {
        // 忽略坏帧，等下一秒的新数据
      }
    };
    // error 事件（引擎不可达）：保留上次数据即可，EventSource 自带断线重连
    return () => es.close();
  }, [activeEngineId, page]);

  // 切换活跃引擎（供 Settings 调用）
  const handleActiveEngineChange = useCallback(
    async (engineId: string) => {
      setActiveEngineIdState(engineId);
      try {
        await setActiveEngineIdApi(engineId);
      } catch (err) {
        console.error("保存活跃引擎失败:", err);
      }
    },
    []
  );

  // Settings 中引擎列表变化时同步
  const handleEnginesChange = useCallback((updated: DockerEngine[]) => {
    setEngines(updated);
  }, []);

  // 保存设置
  const handleSaveSettings = useCallback(async (newSettings: SystemSettings) => {
    try {
      const saved = await saveSettingsApi(newSettings);
      setSettings(saved);
    } catch (err) {
      console.error("保存设置失败:", err);
    }
  }, []);

  /**
   * 应用检查结果。
   * 后端 `checkEngineImages` 返回的**始终是该引擎的全量视图**（单镜像检查也会与缓存合并），
   * 因此前端直接替换即可，不做二次合并，避免两侧合并规则分叉。
   */
  const applyImageUpdateStatus = useCallback((r: ImageUpdateSummaryView) => {
    setImageUpdateStatus({ at: r.at, checked: r.checked, updates: r.updates, byRef: toRefMap(r.details) });
  }, []);

  /** 读取上次检查结果（进入镜像页 / 切换引擎时调用，不触发新的 digest 比对） */
  const loadImageUpdateStatus = useCallback(
    async (engineId: string) => {
      try {
        const r = await getImageUpdateStatusApi(engineId);
        if (r) applyImageUpdateStatus(r);
        else setImageUpdateStatus(null);
      } catch {
        // 缓存读取失败不打扰用户，保持现状
      }
    },
    [applyImageUpdateStatus]
  );

  /** 重新拉取活动日志（镜像「检查更新」后用于让通知中心即时出现更新可用通知） */
  const refreshActivities = useCallback(async (engineId: string) => {
    try {
      const raw = await fetchEngineActivity(engineId);
      setActivities(transformActivityLogs(raw));
    } catch {
      // 活动刷新失败不打扰用户，通知中心下次进入页面时再同步
    }
  }, []);

  /** 检查全部镜像更新：真正调用后端 digest 比对（此前只重拉列表，导致「没反应」） */
  const handleCheckAllUpdates = useCallback(async () => {
    if (!activeEngineId) return;
    setCheckingUpdates(true);
    setImageUpdateError(null);
    try {
      applyImageUpdateStatus(await checkImageUpdatesApi(activeEngineId));
      // 检查已写入缓存，刷新活动日志让「有可用更新」镜像进入通知中心
      void refreshActivities(activeEngineId);
    } catch (err: any) {
      console.error("检查更新失败:", err);
      setImageUpdateError(err?.message || "检查更新失败");
    } finally {
      setCheckingUpdates(false);
    }
  }, [activeEngineId, applyImageUpdateStatus, refreshActivities]);

  /** 检查单个镜像更新（右键菜单） */
  const handleCheckImageUpdate = useCallback(
    async (ref: string) => {
      if (!activeEngineId) return;
      setCheckingUpdates(true);
      setImageUpdateError(null);
      try {
        applyImageUpdateStatus(await checkImageUpdatesApi(activeEngineId, ref));
        void refreshActivities(activeEngineId);
      } catch (err: any) {
        console.error("检查更新失败:", err);
        setImageUpdateError(err?.message || `检查「${ref}」失败`);
      } finally {
        setCheckingUpdates(false);
      }
    },
    [activeEngineId, applyImageUpdateStatus, refreshActivities]
  );

  // 全局实时推送：登录并选定引擎后建立一条 EventSource(/api/push)，
  // 收到 image-update-checked 事件（后台调度器检查完成）即时刷新通知中心活动日志，
  // 使「有可用更新」通知无需等待切页/手动刷新即出现。EventSource 自带断线重连。
  useEffect(() => {
    if (!activeEngineId) return;
    const es = new EventSource("/api/push");
    // 服务端会话过期：EventSource 读不到 HTTP 401，服务端发 unauthorized 事件帧（v1.43.11）
    es.addEventListener("unauthorized", () => {
      window.dispatchEvent(new Event("auth:unauthorized"));
    });
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (
          data?.type === "image-update-checked" &&
          Array.isArray(data.byEngine) &&
          data.byEngine.some((b: any) => b.engineId === activeEngineId)
        ) {
          void refreshActivities(activeEngineId);
        }
      } catch {
        // 忽略坏帧，等下一次推送
      }
    };
    // 切换引擎时重建连接以绑定最新 activeEngineId
    return () => es.close();
  }, [activeEngineId, refreshActivities]);

  // 镜像页：切换引擎或进入页面时读取上次镜像版本检查结果（不重跑 digest 比对）
  // 必须放在 loadImageUpdateStatus 定义之后——依赖数组在渲染期求值，提前引用会触发 TDZ
  useEffect(() => {
    if (!activeEngineId || page !== "images") return;
    setImageUpdateError(null);
    void loadImageUpdateStatus(activeEngineId);
  }, [activeEngineId, page, loadImageUpdateStatus]);

  const stats = {
    runningContainers: containers.filter((c) => c.status === "running").length,
    totalContainers: containers.length,
    totalStacks: stacks.length,
    totalImages: images.length,
    totalVolumes: volumes.length,
  };

  // 加载中提示
  const renderLoading = () => (
    <div className="flex items-center justify-center h-full py-20">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm">正在加载引擎数据...</span>
      </div>
    </div>
  );

  // 错误提示
  const renderError = () => (
    <div className="flex items-center justify-center h-full py-20">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 text-xl">
          ⚠
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{dataError}</p>
          <button
            onClick={() => activeEngineId && loadEngineData(activeEngineId)}
            className="mt-2 text-xs text-blue-500 hover:text-blue-600"
          >
            点击重试
          </button>
        </div>
      </div>
    </div>
  );

  const showDataState = page !== "settings" && activeEngineId;

  if (authState !== "authed") {
    if (authState === "loading") {
      return (
        <div className="flex h-screen items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
            <span className="text-sm">正在初始化…</span>
          </div>
        </div>
      );
    }
    if (authState === "setup") {
      return <SetupWizard onDone={handleAuthDone} lockedUsername={lockedUsername} />;
    }
    if (authState === "reinit") {
      return (
        <SetupWizard
          mode="reinit"
          initialUsername={me?.username}
          onDone={handleReinitDone}
        />
      );
    }
    return <LoginPage onDone={handleAuthDone} notice={loginNotice} />;
  }

  // relative：为内部 absolute 元素建立包含块，防止其逃逸到初始包含块撑高文档
  return (
    <div className="relative flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        active={page}
        onNavigate={handleNavigate}
        stats={stats}
        engineName={activeEngine?.name}
        engineStatus={activeEngine?.status}
        dockerVersion={activeEngine?.dockerVersion}
        notificationsCount={unreadCount}
        updateAvailable={appUpdateAvailable}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={toggleSidebar}
        runtimeVersion={runtimeVersion}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar
          title={pageTitles[page].title}
          breadcrumb={pageTitles[page].breadcrumb}
          onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
          refreshing={dataLoading}
          onNavigate={handleNavigate}
          notifications={activities}
          unreadCount={unreadCount}
          user={me}
          onLogout={handleLogout}
          onMarkAllRead={() => {
            const allIds = new Set(activities.map((a) => a.id));
            setReadNotificationIds(allIds);
            localStorage.setItem("readNotificationIds", JSON.stringify([...allIds]));
          }}
        />
        <main className="flex-1 min-h-0 overflow-y-auto">
          {page === "dashboard" && (
            <Dashboard
              containers={containers}
              resourceStats={resourceStats}
              stacks={stacks}
              images={images}
              engineId={activeEngineId}
              onNavigate={handleNavigate}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
            />
          )}
          {page === "containers" && (
            <Containers
              containers={containers}
              stacks={stacks}
              onNavigate={handleNavigate}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
              defaultVisibleColumns={settings?.columnVisibility?.containers}
              containerDetailStyle={settings?.modal?.containerDetailStyle ?? "drawer"}
              focusContainerName={focusContainerName}
              onFocusContainerConsumed={() => setFocusContainerName("")}
            />
          )}
          {page === "stacks" && (
            <Stacks
              stacks={stacks}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
              menuLanguage={settings?.docker?.menuLanguage || "zh"}
              tagLibrary={settings?.tags || []}
              autoCloseDelay={settings?.modal?.autoCloseDelay ?? 5}
              composeTemplates={settings?.compose?.templates ?? []}
              autoDetectWebui={settings?.compose?.autoDetectWebui ?? true}
              defaultVisibleColumns={settings?.columnVisibility?.stackList}
              onOpenContainerDetail={(name) => handleNavigate("containers", { focusContainerName: name })}
            />
          )}
          {page === "images" && (
            <Images
              images={images}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
              onImagesRemoved={(ids) => {
                // 乐观更新：删除成功后本地即时移除，不等 loadEngineData 的 5 个并行请求
                setImages((prev) => prev.filter((i) => !ids.includes(i.id)));
              }}
              defaultVisibleColumns={settings?.columnVisibility?.images}
              hideRepoRegistryInit={settings?.imagesDisplay?.hideRegistryPrefix ?? true}
              onCheckAllUpdates={handleCheckAllUpdates}
              onCheckImageUpdate={handleCheckImageUpdate}
              checkingUpdates={checkingUpdates}
              imageUpdateStatus={imageUpdateStatus}
              imageUpdateError={imageUpdateError}
            />
          )}
          {page === "volumes" && (
            <Volumes
              volumes={volumes}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              defaultVisibleColumns={settings?.columnVisibility?.volumes}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
            />
          )}
          {page === "networks" && (
            <NetworkManager
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
            />
          )}
          {page === "notifications" && (
            <Notifications
              notifications={activities}
              readIds={readNotificationIds}
              onMarkRead={(id) => {
                const next = new Set(readNotificationIds);
                next.add(id);
                setReadNotificationIds(next);
                localStorage.setItem("readNotificationIds", JSON.stringify([...next]));
              }}
              onMarkAllRead={() => {
                const allIds = new Set(activities.map((a) => a.id));
                setReadNotificationIds(allIds);
                localStorage.setItem("readNotificationIds", JSON.stringify([...allIds]));
              }}
            />
          )}
          {page === "settings" && (
            <Settings
              settings={settings || undefined}
              activeEngineId={activeEngineId}
              onActiveEngineChange={handleActiveEngineChange}
              onEnginesChange={handleEnginesChange}
              engines={engines}
              onSaveSettings={handleSaveSettings}
              updateInfo={appUpdateInfo}
              onUpdateInfoChange={setAppUpdateInfo}
              currentUser={me}
            />
          )}
        </main>
      </div>
    </div>
  );
}
