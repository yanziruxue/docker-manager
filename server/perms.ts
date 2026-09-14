/**
 * 权限诊断与修复。
 *
 * 设计约束（重要）：
 *   - **无副作用**：本模块不 import `paths.js`（那会在 CLI 模式下触发目录创建与旧布局迁移，
 *     若以 sudo 运行会以 root 建出目录，反而制造新的属主漂移）。所有目录/属主由调用方传入。
 *   - 只读诊断用 `lstatSync`：判定权限只需要**父目录的 x 位**，不需要文件自身的读权限。
 *
 * 安全边界：自愈只补「属主读位」（`| 0o400`），绝不触碰 group/other 位与 uid/gid，
 * 因此不会把 `0600` 的敏感文件放大成 `0644`。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** 单条权限问题的完整诊断信息 */
export interface PermIssue {
  /** 相对展示路径（如 qinglong/.stack-meta.json） */
  relPath: string;
  /** 绝对路径（可直接粘贴进命令） */
  absPath: string;
  /** 触发诊断的错误码（EACCES / EPERM / UNREADABLE） */
  code: string;
  /** 出问题的对象：自身 / 父目录 */
  scope: "self" | "parent";
  /** 八进制权限位字符串，如 "600" */
  mode: string;
  uid: number;
  gid: number;
  /** 当前属主显示名 */
  owner: string;
  /** 期望属主（服务运行用户） */
  targetUid: number;
  targetUser: string;
  /** 当前进程 uid（sudo 场景下为 0） */
  procUid: number;
  procUser: string;
  /** 人类可读的判定原因 */
  reason: string;
  /** 可直接复制的修复命令 */
  advice: string;
  /** 本次备份是否已自动修复（仍失败时才会出现在列表里） */
  autoFixed: boolean;
}

let passwdCache: Map<number, string> | null = null;

/** 解析 /etc/passwd（不依赖 getent，nologin 环境同样可用） */
function loadPasswd(): Map<number, string> {
  if (passwdCache) return passwdCache;
  const map = new Map<number, string>();
  try {
    const txt = fs.readFileSync("/etc/passwd", "utf-8");
    for (const line of txt.split("\n")) {
      const parts = line.split(":");
      if (parts.length < 3) continue;
      const uid = Number(parts[2]);
      if (parts[0] && Number.isInteger(uid)) map.set(uid, parts[0]);
    }
  } catch {
    /* 非 Linux 或不可读：回退到数字 uid */
  }
  passwdCache = map;
  return map;
}

/** uid → 用户名；解析不到时返回 `uid N` 形式 */
export function userNameOf(uid: number): string {
  if (uid < 0) return "unknown";
  return loadPasswd().get(uid) || `uid ${uid}`;
}

/** 当前进程身份（进程名优先取 /etc/passwd，避免 os.userInfo 在容器里返回空） */
export function currentUser(): { uid: number; name: string } {
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  let name = "";
  if (uid >= 0) name = loadPasswd().get(uid) || "";
  if (!name) {
    try {
      name = os.userInfo().username || "";
    } catch {
      /* ignore */
    }
  }
  if (!name) name = uid >= 0 ? `uid ${uid}` : "unknown";
  return { uid, name };
}

/** 权限位 → 三位八进制字符串 */
export function modeString(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

/** 是否为权限类错误 */
export function isPermError(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code;
  return code === "EACCES" || code === "EPERM";
}

/** 生成 chown 建议命令（用户名形式更可读，无 passwd 记录时退回数字） */
function chownAdvice(absPath: string, targetUid: number): string {
  const name = userNameOf(targetUid);
  const spec = /^uid /i.test(name) ? `${targetUid}:${targetUid}` : `${name}:${name}`;
  return `sudo chown ${spec} '${absPath}'`;
}

/** 属主展示：有用户名时 `name(uid N)`，解析不到时只写 `uid N`（避免出现 `uid 0(uid 0)`） */
function ownerLabel(name: string, uid: number): string {
  return /^uid \d+$/i.test(name) ? name : `${name}(uid ${uid})`;
}

/** 一行式摘要：给界面提示与日志共用（自解释，含属主/权限位/当前 uid） */
export function formatIssue(i: PermIssue): string {
  const codeText = i.code === "EACCES" ? "拒绝访问" : i.code === "EPERM" ? "操作被拒绝" : i.code;
  return `${i.relPath} — ${codeText}（${i.code}）：权限 ${i.mode}，属主 ${ownerLabel(i.owner, i.uid)}，当前进程 ${ownerLabel(i.procUser, i.procUid)}`;
}

/**
 * 诊断单个路径的权限问题。
 * `lstatSync` 失败时（父目录缺 x）退化为诊断父目录。
 */
export function diagnosePerm(opts: {
  absPath: string;
  relPath: string;
  code: string;
  targetUid: number;
  autoFixed?: boolean;
}): PermIssue {
  const { absPath, relPath, code, targetUid, autoFixed = false } = opts;
  const me = currentUser();

  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(absPath);
  } catch {
    st = null;
  }

  // 连 lstat 都失败：问题出在父目录（缺 x 位）
  if (!st) {
    const parent = path.dirname(absPath);
    let pst: fs.Stats | null = null;
    try {
      pst = fs.statSync(parent);
    } catch {
      /* ignore */
    }
    return {
      relPath,
      absPath,
      code,
      scope: "parent",
      mode: pst ? modeString(pst.mode) : "?",
      uid: pst?.uid ?? -1,
      gid: pst?.gid ?? -1,
      owner: pst ? userNameOf(pst.uid) : "unknown",
      targetUid,
      targetUser: userNameOf(targetUid),
      procUid: me.uid,
      procUser: me.name,
      reason: `父目录 '${parent}' 不可访问（缺 x 位），无法读取条目`,
      advice: `sudo chmod u+x '${parent}'`,
      autoFixed,
    };
  }

  const mode = modeString(st.mode);
  const owner = userNameOf(st.uid);
  const byTarget = targetUid >= 0 && st.uid === targetUid;
  const isDir = st.isDirectory();
  const noRead = (st.mode & 0o400) === 0;
  const noExec = isDir && (st.mode & 0o100) === 0;

  let reason: string;
  let advice: string;
  if (!byTarget) {
    reason = `属主 ${ownerLabel(owner, st.uid)} 与运行用户 ${ownerLabel(userNameOf(targetUid), targetUid)} 不一致，进程读不到`;
    advice = chownAdvice(absPath, targetUid);
  } else if (noRead) {
    reason = `属主正确，但权限位 ${mode} 不含属主读位`;
    advice = `sudo chmod u+r '${absPath}'`;
  } else if (noExec) {
    reason = `属主正确，但目录权限位 ${mode} 缺 x 位，无法进入`;
    advice = `sudo chmod u+x '${absPath}'`;
  } else {
    reason = `权限位 ${mode}，属主 ${owner}(uid ${st.uid})；复制失败可能与文件本身无关`;
    advice = `sudo chmod u+rw '${absPath}'`;
  }

  return {
    relPath,
    absPath,
    code,
    scope: "self",
    mode,
    uid: st.uid,
    gid: st.gid,
    owner,
    targetUid,
    targetUser: userNameOf(targetUid),
    procUid: me.uid,
    procUser: me.name,
    reason,
    advice,
    autoFixed,
  };
}

/**
 * 尝试给「自己的文件」补上属主读位，用于备份自愈。
 * 只在三种前提下动作：属主是当前用户、确实缺读位、chmod 成功。
 */
export function tryGrantOwnerRead(p: string): { ok: boolean; detail: string } {
  const me = typeof process.getuid === "function" ? process.getuid() : -1;
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch (e: any) {
    return { ok: false, detail: `stat 失败：${e?.message || e}` };
  }
  if (me < 0 || st.uid !== me) {
    return { ok: false, detail: `属主 uid ${st.uid} 不是当前用户 uid ${me}，需 root 修复` };
  }
  if (st.mode & 0o400) {
    return { ok: false, detail: `权限位 ${modeString(st.mode)} 已含属主读位，不是只读权限问题` };
  }
  try {
    fs.chmodSync(p, (st.mode & 0o777) | 0o400);
    return { ok: true, detail: `${modeString(st.mode)} → ${modeString((st.mode & 0o777) | 0o400)}` };
  } catch (e: any) {
    return { ok: false, detail: `chmod 失败：${e?.message || e}` };
  }
}

/** 递归体检：把「属主不对 / 服务读不了」的条目挑出来（只读，不改动任何东西） */
export function scanPermIssues(
  dirs: string[],
  targetUid: number,
  opts: { maxDepth?: number; maxEntries?: number } = {}
): { checked: number; issues: PermIssue[] } {
  // 非 POSIX 平台（Windows）没有属主模型，mode/uid 无意义 → 直接返回空，避免误报
  if (typeof process.getuid !== "function") return { checked: 0, issues: [] };
  const maxDepth = opts.maxDepth ?? 6;
  const maxEntries = opts.maxEntries ?? 5000;
  const issues: PermIssue[] = [];
  let checked = 0;

  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > maxDepth || checked >= maxEntries) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e: any) {
      if (isPermError(e)) {
        issues.push(
          diagnosePerm({
            absPath: dir,
            relPath: prefix || path.basename(dir),
            code: e?.code || "EACCES",
            targetUid,
          })
        );
      }
      return;
    }
    for (const entry of entries) {
      if (checked >= maxEntries) return;
      checked++;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(full);
      } catch (e: any) {
        issues.push(diagnosePerm({ absPath: full, relPath: rel, code: e?.code || "EACCES", targetUid }));
        continue;
      }
      const wrongOwner = targetUid >= 0 && st.uid !== targetUid;
      const isDir = st.isDirectory();
      const unreadable = isDir ? (st.mode & 0o500) !== 0o500 : (st.mode & 0o400) === 0;
      if (wrongOwner || unreadable) {
        issues.push(diagnosePerm({ absPath: full, relPath: rel, code: "EACCES", targetUid }));
      }
      if (isDir && entry.name !== "." && entry.name !== "..") walk(full, rel, depth + 1);
    }
  };

  for (const d of dirs) {
    if (fs.existsSync(d)) walk(d, "", 1);
  }
  return { checked, issues };
}

export interface FixStats {
  checked: number;
  ownerFixed: number;
  modeFixed: number;
  skipped: number;
  failed: number;
}

/**
 * 递归修复属主/权限。
 * 默认**只改属主，不动权限位**（避免把 0600 的密钥文件放开成 0644）；
 * `normalizeMode` 打开时才额外补「属主读写/目录可进入」。
 */
export function fixPerms(opts: {
  dirs: string[];
  targetUid: number;
  targetGid: number;
  dryRun: boolean;
  normalizeMode: boolean;
  onLine: (line: string) => void;
}): FixStats {
  const { dirs, targetUid, targetGid, dryRun, normalizeMode, onLine } = opts;
  const stats: FixStats = { checked: 0, ownerFixed: 0, modeFixed: 0, skipped: 0, failed: 0 };

  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e: any) {
      stats.failed++;
      onLine(`  ✗ 无法读取目录 ${dir}：${e?.message || e}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const showRel = rel ? `${rel}/${entry.name}` : entry.name;
      stats.checked++;
      let st: fs.Stats;
      try {
        st = fs.lstatSync(full);
      } catch (e: any) {
        stats.failed++;
        onLine(`  ✗ 无法读取 ${full}：${e?.message || e}`);
        continue;
      }
      let changed = false;
      if (targetUid >= 0 && st.uid !== targetUid) {
        if (dryRun) {
          onLine(`  · 将修正属主 ${showRel}：uid ${st.uid}(${userNameOf(st.uid)}) → ${targetUid}(${userNameOf(targetUid)})`);
        } else {
          try {
            fs.chownSync(full, targetUid, targetGid >= 0 ? targetGid : st.gid);
          } catch (e: any) {
            stats.failed++;
            onLine(`  ✗ chown 失败 ${full}：${e?.message || e}`);
            continue;
          }
          onLine(`  ✓ 已修正属主 ${showRel}：uid ${st.uid} → ${targetUid}`);
        }
        changed = true;
        stats.ownerFixed++;
      }
      if (normalizeMode) {
        const want = entry.isDirectory() ? 0o755 : 0o644;
        const mode = st.mode & 0o777;
        const works = entry.isDirectory() ? (mode & 0o500) === 0o500 : (mode & 0o600) === 0o600;
        if (!works) {
          if (dryRun) {
            onLine(`  · 将修正权限 ${showRel}：${modeString(mode)} → ${want.toString(8)}`);
          } else {
            try {
              fs.chmodSync(full, want);
              onLine(`  ✓ 已修正权限 ${showRel}：${modeString(mode)} → ${want.toString(8)}`);
            } catch (e: any) {
              stats.failed++;
              onLine(`  ✗ chmod 失败 ${full}：${e?.message || e}`);
            }
          }
          changed = true;
          stats.modeFixed++;
        }
      }
      if (!changed) stats.skipped++;
      if (entry.isDirectory()) walk(full, showRel, depth + 1);
    }
  };

  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      onLine(`  · 跳过（不存在）：${d}`);
      continue;
    }
    stats.checked++;
    let st: fs.Stats;
    try {
      st = fs.statSync(d);
    } catch {
      continue;
    }
    if (targetUid >= 0 && st.uid !== targetUid) {
      if (dryRun) onLine(`  · 将修正属主 ${d}：uid ${st.uid} → ${targetUid}`);
      else {
        try {
          fs.chownSync(d, targetUid, targetGid >= 0 ? targetGid : st.gid);
          onLine(`  ✓ 已修正属主 ${d}：uid ${st.uid} → ${targetUid}`);
        } catch (e: any) {
          stats.failed++;
          onLine(`  ✗ chown 失败 ${d}：${e?.message || e}`);
        }
      }
      stats.ownerFixed++;
    }
    walk(d, "", 1);
  }

  return stats;
}
