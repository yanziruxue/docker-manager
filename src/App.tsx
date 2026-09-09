import React, { useState, useEffect, useRef, useCallback } from "react";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { Dashboard } from "./pages/Dashboard";
import { Containers } from "./pages/Containers";
import { Stacks } from "./pages/Stacks";
import { Images } from "./pages/Images";
import { Volumes } from "./pages/Volumes";
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
  logout,
  type AuthUser,
} from "./api";
import { SetupWizard } from "./components/auth/SetupWizard";
import { LoginPage } from "./components/auth/LoginPage";
import {
  transformContainers,
  transformImages,
  transformVolumes,
  transformStacks,
  transformActivityLogs,
} from "./transforms";
import type { PageKey, Container, DockerImage, DockerVolume, DockerEngine, Stack, SystemSettings, ActivityLog, EngineResourceStats } from "./types";

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
  // 应用自身（OTA）更新是否可用：驱动全局侧边栏「系统设置」角标
  const [appUpdateAvailable, setAppUpdateAvailable] = useState(false);
  // 最新 settings 引用：6 小时定时轮询的 doCheck 闭包需读取用户最新保存的 autoUpdate / ignoredVersion
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // ============ 鉴权门卫 ============
  // authState: loading(启动检测) → setup(首次初始化) / login(未登录) / authed(已登录)
  const [authState, setAuthState] = useState<"loading" | "setup" | "login" | "authed">("loading");
  const [me, setMe] = useState<AuthUser | null>(null);

  // 启动检测：并发判断「是否已初始化」与「当前是否已登录」
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [init, meRes] = await Promise.all([
          getAuthInitStatus().catch(() => ({ initialized: false })),
          getMe().catch(() => null),
        ]);
        if (cancelled) return;
        if (meRes) {
          setMe(meRes);
          setAuthState("authed");
        } else if (!init.initialized) {
          setAuthState("setup");
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

  const handleAuthDone = (user: AuthUser) => {
    setMe(user);
    setAuthState("authed");
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      /* 忽略登出请求错误，仍强制回登录页 */
    }
    setMe(null);
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
    notifications: { title: "通知中心", breadcrumb: ["首页", "通知中心"] },
    settings: { title: "系统设置", breadcrumb: ["首页", "系统设置"] },
  };

  // 自动更新：检测到新版后自动下载应用，并监听后端重启后刷新前端（避免停留在旧前端 bundle）
  const triggerAutoUpdate = () => {
    applyUpdateApi().catch(() => {
      /* fire-and-forget：失败由更新状态端点反映，此处静默 */
    });
    let sawDown = false;
    let attempts = 0;
    const id = setInterval(() => {
      fetchAppVersion()
        .then(() => {
          if (sawDown) {
            clearInterval(id);
            window.location.reload();
          } else if (++attempts > 40) {
            clearInterval(id); // 旧进程未退出（异常），停止自动刷新，避免无限轮询
          }
        })
        .catch(() => {
          sawDown = true; // 旧进程已退出，等待新进程上线
        });
    }, 1500);
  };

  // 初始化：加载引擎列表、活跃引擎 ID、系统设置
  // 依赖 authState：仅在登录态就绪后拉取（未登录时 /api 一律 401，提前拉取会静默失败且登录后不会重试）
  useEffect(() => {
    if (authState !== "authed") return;
    let updateTimer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      try {
        const [list, settingsData] = await Promise.all([
          fetchEngines(),
          fetchSettings().catch(() => null),
        ]);
        setEngines(list);
        if (settingsData) setSettings(settingsData);
        // 自动检查更新：覆盖「网页刷新 / 后端启动 / 每 6 小时」三触发条件
        // 挂载即查一次（启动/页面加载）；之后每 6 小时周期轮询（长开页面也能及时发现更新）
        if (settingsData?.update?.autoCheck) {
          const doCheck = () =>
            checkUpdateApi()
              .then((info) => {
                const upd = settingsRef.current?.update;
                const ignored = upd?.ignoredVersion || "";
                // 被忽略的版本不提示（侧边栏角标保持隐藏）
                const show = info.hasUpdate && info.latestVersion !== ignored;
                setAppUpdateAvailable(show);
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

  const handleNavigate = (target: string) => {
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

  const handleCheckAllUpdates = useCallback(async () => {
    if (!activeEngineId) return;
    setCheckingUpdates(true);
    try {
      // 重新拉取镜像列表，触发关联容器重新计算
      const rawImages = await fetchEngineImages(activeEngineId).catch(() => []);
      const xfImages = transformImages(rawImages);
      for (const img of xfImages) {
        img.associatedContainers = containers
          .filter((c) => {
            if (c.image.includes(img.repository)) return true;
            return false;
          })
          .map((c) => c.name);
      }
      setImages(xfImages);
      // 同时触发一次全局刷新
      await loadEngineData(activeEngineId);
    } catch (err) {
      console.error("检查更新失败:", err);
    } finally {
      setCheckingUpdates(false);
    }
  }, [activeEngineId, containers, loadEngineData]);

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
    if (authState === "setup") return <SetupWizard onDone={handleAuthDone} />;
    return <LoginPage onDone={handleAuthDone} />;
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
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <TopBar
          title={pageTitles[page].title}
          breadcrumb={pageTitles[page].breadcrumb}
          onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
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
              activities={activities}
              onNavigate={handleNavigate}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
            />
          )}
          {page === "containers" && (
            <Containers
              containers={containers}
              onNavigate={handleNavigate}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
              defaultVisibleColumns={settings?.columnVisibility?.containers}
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
              defaultVisibleColumns={settings?.columnVisibility?.stackList}
              defaultSubColumns={settings?.columnVisibility?.stacks}
            />
          )}
          {page === "images" && (
            <Images
              images={images}
              loading={showDataState ? dataLoading : false}
              error={showDataState ? dataError : null}
              engineId={activeEngineId}
              onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
              defaultVisibleColumns={settings?.columnVisibility?.images}
              onCheckAllUpdates={handleCheckAllUpdates}
              checkingUpdates={checkingUpdates}
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
              onUpdateAvailableChange={setAppUpdateAvailable}
              currentUser={me}
            />
          )}
        </main>
      </div>
    </div>
  );
}
