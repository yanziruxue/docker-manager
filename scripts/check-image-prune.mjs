/**
 * 「清理未使用镜像」门禁（v1.53.7）。
 *
 * 覆盖：
 *   ① 真实执行 server/image-prune.ts（esbuild data URL）：409 分类、CLI 文本归一化、
 *      逐轮重试至无进展、父子依赖顺序、失败明细、无进展提前退出；
 *   ② 源码接线：dockerode `remove({ force: true })` / SSH `docker rmi -f`、
 *      诊断字段 Candidates/Used/Failed 回传、前端结果文案与 failed 判定、服务端 warn 日志；
 *   ③ 进程级负向自检（3 类注入 → 子进程 exit 1 → 还原字节级一致）。
 *
 * 运行：node scripts/check-image-prune.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const IS_CHILD = process.env.IMAGE_PRUNE_GATE_NEGATIVE_CHILD === "1";

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} → ${a.length > 120 ? a.slice(0, 120) + "…" : a}`, a === e);
}

/** 编译真实 TS 模块（无临时产物，data URL 直接 import） */
async function loadModule(rel) {
  const built = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node20",
  });
  return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

const mod = await loadModule("server/image-prune.ts");
const { classifyImageRemoveError, describeImageRemoveError, removePruneCandidates } = mod;
const dockerSrc = read("server/docker.ts");
const indexSrc = read("server/index.ts");
const imagesSrc = read("src/pages/Images.tsx");
const moduleSrc = read("server/image-prune.ts");
const pkg = JSON.parse(read("package.json"));

console.log("== ① 真实模块执行（409 分类 / 人话原因 / 多轮删除） ==");

const conflictReferenced = {
  statusCode: 409,
  message: "(HTTP code 409) conflict - image is referenced in multiple repositories (must be forced)",
};
const conflictInUse = {
  statusCode: 409,
  message: "(HTTP code 409) conflict - image is being used by stopped container abc123 (cannot be forced)",
};
eq("409 多 RepoTag → IMAGE_REFERENCED", classifyImageRemoveError(conflictReferenced)?.code, "IMAGE_REFERENCED");
eq("409 容器占用 → IMAGE_IN_USE", classifyImageRemoveError(conflictInUse)?.code, "IMAGE_IN_USE");
eq("非 409 → null", classifyImageRemoveError(new Error("boom")), null);
ok("dockerode 409 转中文提示", describeImageRemoveError(conflictReferenced).includes("多个仓库标签"));
ok(
  "SSH CLI conflict 文本同样转中文提示",
  describeImageRemoveError({
    message: "Error response from daemon: conflict: unable to delete x (must be forced) - image is referenced in multiple repositories",
  }).includes("多个仓库标签")
);
ok("普通异常保留原始原因", describeImageRemoveError(new Error("socket hang up")) === "socket hang up");
ok("模块导出可调用", ["classifyImageRemoveError", "describeImageRemoveError", "removePruneCandidates"].every((k) => typeof mod[k] === "function"));

const c1 = { id: "a".repeat(64), repoTags: ["docker.1panel.live/henrygd/beszel:latest", "henrygd/beszel:latest"], size: 100 };
// 悬空镜像：服务端 imageRefsOf 会过滤掉 "<none>:<none>"，故 repoTags 为空数组
const c2 = { id: "b".repeat(64), repoTags: [], size: 200 };

// 1) 全部成功：每个候选只产出一条记录、失败明细为空
{
  const calls = [];
  const r = await removePruneCandidates([c1, c2], async (id) => { calls.push(id); });
  eq("全部成功 → 删除 2 条", r.deleted.length, 2);
  eq("全部成功 → 首条按 Untagged 记录", r.deleted[0], { Untagged: "docker.1panel.live/henrygd/beszel:latest" });
  eq("全部成功 → 悬空按 Deleted 记录", r.deleted[1], { Deleted: `sha256:${"b".repeat(64)}` });
  eq("全部成功 → 失败明细为空", r.failures, []);
  eq("全部成功 → fallback 字节数", r.fallbackBytes, 300);
  eq("全部成功 → 每个 ID 只调用一次", calls.length, 2);
}

// 2) 父子依赖顺序：父镜像第一轮失败、第二轮成功（多轮重试必须生效）
{
  let aCalls = 0;
  const r = await removePruneCandidates([c1, c2], async (id) => {
    if (id === c1.id && ++aCalls === 1) throw conflictReferenced;
  });
  eq("多轮重试 → 最终删除 2 条", r.deleted.length, 2);
  eq("多轮重试 → 成功后清除失败明细", r.failures, []);
  eq("多轮重试 → 父镜像被调用 2 次", aCalls, 2);
  eq("多轮重试 → fallback 字节数不重复计", r.fallbackBytes, 300);
}

// 3) 持续 409：零删除但必须带回人话原因，且无进展时提前退出
{
  let calls = 0;
  const r = await removePruneCandidates([c1, c2], async () => { calls++; throw conflictReferenced; });
  eq("持续冲突 → 零删除", r.deleted.length, 0);
  eq("持续冲突 → 2 条失败明细", r.failures.length, 2);
  ok("持续冲突 → 含中文原因", r.failures.every((f) => f.reason.includes("多个仓库标签")));
  eq("持续冲突 → 失败项带 ref", r.failures[0].ref, "docker.1panel.live/henrygd/beszel:latest");
  eq("持续冲突 → 无进展提前退出（仅 1 轮）", calls, 2);
}

// 4) 部分成功：成功项计入、失败项保留，重试只针对失败项
{
  let calls = 0;
  const r = await removePruneCandidates([c1, c2], async (id) => {
    calls++;
    if (id === c1.id) throw conflictInUse;
  });
  eq("部分成功 → 删除 1 条", r.deleted.length, 1);
  eq("部分成功 → 1 条失败明细", r.failures.length, 1);
  ok("部分成功 → 容器占用中文原因", r.failures[0].reason.includes("正在被容器使用"));
  eq("部分成功 → fallback 只计成功项", r.fallbackBytes, 200);
  eq("部分成功 → 重试仅针对失败项（3 次调用）", calls, 3);
}

console.log("\n== ② 源码接线 ==");
ok("dockerode 清理删除带 force: true", /\.remove\(\{ force: true \}\)/.test(dockerSrc));
ok("SSH 清理使用 docker rmi -f", /docker rmi -f /.test(dockerSrc));
ok("socket 分支接入 removePruneCandidates", /removePruneCandidates\(candidates, async \(id\)/.test(dockerSrc));
ok("socket 分支未残留无 force 的 prune 删除", !/docker\.getImage\(cand\.id\)\.remove\(\)/.test(dockerSrc));
ok("冲突分类从 image-prune.ts 重导出", /export \{ classifyImageRemoveError \} from "\.\/image-prune\.js"/.test(dockerSrc));
ok("回传 Candidates", /Candidates: candidates\.length/.test(dockerSrc));
ok("回传 Used", /Used: usedCount/.test(dockerSrc));
ok("回传 Failed（socket 分支）", /Failed: outcome\.failures/.test(dockerSrc));
ok("回传 Failed（SSH 分支）", /Failed: failures/.test(dockerSrc));
ok("SSH 同 ID 多 tag 先合并再判锁定", /isImageLocked\(locks, \{ id: g\.id, repoTags: g\.refs \}\)/.test(dockerSrc));
ok("PruneImagesResult 定义诊断字段", /Candidates\?: number/.test(dockerSrc) && /Failed\?: PruneFailure\[\]/.test(dockerSrc));
ok("服务端零删除写 warn 日志", /result\.Candidates/.test(indexSrc) && /apiLog\.warn/.test(indexSrc));
ok("前端读取 Candidates/Used/Failed", /result\.Candidates/.test(imagesSrc) && /result\.Used/.test(imagesSrc) && /result\.Failed/.test(imagesSrc));
ok("前端零删除但有候选时明确报失败", /但删除请求被拒绝（未删除任何镜像）/.test(imagesSrc));
ok("前端逐条展示失败原因", /f\.reason \|\| "未知原因"/.test(imagesSrc));
ok("前端操作日志区分静默失败", /const silentFailure = deletedCount === 0 && candidateCount > 0/.test(imagesSrc));
ok("前端静默失败记 failed + 红色输出", /status: "failed", detail: "有候选镜像但删除被拒绝，详见输出"/.test(imagesSrc) && /output: formatImagePrune\(result\), failed: true/.test(imagesSrc));
ok("前端共享层空间提示保留", /镜像层仍被其他镜像或容器共享/.test(imagesSrc));
ok("共享模块说明根因", /must be forced/.test(moduleSrc) && /静默吞掉/.test(moduleSrc));
ok("门禁已接入 test:imageprune", (pkg.scripts["test:imageprune"] || "").includes("check-image-prune.mjs"));
ok("test:gates 已接入 test:imageprune", (pkg.scripts["test:gates"] || "").includes("test:imageprune"));

console.log("\n== ③ 负向自检（进程级注入 3 类回归 → 重跑本门禁应 exit 1） ==");
if (!IS_CHILD) {
  const cases = [
    {
      name: "注入删除不带 force 回归",
      rel: "server/docker.ts",
      inject: (s) => s.replace("docker.getImage(id).remove({ force: true })", "docker.getImage(id).remove()"),
    },
    {
      name: "注入前端恢复静默「无需清理」回归",
      rel: "src/pages/Images.tsx",
      inject: (s) => s.replace("但删除请求被拒绝（未删除任何镜像）", "无需清理（没有可删除的未使用镜像）"),
    },
    {
      name: "注入诊断字段回传缺失回归",
      rel: "server/docker.ts",
      // socket 与 SSH 两处同名声明，必须 replaceAll（replace 只命中第一处会漏检）
      inject: (s) => s.replaceAll("Candidates: candidates.length,", "Locked: lockedCount,"),
    },
  ];
  for (const c of cases) {
    const file = path.join(ROOT, c.rel);
    const orig = fs.readFileSync(file);
    const mutated = c.inject(orig.toString("utf8"));
    if (mutated === orig.toString("utf8")) {
      fail++;
      console.log(`  FAIL  负向自检锚点失效（${c.name}，请更新门禁）`);
      continue;
    }
    fs.writeFileSync(file, Buffer.from(mutated, "utf8"));
    let childFailed = false;
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: "pipe",
        env: { ...process.env, IMAGE_PRUNE_GATE_NEGATIVE_CHILD: "1" },
      });
    } catch (e) {
      childFailed = e.status === 1;
    } finally {
      fs.writeFileSync(file, orig);
    }
    ok(`${c.name}被检出（子进程 exit 1）`, childFailed);
    ok(`${c.name}还原字节级一致`, fs.readFileSync(file).equals(orig));
  }
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
