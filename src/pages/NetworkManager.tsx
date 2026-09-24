import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  Network as NetworkIcon,
  Search,
  Trash2,
  Plus,
  Edit3,
  ArrowDownToLine,
  ArrowUpFromLine,
  Container as ContainerIcon,
  X,
  Globe,
  ShieldOff,
} from "lucide-react";
import type { DockerNetwork, NetworkCreateOptions } from "../types";
import {
  fetchNetworksApi,
  createNetworkApi,
  editNetworkApi,
  removeNetworkApi,
} from "../api";
import { Modal, ConfirmDialog } from "../components/Modal";
import { IconButton, EmptyState, FormField, Input, Select, ActionDropdown } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";
import { formatBytes } from "../transforms";
import { addOpLog } from "../opLog";

interface NetworkManagerProps {
  engineId?: string;
  onRefresh?: () => void;
}

/** KEY=VALUE 多行文本 → 对象（空行跳过） */
function parseKV(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    out[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return out;
}

/** 对象 → KEY=VALUE 多行文本 */
function stringifyKV(obj?: Record<string, string>): string {
  if (!obj) return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function NetworkManager({ engineId, onRefresh }: NetworkManagerProps) {
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<DockerNetwork | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DockerNetwork | null>(null);

  const load = useCallback(async () => {
    if (!engineId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchNetworksApi(engineId);
      setNetworks(data || []);
    } catch (e: any) {
      setError(e.message || "加载网络失败");
    } finally {
      setLoading(false);
    }
  }, [engineId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async () => {
    if (!engineId || !confirmDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeNetworkApi(engineId, confirmDelete.id);
      setConfirmDelete(null);
      addOpLog({ action: "删除网络", target: confirmDelete.name, status: "success", engineId });
      void load();
      onRefresh?.();
    } catch (e: any) {
      setDeleteError(e.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const totalContainers = useMemo(
    () => networks.reduce((acc, n) => acc + n.containers.length, 0),
    [networks]
  );

  /** 已存在的 host 驱动网络（全局仅允许 1 个） */
  const existingHost = useMemo(
    () => networks.find((n) => n.driver === "host") || null,
    [networks]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return networks;
    return networks.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.driver.toLowerCase().includes(q) ||
        n.containers.some((c) => c.name.toLowerCase().includes(q))
    );
  }, [networks, search]);

  return (
    <div className="p-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <NetworkIcon size={20} className="text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{networks.length}</p>
              <p className="text-xs text-slate-400">网络总数</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
              <ContainerIcon size={20} className="text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{totalContainers}</p>
              <p className="text-xs text-slate-400">已关联容器</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <Globe size={20} className="text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">
                {networks.filter((n) => n.scope === "local").length}
              </p>
              <p className="text-xs text-slate-400">本地网络（local）</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索网络名、驱动或容器..."
              className="w-64 pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <span className="text-sm text-slate-400">{filtered.length} 个网络</span>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
        >
          <Plus size={14} /> 新建网络
        </button>
      </div>

      {/* Network Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-5 py-3 whitespace-nowrap">网络名称</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">驱动</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">子网 / 网关</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">使用容器</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">流量（↓ 下行 / ↑ 上行）</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((net) => (
                <tr key={net.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <NetworkIcon size={14} className="text-blue-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-700 font-mono truncate max-w-[200px]" title={net.name}>
                        {net.name}
                      </span>
                      {net.internal && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-amber-600 bg-amber-50 rounded" title="内部网络（不可访问外网）">
                          <ShieldOff size={10} /> 内部
                        </span>
                      )}
                      {net.ingress && <span className="px-1.5 py-0.5 text-[10px] text-purple-600 bg-purple-50 rounded">ingress</span>}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">{net.scope} · {net.enableIPv6 ? "IPv6" : "IPv4"}</p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="text-xs text-slate-500 font-mono">{net.driver}</span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-xs font-mono text-slate-500">
                      {net.subnet ? (
                        <div>
                          <div>{net.subnet}</div>
                          {net.gateway && <div className="text-slate-400">gw: {net.gateway}</div>}
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1 max-w-[280px]">
                      {net.containers.length > 0 ? (
                        net.containers.map((c) => (
                          <span
                            key={c.id}
                            title={c.ipv4 ? `${c.name} (${c.ipv4})` : c.name}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono bg-slate-100 text-slate-600 rounded"
                          >
                            <ContainerIcon size={10} className="text-slate-400" />
                            {c.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-300">无</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1 text-green-600">
                        <ArrowDownToLine size={12} /> {formatBytes(net.rxBytes)}
                      </div>
                      <div className="flex items-center gap-1 text-blue-600">
                        <ArrowUpFromLine size={12} /> {formatBytes(net.txBytes)}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <ActionDropdown
                      items={[
                        {
                          label: "编辑",
                          icon: <Edit3 size={14} />,
                          onClick: () => {
                            setEditing(net);
                            setShowForm(true);
                          },
                        },
                        {
                          label: "删除",
                          icon: <Trash2 size={14} />,
                          danger: true,
                          onClick: () => setConfirmDelete(net),
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && !loading && (
          <EmptyState icon={<NetworkIcon size={28} />} title="未找到匹配的网络" description="尝试调整搜索条件或新建网络" />
        )}
      </div>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => {
          setConfirmDelete(null);
          setDeleteError(null);
        }}
        onConfirm={handleDelete}
        title="删除网络"
        message={`确定要删除网络「${confirmDelete?.name || ""}」吗？若有容器正在使用此网络，删除可能失败。`}
        confirmText="删除"
        danger
        loading={deleting}
        errorMessage={deleteError}
      />

      {/* Create / Edit Modal */}
      {showForm && (
        <Modal open={true} onClose={() => setShowForm(false)} title={editing ? `编辑网络 - ${editing.name}` : "新建网络"} size="md">
          <NetworkForm
            engineId={engineId}
            editing={editing}
            existingHost={existingHost}
            onClose={() => setShowForm(false)}
            onDone={() => {
              setShowForm(false);
              void load();
              onRefresh?.();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function NetworkForm({
  engineId,
  editing,
  existingHost,
  onClose,
  onDone,
}: {
  engineId?: string;
  editing: DockerNetwork | null;
  existingHost?: DockerNetwork | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(editing?.name || "");
  const [driver, setDriver] = useState(editing?.driver || "bridge");
  const [subnet, setSubnet] = useState(editing?.subnet || "");
  const [gateway, setGateway] = useState(editing?.gateway || "");
  const [optionsText, setOptionsText] = useState(stringifyKV(Object.fromEntries((editing?.options || []).map((o) => [o.key, o.value]))));
  const [labelsText, setLabelsText] = useState(stringifyKV(Object.fromEntries((editing?.labels || []).map((l) => [l.key, l.value]))));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // host 驱动全局仅允许 1 个：已存在且当前不是正在编辑该 host 网络时，禁用 host 选项
  const hostOptionDisabled = !!existingHost && editing?.id !== existingHost.id;
  const driverOptions = [
    { value: "bridge", label: "bridge（桥接，默认）" },
    { value: "overlay", label: "overlay（跨主机 swarm）" },
    { value: "macvlan", label: "macvlan（直连物理网络）" },
    { value: "host", label: "host（共享主机网络）" },
    { value: "null", label: "null（无网络）" },
  ].filter((o) => !(hostOptionDisabled && o.value === "host"));

  const handleSave = async () => {
    if (!name.trim() || !engineId) return;
    setSaving(true);
    setError("");
    const opts: NetworkCreateOptions = {
      name: name.trim(),
      driver,
      subnet: subnet.trim() || undefined,
      gateway: gateway.trim() || undefined,
      options: parseKV(optionsText),
      labels: parseKV(labelsText),
    };
    try {
      if (editing) {
        await editNetworkApi(engineId, editing.id, opts);
      } else {
        await createNetworkApi(engineId, opts);
      }
      addOpLog({ action: editing ? "编辑网络" : "创建网络", target: name.trim(), status: "success", engineId });
      onDone();
    } catch (err: any) {
      setError(err.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
          {error}
        </div>
      )}
      <FormField label="网络名称" required>
        <Input value={name} onChange={setName} placeholder="如: my-bridge" disabled={!!editing} />
      </FormField>
      <FormField label="驱动">
        <Select
          value={driver}
          onChange={setDriver}
          options={driverOptions}
        />
      </FormField>
      {hostOptionDisabled && (
        <p className="text-[11px] text-amber-600 -mt-2">
          已存在 host 驱动网络「{existingHost?.name}」，host 驱动全局仅允许创建 1 个，故不可再选。
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormField label="子网（可选）" hint="如 172.20.0.0/16">
          <Input value={subnet} onChange={setSubnet} placeholder="留空由 Docker 自动分配" />
        </FormField>
        <FormField label="网关（可选）" hint="如 172.20.0.1">
          <Input value={gateway} onChange={setGateway} placeholder="留空自动分配" />
        </FormField>
      </div>
      <FormField label="驱动选项（可选）" hint="每行 KEY=VALUE">
        <textarea
          value={optionsText}
          onChange={(e) => setOptionsText(e.target.value)}
          rows={3}
          placeholder={"com.docker.network.bridge.name=docker1"}
          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
        />
      </FormField>
      <FormField label="标签（可选）" hint="每行 KEY=VALUE">
        <textarea
          value={labelsText}
          onChange={(e) => setLabelsText(e.target.value)}
          rows={2}
          placeholder={"com.example.owner=yanzi"}
          className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
        />
      </FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">取消</button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || saving}
          className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "保存中..." : editing ? "保存" : "创建"}
        </button>
      </div>
    </div>
  );
}
