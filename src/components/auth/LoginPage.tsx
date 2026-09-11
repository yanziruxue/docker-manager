import React, { useState } from "react";
import { User, Lock, LogIn, Loader2, KeyRound, ArrowLeft, CheckCircle2 } from "lucide-react";
import { Input, FormField } from "../UI";
import { login, resetPasswordByRecovery, type AuthUser } from "../../api";
import {
  sanitizeRecoveryInput,
  validateRecoveryCode,
  RECOVERY_LENGTH,
} from "../../lib/recovery-code";

interface Props {
  onDone: (user: AuthUser) => void;
}

/** 登录页（含「忘记密码 → 找回码重置」入口） */
export function LoginPage({ onDone }: Props) {
  const [mode, setMode] = useState<"login" | "recover">("login");
  const [presetUsername, setPresetUsername] = useState("");

  if (mode === "recover") {
    return (
      <RecoveryForm
        initialUsername={presetUsername}
        onBack={() => setMode("login")}
        onDone={(u) => setPresetUsername(u)}
      />
    );
  }

  return (
    <LoginForm
      initialUsername={presetUsername}
      onDone={onDone}
      onRecover={(u) => {
        setPresetUsername(u);
        setMode("recover");
      }}
    />
  );
}

function LoginForm({
  initialUsername,
  onDone,
  onRecover,
}: {
  initialUsername: string;
  onDone: (user: AuthUser) => void;
  onRecover: (username: string) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
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

        {/* 原生表单：回车触发 submit（v1.15.5 兜底，不依赖 onKeyDown 透传） */}
        <form
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}
        >
          <FormField label="用户名" required>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={setUsername}
                placeholder="请输入用户名"
                className="pl-9"
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
                placeholder="请输入密码"
                className="pl-9"
              />
            </div>
          </FormField>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            登录
          </button>

          <button
            type="button"
            onClick={() => onRecover(username)}
            className="w-full text-xs text-slate-500 hover:text-blue-600 transition-colors py-1"
          >
            重置密码
          </button>
        </form>
      </div>
    </div>
  );
}

/** 通过找回码重置密码 */
function RecoveryForm({
  initialUsername,
  onBack,
  onDone,
}: {
  initialUsername: string;
  onBack: () => void;
  onDone: (username: string) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim()) {
      setError("请输入用户名");
      return;
    }
    const fmtErr = validateRecoveryCode(code);
    if (fmtErr) {
      setError(fmtErr);
      return;
    }
    if (newPassword.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await resetPasswordByRecovery(username.trim(), code, newPassword);
      setDone(true);
      onDone(username.trim());
    } catch (e: any) {
      setError(e?.message || "重置失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center text-white mb-3">
            <KeyRound size={24} />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">找回密码</h1>
          <p className="text-sm text-slate-500 mt-1">
            使用 {RECOVERY_LENGTH} 位找回码重置登录密码
          </p>
        </div>

        <form
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (!busy && !done) submit(); }}
        >
          {done ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
                <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
                <span>密码已重置，请使用新密码登录。</span>
              </div>
              <button
                type="button"
                onClick={onBack}
                className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
              >
                返回登录
              </button>
            </div>
          ) : (
            <>
              <FormField label="用户名" required>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={username}
                    onChange={setUsername}
                    placeholder="用户名"
                    className="pl-9"
                  />
                </div>
              </FormField>

              <FormField
                label="找回码"
                required
                hint={`${RECOVERY_LENGTH} 位字母或数字，忽略大小写`}
              >
                <div className="relative">
                  <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={code}
                    onChange={(v) => setCode(sanitizeRecoveryInput(v))}
                    placeholder={`${RECOVERY_LENGTH} 位字母或数字`}
                    className="pl-9 pr-12 font-mono tracking-wider"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums">
                    {code.length}/{RECOVERY_LENGTH}
                  </span>
                </div>
              </FormField>

              <FormField label="新密码" required hint="至少 6 位">
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={newPassword}
                    onChange={setNewPassword}
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                  />
                </div>
              </FormField>

              <FormField label="确认新密码" required>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={confirm}
                    onChange={setConfirm}
                    type="password"
                    placeholder="••••••••"
                    className="pl-9"
                  />
                </div>
              </FormField>

              {error && (
                <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
              >
                {busy && <Loader2 size={15} className="animate-spin" />}
                重置密码
              </button>

              <button
                type="button"
                onClick={onBack}
                className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors py-1"
              >
                <ArrowLeft size={12} /> 返回登录
              </button>
            </>
          )}
        </form>

        <p className="text-center text-[11px] text-slate-400 mt-4">
          每次使用后需间隔 10 分钟才能再次使用找回码
        </p>
      </div>
    </div>
  );
}
