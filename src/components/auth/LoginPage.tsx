import React, { useState } from "react";
import {
  User, Loader2, KeyRound, ArrowLeft, CheckCircle2,
  Boxes, Container, Layers, Gauge, Globe, Database,
} from "lucide-react";
import { Input, FormField } from "../UI";
import { PasswordInput } from "../PasswordInput";
import { login, resetPasswordByRecovery, type AuthUser } from "../../api";
import {
  sanitizeRecoveryInput,
  validateRecoveryCode,
  RECOVERY_MIN_LENGTH,
  RECOVERY_MAX_LENGTH,
} from "../../lib/recovery-code";

interface Props {
  onDone: (user: AuthUser) => void;
  /** 顶部提示条（如账号重新设置完成后引导用新凭据登录） */
  notice?: string;
}

/** 登录页（含「忘记密码 → 找回码重置」入口） */
export function LoginPage({ onDone, notice }: Props) {
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
      notice={notice}
      onDone={onDone}
      onRecover={(u) => {
        setPresetUsername(u);
        setMode("recover");
      }}
    />
  );
}

/**
 * v1.48.0 登录页分栏骨架（仿品牌落地页）：
 * 左侧蓝色渐变品牌区（Logo + 主标语 + 功能亮点列表 + 底部说明），
 * 右侧白色表单区；小屏（<lg）左栏隐藏、只显表单。
 */
function AuthLayout({ children }: { children: React.ReactNode }) {
  const features: { icon: React.ReactNode; text: string; badge?: string }[] = [
    { icon: <Container size={14} />, text: "容器与堆栈管理：启停、重建、终端，一目了然" },
    { icon: <Gauge size={14} />, text: "资源监控：CPU / 内存 / 网络 / 磁盘实时曲线" },
    { icon: <Globe size={14} />, text: "WebUI 自动识别：服务端口一键直达" },
    { icon: <Database size={14} />, text: "镜像 / 数据卷 / 网络全景可视" },
    { icon: <Layers size={14} />, text: "服务标签与描述：LABELS 让团队读得懂", badge: "LABELS" },
    { icon: <KeyRound size={14} />, text: "找回码 + 双重验证：凭据自助恢复", badge: "安全" },
  ];

  return (
    <div className="flex h-screen bg-white">
      {/* 左侧品牌区 */}
      <aside className="hidden lg:flex w-[46%] max-w-[640px] flex-shrink-0 relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 flex-col justify-between px-10 py-8 text-white">
        {/* 装饰圆 */}
        <div className="absolute -top-24 -right-16 w-72 h-72 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute top-1/3 -left-20 w-80 h-80 rounded-full bg-white/5 pointer-events-none" />
        <div className="absolute -bottom-28 right-10 w-64 h-64 rounded-full bg-black/5 pointer-events-none" />

        {/* Logo 行 */}
        <div className="relative flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-white/15 ring-1 ring-white/25 flex items-center justify-center">
            <Boxes size={20} />
          </div>
          <span className="font-semibold tracking-wide">Docker 管理</span>
        </div>

        {/* 主标语 + 功能亮点 */}
        <div className="relative">
          <h1 className="text-3xl font-bold leading-snug">
            每一台容器
            <br />
            都该有「在哪、什么状态」的答案
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-blue-100 max-w-md">
            面向自托管 NAS / 服务器的 Docker 可视化管理平台：
            容器、堆栈、镜像、数据卷、网络集中管理，资源曲线实时呈现，数据全部留在自己手里。
          </p>
          <ul className="mt-6 space-y-2.5 max-w-md">
            {features.map((f, i) => (
              <li key={i} className="flex items-center gap-2.5 text-[13px] text-blue-50">
                <span className="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center flex-shrink-0">
                  {f.icon}
                </span>
                <span className="truncate">{f.text}</span>
                {f.badge && (
                  <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-white/15 text-blue-100 leading-none">
                    {f.badge}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* 底部说明 */}
        <p className="relative text-xs text-blue-200/80">
          自托管 · 数据不出内网 · 一个 Docker 容器即可运行
        </p>
      </aside>

      {/* 右侧表单区 */}
      <main className="flex-1 flex items-center justify-center px-6 py-8 overflow-y-auto">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}

function LoginForm({
  initialUsername,
  notice,
  onDone,
  onRecover,
}: {
  initialUsername: string;
  notice?: string;
  onDone: (user: AuthUser) => void;
  onRecover: (username: string) => void;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">登录</h2>
        <p className="text-sm text-slate-400 mt-1">Docker Stack Manager</p>
      </div>

      {notice && (
        <div className="mb-4 rounded-lg border border-green-100 bg-green-50 px-3 py-2.5 text-xs leading-relaxed text-green-700">
          {notice}
        </div>
      )}

      {/* 原生表单：回车触发 submit（v1.15.5 兜底，不依赖 onKeyDown 透传） */}
      <form
        className="space-y-4"
        onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}
      >
        <FormField label="用户名 / 邮箱 / 手机号">
          <div className="relative">
            <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={username}
              onChange={setUsername}
              placeholder="用户名、绑定邮箱或手机号"
              className="pl-9"
            />
          </div>
        </FormField>

        <FormField label="密码">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="请输入密码"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </FormField>

        {/* 忘记密码入口（右侧小链接，v1.48.0 仿品牌布局） */}
        <div className="flex justify-end -mt-1 mb-3">
          <button
            type="button"
            onClick={() => onRecover(username)}
            className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
          >
            忘记密码？重置密码
          </button>
        </div>

        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          登 录
        </button>
      </form>

      {/* 底部提示框（仿品牌布局的灰色说明条） */}
      <div className="mt-5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
        dockermanagementyanzi · 本地部署：账号与配置仅保存在本机，登录 ID 支持用户名 / 绑定邮箱 / 手机号。
      </div>
    </AuthLayout>
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
  const [showCode, setShowCode] = useState(false); // v1.46.2：找回码默认掩码，小眼睛可核对
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim()) {
      setError("请输入账号");
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
    <AuthLayout>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">找回密码</h2>
        <p className="text-sm text-slate-500 mt-1">
          使用 {RECOVERY_MIN_LENGTH}~{RECOVERY_MAX_LENGTH} 位找回码重置登录密码
        </p>
        <p className="text-xs text-slate-400 mt-1">
          找回码区分大小写，请按设置时的原始大小写输入
        </p>
      </div>

      <form
        className="space-y-4"
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
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              返回登录
            </button>
          </div>
        ) : (
          <>
            <FormField label="用户名 / 邮箱 / 手机号" required>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={username}
                  onChange={setUsername}
                  placeholder="用户名、绑定邮箱或手机号"
                  className="pl-9"
                />
              </div>
            </FormField>

            <FormField
              label="找回码"
              required
              hint={`${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字，区分大小写`}
            >
              <PasswordInput
                value={code}
                onChange={(v) => setCode(sanitizeRecoveryInput(v))}
                placeholder={`${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字`}
                visible={showCode}
                onToggle={() => setShowCode((v) => !v)}
                leftIcon={<KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}
                ariaLabel="找回码"
                className="font-mono tracking-wider"
                rightExtra={
                  <span className="text-[11px] text-slate-400 tabular-nums">
                    {code.length}/{RECOVERY_MAX_LENGTH}
                  </span>
                }
              />
            </FormField>

            <FormField label="新密码" required hint="至少 6 位">
              <PasswordInput
                value={newPassword}
                onChange={setNewPassword}
                placeholder="••••••••"
                visible={showNew}
                onToggle={() => setShowNew((v) => !v)}
              />
            </FormField>

            <FormField label="确认新密码" required>
              <PasswordInput
                value={confirm}
                onChange={setConfirm}
                placeholder="••••••••"
                visible={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
              />
            </FormField>

            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              重置密码
            </button>

            <button
              type="button"
              onClick={onBack}
              className="w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors py-1 mt-3"
            >
              <ArrowLeft size={12} /> 返回登录
            </button>
          </>
        )}
      </form>

      <div className="mt-5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 text-[11px] leading-relaxed text-slate-400">
        每次使用后需间隔 10 分钟才能再次使用找回码
      </div>
    </AuthLayout>
  );
}
