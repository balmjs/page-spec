#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// ANSI formatting helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(msg) {
  console.log(msg);
}

function info(msg) {
  console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}✔${colors.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function error(msg) {
  console.error(`${colors.red}✖${colors.reset} ${msg}`);
}

function run(command, options = {}) {
  try {
    const res = execSync(command, {
      cwd: rootDir,
      encoding: 'utf-8',
      stdio: options.stdio || 'pipe',
      ...options,
    });
    return typeof res === 'string' ? res.trim() : '';
  } catch (err) {
    if (options.ignoreError) return null;
    throw err;
  }
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null,
  };
}

function bumpVersion(currentVersion, type) {
  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    throw new Error(`无法解析当前版本号: ${currentVersion}`);
  }
  switch (type) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      return currentVersion;
  }
}

function checkGitWorkingTree() {
  const status = run('git status --porcelain');
  return status.length === 0;
}

function getLatestTag() {
  return run('git describe --tags --abbrev=0', { ignoreError: true });
}

function generateReleaseNotes(currentTag, prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : 'HEAD';
  const logs = run(`git log ${range} --pretty=format:"%s (%h)"`, { ignoreError: true }) || '';
  const lines = logs.split('\n').filter(Boolean);

  const features = [];
  const fixes = [];
  const others = [];

  for (const line of lines) {
    if (/^feat(\(.*?\))?:/i.test(line)) {
      features.push(`- ${line.replace(/^feat(\(.*?\))?:\s*/i, '')}`);
    } else if (/^fix(\(.*?\))?:/i.test(line)) {
      fixes.push(`- ${line.replace(/^fix(\(.*?\))?:\s*/i, '')}`);
    } else if (!/^chore\(release\)/i.test(line)) {
      others.push(`- ${line}`);
    }
  }

  let notes = `## What's Changed\n\n`;

  if (features.length > 0) {
    notes += `### 🚀 新增功能 (Features)\n${features.join('\n')}\n\n`;
  }
  if (fixes.length > 0) {
    notes += `### 🐛 缺陷修复 (Bug Fixes)\n${fixes.join('\n')}\n\n`;
  }
  if (others.length > 0) {
    notes += `### 🔧 优化与杂项 (Maintenance)\n${others.join('\n')}\n\n`;
  }
  if (features.length === 0 && fixes.length === 0 && others.length === 0) {
    notes += `- 包含日常性能优化与缺陷修复。\n\n`;
  }

  notes += `### 📦 安装指引 (Installation Guide)\n\n`;
  notes += `#### Chrome / Edge 等 Chromium 内核浏览器\n`;
  notes += `1. 下载附件中的 \`page-spec-${currentTag.replace(/^v/, '')}-chrome.zip\` 并解压。\n`;
  notes += `2. 打开浏览器扩展管理页面（Chrome 访问 \`chrome://extensions/\`，Edge 访问 \`edge://extensions/\`）。\n`;
  notes += `3. 打开右上角 **「开发者模式」** 开关。\n`;
  notes += `4. 点击左上角 **「加载已解压的扩展程序」**，选择刚才解压出来的目录即可。\n\n`;

  notes += `#### Firefox (火狐浏览器)\n`;
  notes += `1. 下载附件中的 \`page-spec-${currentTag.replace(/^v/, '')}-firefox.zip\` 并解压。\n`;
  notes += `2. 打开调试页面 \`about:debugging#/runtime/this-firefox\`。\n`;
  notes += `3. 点击 **「临时载入附加组件...」**，选择解压目录下的 \`manifest.json\` 文件即可。\n`;

  return notes;
}

function checkGhAuth() {
  const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8' });
  return result.status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isDraft = args.includes('--draft');
  const isPrerelease = args.includes('--prerelease');
  const skipBuild = args.includes('--skip-build');
  const skipGitCheck = args.includes('--force') || isDryRun;

  log(`\n${colors.bold}${colors.magenta}🚀 PageSpec 插件自动化发布工具${colors.reset}\n`);

  if (isDryRun) {
    warn('当前为 [Dry Run] 预演模式，不会创建 Git Tag、Commit 或上传至远程仓库。');
  }

  // 1. 检查工作目录状态
  if (!skipGitCheck && !checkGitWorkingTree()) {
    error('Git 工作区有未提交的修改，请先提交或保存后再运行发布脚本！');
    process.exit(1);
  }

  // 2. 读取 package.json
  const pkgPath = resolve(rootDir, 'package.json');
  const pkgContent = readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);
  const currentVersion = pkg.version;

  info(`当前版本: ${colors.bold}v${currentVersion}${colors.reset}`);

  // 3. 确定目标版本号
  let targetVersion = null;
  const positionalArg = args.find((a) => !a.startsWith('--'));

  if (positionalArg) {
    if (['major', 'minor', 'patch'].includes(positionalArg)) {
      targetVersion = bumpVersion(currentVersion, positionalArg);
    } else if (parseSemver(positionalArg.replace(/^v/, ''))) {
      targetVersion = positionalArg.replace(/^v/, '');
    } else {
      error(`无效的版本参数: ${positionalArg}`);
      process.exit(1);
    }
  } else {
    // 交互式提示选择版本
    const patchVer = bumpVersion(currentVersion, 'patch');
    const minorVer = bumpVersion(currentVersion, 'minor');
    const majorVer = bumpVersion(currentVersion, 'major');

    log(`\n请选择要发布的版本类型:`);
    log(`  1) ${colors.green}patch${colors.reset}   ${colors.dim}(v${currentVersion} -> v${patchVer})${colors.reset}`);
    log(`  2) ${colors.yellow}minor${colors.reset}   ${colors.dim}(v${currentVersion} -> v${minorVer})${colors.reset}`);
    log(`  3) ${colors.red}major${colors.reset}   ${colors.dim}(v${currentVersion} -> v${majorVer})${colors.reset}`);
    log(`  4) 自定义版本 (custom)`);

    const rl = readline.createInterface({ input, output });
    const choice = (await rl.question(`\n请输入编号或直接输入版本号 [1]: `)).trim();

    if (!choice || choice === '1') {
      targetVersion = patchVer;
    } else if (choice === '2') {
      targetVersion = minorVer;
    } else if (choice === '3') {
      targetVersion = majorVer;
    } else if (choice === '4') {
      const customVer = (await rl.question('请输入目标版本号 (例如 1.0.1): ')).trim().replace(/^v/, '');
      if (!parseSemver(customVer)) {
        error(`版本号格式错误: ${customVer}`);
        rl.close();
        process.exit(1);
      }
      targetVersion = customVer;
    } else if (parseSemver(choice.replace(/^v/, ''))) {
      targetVersion = choice.replace(/^v/, '');
    } else {
      error('无效的选择！');
      rl.close();
      process.exit(1);
    }
    rl.close();
  }

  const tagName = `v${targetVersion}`;
  info(`目标版本: ${colors.bold}${colors.green}${tagName}${colors.reset}`);

  // 4. 类型检查与代码构建
  if (!skipBuild) {
    info('执行 TypeScript 类型检查 (pnpm typecheck)...');
    run('pnpm typecheck', { stdio: 'inherit' });
    success('类型检查通过');

    // 更新 package.json 保证打包出来的 zip 带有新的版本号
    pkg.version = targetVersion;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    info(`已更新 package.json 中的 version 为 ${targetVersion}`);

    info('正在打包 Chrome MV3 扩展包 (pnpm zip)...');
    run('pnpm zip', { stdio: 'inherit' });

    info('正在打包 Firefox 扩展包 (pnpm zip:firefox)...');
    run('pnpm zip:firefox', { stdio: 'inherit' });
  }

  // 5. 校验 ZIP 产物
  const outputDir = resolve(rootDir, '.output');
  const chromeZip = join(outputDir, `page-spec-${targetVersion}-chrome.zip`);
  const firefoxZip = join(outputDir, `page-spec-${targetVersion}-firefox.zip`);

  if (!existsSync(chromeZip)) {
    if (isDryRun) writeFileSync(pkgPath, pkgContent);
    error(`未找到 Chrome 产物文件: ${chromeZip}`);
    process.exit(1);
  }
  if (!existsSync(firefoxZip)) {
    if (isDryRun) writeFileSync(pkgPath, pkgContent);
    error(`未找到 Firefox 产物文件: ${firefoxZip}`);
    process.exit(1);
  }

  success(`已生成 Chrome 扩展包: ${colors.dim}${chromeZip}${colors.reset}`);
  success(`已生成 Firefox 扩展包: ${colors.dim}${firefoxZip}${colors.reset}`);

  // 6. 生成 Release Notes
  const prevTag = getLatestTag();
  info(`上一个 Release Tag: ${prevTag || '(无，从第一个 commit 算起)'}`);
  const releaseNotes = generateReleaseNotes(tagName, prevTag);

  log(`\n${colors.bold}--- Release Notes 预览 ---${colors.reset}`);
  log(colors.dim + releaseNotes.trim() + colors.reset);
  log(`${colors.bold}---------------------------${colors.reset}\n`);

  if (isDryRun) {
    writeFileSync(pkgPath, pkgContent);
    info(`[Dry Run] 已还原 package.json`);
    success(`[Dry Run] 预演完成，所有打包与版本计算正常。`);
    return;
  }

  // 7. Git 提交与打 Tag
  const currentBranch = run('git rev-parse --abbrev-ref HEAD');
  info(`当前 Git 分支: ${currentBranch}`);

  info('提交版本变更与创建 Git Tag...');
  run(`git add package.json`);
  run(`git commit -m "chore(release): ${tagName}"`);
  run(`git tag -a "${tagName}" -m "Release ${tagName}"`);
  success(`已创建 Git Tag: ${tagName}`);

  info(`推送分支及 Tag 至远程 origin...`);
  run(`git push origin ${currentBranch}`);
  run(`git push origin ${tagName}`);
  success(`已成功推送至 GitHub`);

  // 8. 创建 GitHub Release 并上传资产
  const tempNotesFile = resolve(rootDir, '.temp_release_notes.md');
  writeFileSync(tempNotesFile, releaseNotes, 'utf-8');

  const hasGhAuth = checkGhAuth();
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  if (hasGhAuth || token) {
    info('检测到 GitHub 认证凭证，正在通过 GitHub CLI 发布 Release 并上传附件...');
    const releaseCmdArgs = [
      'release',
      'create',
      tagName,
      chromeZip,
      firefoxZip,
      '--title',
      tagName,
      '--notes-file',
      tempNotesFile,
    ];

    if (isDraft) releaseCmdArgs.push('--draft');
    if (isPrerelease) releaseCmdArgs.push('--prerelease');

    const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
    const releaseRes = spawnSync('gh', releaseCmdArgs, { cwd: rootDir, env, stdio: 'inherit' });

    if (existsSync(tempNotesFile)) unlinkSync(tempNotesFile);

    if (releaseRes.status === 0) {
      log(`\n${colors.bold}${colors.green}🎉 恭喜！版本 ${tagName} 发布成功！${colors.reset}`);
      log(`🔗 查看发布页: https://github.com/balmjs/page-spec/releases/tag/${tagName}\n`);
    } else {
      warn(`GitHub Release 上传遇到问题，请手动检查或重试。`);
    }
  } else {
    if (existsSync(tempNotesFile)) unlinkSync(tempNotesFile);

    warn(`\n本地尚未登录 GitHub CLI (gh auth login) 且未设置 GITHUB_TOKEN。`);
    log(`${colors.cyan}Git Tag 与代码已全部推送成功。你可以选择：${colors.reset}`);
    log(`  1. 运行 ${colors.bold}gh auth login${colors.reset} 登录后，重新执行一键发布命令：`);
    log(`     ${colors.dim}gh release create ${tagName} "${chromeZip}" "${firefoxZip}" --title "${tagName}" --notes "..."${colors.reset}`);
    log(`  2. 或直接点击下方链接在 GitHub Releases 网页中一键发布：`);
    log(`     ${colors.bold}${colors.cyan}https://github.com/balmjs/page-spec/releases/new?tag=${tagName}&title=${tagName}${colors.reset}`);
    log(`     并在附件栏中拖入以下两个生成好的 ZIP 包：`);
    log(`     - ${chromeZip}`);
    log(`     - ${firefoxZip}\n`);
  }
}

main().catch((err) => {
  error(err.message || String(err));
  process.exit(1);
});
