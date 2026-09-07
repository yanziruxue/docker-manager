import React, { useState } from "react";
import { User, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { Input, FormField } from "../UI";
import { initAccount, type AuthUser } from "../../api";

interface Props {
  onDone: (user: AuthUser) => void;
}

/** 首次部署：创建管理员账号 */
export function SetupWizard({ onDone }: Props) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim()) {
      setError("用户名不能为空");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const user = await initAccount(username.trim(), password);
      onDone(user);
    } catch (e: any) {
      setError(e?.message || "创建账户失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center text-white mb-3">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">初始设置</h1>
          <p className="text-sm text-slate-500 mt-1">创建管理员账号以开始使用</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <FormField label="用户名" required>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={setUsername}
                placeholder="admin"
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField label="密码" required hint="至少 6 位">
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="••••••••"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          </FormField>

          <FormField label="确认密码" required>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={confirm}
                onChange={setConfirm}
                type="password"
                placeholder="••••••••"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          </FormField>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            创建并进入
          </button>
        </div>

        <p className="text-center text-[11px] text-slate-400 mt-4">
          账户信息仅以哈希形式存储，请妥善保管密码
        </p>
      </div>
    </div>
  );
}
