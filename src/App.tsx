import React, { useState, useEffect, useCallback } from "react";
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
} from "./api";
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

  // 初始化：加载引擎列表、活跃引擎 ID、系统设置
  useEffect(() => {
    (async () => {
      try {
        const [list, settingsData] = await Promise.all([
          fetchEngines(),
          fetchSettings().catch(() => null),
        ]);
        setEngines(list);
        if (settingsData) setSettings(settingsData);
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
  }, []);

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

      // 交叉引用：堆栈 WebUI Labels 的图标/WebUI 地址传导到对应容器
      // 匹配规则（按优先级）：
      //   1. serviceName 与容器名精确匹配（compose 中显式指定 container_name）
      //   2. compose 默认命名 <project>-<service> 或 <project>-<service>-<index>
      const xfStacks = transformStacks(rawStacks);
      for (const st of xfStacks) {
        if (!st.webuiLabels || st.webuiLabels.length === 0) continue;
        for (const label of st.webuiLabels) {
          if (!label.iconUrl && !label.webuiUrl) continue;
          const matched = xfContainers.filter((c) =>
            c.name === label.serviceName ||
            c.name === `${st.name}-${label.serviceName}` ||
            new RegExp(`^${st.name}-${label.serviceName}-\\d+$`).test(c.name)
          );
          for (const c of matched) {
            if (label.iconUrl) c.icon = label.iconUrl;
            if (label.webuiUrl) c.webuiUrl = label.webuiUrl;
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

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar
        active={page}
        onNavigate={handleNavigate}
        stats={stats}
        engineName={activeEngine?.name}
        engineStatus={activeEngine?.status}
        dockerVersion={activeEngine?.dockerVersion}
        notificationsCount={unreadCount}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          title={pageTitles[page].title}
          breadcrumb={pageTitles[page].breadcrumb}
          onRefresh={() => activeEngineId && loadEngineData(activeEngineId)}
          onNavigate={handleNavigate}
          notifications={activities}
          unreadCount={unreadCount}
          onMarkAllRead={() => {
            const allIds = new Set(activities.map((a) => a.id));
            setReadNotificationIds(allIds);
            localStorage.setItem("readNotificationIds", JSON.stringify([...allIds]));
          }}
        />
        <main className="flex-1 overflow-y-auto">
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
              menuLanguage={settings?.docker?.menuLanguage || "en"}
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
            />
          )}
        </main>
      </div>
    </div>
  );
}
