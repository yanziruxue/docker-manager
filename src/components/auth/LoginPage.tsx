import React, { useState } from "react";
import { User, Lock, LogIn, Loader2 } from "lucide-react";
import { Input, FormField } from "../UI";
import { login, type AuthUser } from "../../api";

interface Props {
  onDone: (user: AuthUser) => void;
}

/** 登录页 */
export function LoginPage({ onDone }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      onDone(user);
    } catch (e: any) {
      setError(e?.message || "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center text-white mb-3">
            <LogIn size={24} />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">登录</h1>
          <p className="text-sm text-slate-500 mt-1">Docker Stack Manager</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <FormField label="用户名" required>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={setUsername}
                placeholder="用户名"
                className="pl-9"
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          </FormField>

          <FormField label="密码" required>
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
            登录
          </button>
        </div>
      </div>
    </div>
  );
}
