/**
 * Cloudflare Worker 多项目部署管理器 (V10.11.0)
 * 更新日志 (V10.11.0)：
 * 1. [Feature] 动态嗅探 GitHub 默认分支与目标脚本（智能匹配 CMLiu _worker.js 与 Joey 少年你相信光吗）。
 * 2. [Fix] 适配 CFNEW 兼容时间 (compatibility_date: 2024-02-20)，解决批量部署时时间错乱导致连接失败 (Issue #10)。
 * 3. [Feature] 账号管理全量支持 API Token 与 Global API Key 双轨认证 (Issue #14)。
 * 4. [UI] 模板卡片与部署日志增加开源仓库直链及快捷访问路径指引 (/admin, /{uuid}) (Issue #3)。
 * 完整历史版本记录见 CHANGELOG.md
 */

// ==========================================
// 1. 后端配置与逻辑
// ==========================================
const TEMPLATES = {
    'cmliu': {
        name: "CMliu - EdgeTunnel",
        ghUser: "cmliu",
        ghRepo: "edgetunnel",
        ghBranch: "main",
        ghPath: "_worker.js",
        filePattern: "_worker.js",
        repoUrl: "https://github.com/cmliu/edgetunnel",
        adminPath: "/admin",
        compatibilityDate: "2024-04-05",
        defaultVars: ["UUID", "PROXYIP", "DOH", "PATH", "URL", "KEY", "ADMIN"],
        uuidField: "UUID",
        description: "CMliu (EdgeTunnel) - 建议开启 KV"
    },
    'joey': {
        name: "Joey - 少年你相信光吗",
        ghUser: "byJoey",
        ghRepo: "cfnew",
        ghBranch: "main",
        ghPath: "少年你相信光吗",
        filePattern: "少年你相信光吗",
        repoUrl: "https://github.com/byJoey/cfnew",
        adminPath: "",
        compatibilityDate: "2024-02-20",
        defaultVars: ["u"],
        uuidField: "u",
        description: "Joey (自动修复) - KV 可选"
    },
    'ech': {
        name: "ECH - WebSocket Proxy",
        ghUser: "hc990275",
        ghRepo: "ech-wk",
        ghBranch: "main",
        ghPath: "_worker.js",
        filePattern: "_worker.js",
        repoUrl: "https://github.com/hc990275/ech-wk",
        adminPath: "/admin",
        compatibilityDate: "2024-04-05",
        defaultVars: ["PROXYIP"],
        uuidField: "",
        description: "ECH (无需频繁更新)"
    }
};

const ECH_PROXIES = [
    { group: "🌐 自动 / 全球 (Global)", list: ["ProxyIP.CMLiussss.net"] },
    { group: "💸 亚洲 (Asia)", list: [
        "ProxyIP.HK.CMLiussss.net (香港 🇭🇰)",
        "ProxyIP.SG.CMLiussss.net (新加坡 🇸🇬)",
        "ProxyIP.JP.CMLiussss.net (日本 🇯🇵)",
        "ProxyIP.KR.CMLiussss.net (韩国 🇰🇷)",
        "ProxyIP.IN.CMLiussss.net (印度 🇮🇳)"
    ]},
    { group: "💸 欧洲 (Europe)", list: [
        "ProxyIP.GB.CMLiussss.net (英国 🇬🇧)",
        "ProxyIP.FR.CMLiussss.net (法国 🇫🇷)",
        "ProxyIP.DE.CMLiussss.net (德国 🇩🇪)",
        "ProxyIP.NL.CMLiussss.net (荷兰 🇳🇱)",
        "ProxyIP.SE.CMLiussss.net (瑞典 🇸🇪)",
        "ProxyIP.FI.CMLiussss.net (芬兰 🇫🇮)",
        "ProxyIP.PL.CMLiussss.net (波兰 🇵🇱)",
        "ProxyIP.RU.CMLiussss.net (俄罗斯 🇷🇺)",
        "ProxyIP.CH.CMLiussss.net (瑞士 🇨🇭)",
        "ProxyIP.LV.CMLiussss.net (拉脱维亚 🇱🇻)"
    ]},
    { group: "💵 北美 (North America)", list: [
        "ProxyIP.US.CMLiussss.net (美国 🇺🇸)",
        "ProxyIP.CA.CMLiussss.net (加拿大 🇨🇦)"
    ]},
    { group: "📣 第三方维护 (Third-party)", list: [
        "kr.william.us.ci (韩国 - 威廉)",
        "tw.william.us.ci (台湾 - 威廉)",
        "proxy.mia.xx.kg (Mia)"
    ]}
];

export default {
    async scheduled(event, env, ctx) {
        if (env.CONFIG_KV) {
            ctx.waitUntil(handleCronJob(env));
        }
    },

    async fetch(request, env) {
        try {
            if (!env.CONFIG_KV) {
                return new Response(`KV Not Bound (Error 1001)`, { status: 500 });
            }

            const url = new URL(request.url);
            const correctCode = env.ACCESS_CODE;
            const cookieHeader = request.headers.get("Cookie") || "";

            // 公开路由（无需认证）
            if (url.pathname === "/manifest.json") {
                return new Response(JSON.stringify({
                    "name": "Worker Pro", "short_name": "WorkerPro", "start_url": "/", "display": "standalone",
                    "background_color": "#f3f4f6", "theme_color": "#1e293b",
                    "icons": [{ "src": "https://www.cloudflare.com/img/logo-cloudflare-dark.svg", "sizes": "192x192", "type": "image/svg+xml" }]
                }), { headers: { "Content-Type": "application/json" } });
            }

            // 登录接口（POST 安全提交）
            if (url.pathname === "/api/login" && request.method === "POST") {
                const body = await request.json();
                if (body.code === correctCode) {
                    return new Response(JSON.stringify({ success: true }), {
                        headers: { "Content-Type": "application/json", "Set-Cookie": `auth=${correctCode}; Path=/; HttpOnly; Secure; Max-Age=86400; SameSite=Lax` }
                    });
                }
                return new Response(JSON.stringify({ success: false, msg: "密码错误" }), { status: 401, headers: { "Content-Type": "application/json" } });
            }

            // 认证检查（仅 Cookie，不再通过 URL 传递密码）
            if (correctCode && !cookieHeader.includes(`auth=${correctCode}`)) {
                return new Response(loginHtml(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });
            }

            // CSRF 防护（POST 请求校验 Origin）
            if (request.method === "POST") {
                const origin = request.headers.get("Origin");
                if (origin && new URL(origin).host !== url.host) {
                    return new Response(JSON.stringify({ success: false, msg: "CSRF rejected" }), { status: 403, headers: { "Content-Type": "application/json" } });
                }
            }

            const ACCOUNTS_KEY = `ACCOUNTS_UNIFIED_STORAGE`;
            const GLOBAL_CONFIG_KEY = `AUTO_UPDATE_CFG_GLOBAL`;

            // API 路由
            if (url.pathname === "/api/accounts") {
                if (request.method === "GET") return new Response(await env.CONFIG_KV.get(ACCOUNTS_KEY) || "[]", { headers: { "Content-Type": "application/json" } });
                if (request.method === "POST") { await env.CONFIG_KV.put(ACCOUNTS_KEY, JSON.stringify(await request.json())); return new Response(JSON.stringify({ success: true })); }
            }
            if (url.pathname === "/api/settings") {
                const type = url.searchParams.get("type");
                const VARS_KEY = `VARS_${type}`;
                if (request.method === "GET") return new Response(await env.CONFIG_KV.get(VARS_KEY) || "null", { headers: { "Content-Type": "application/json" } });
                if (request.method === "POST") { await env.CONFIG_KV.put(VARS_KEY, JSON.stringify(await request.json())); return new Response(JSON.stringify({ success: true })); }
            }
            if (url.pathname === "/api/deploy_config" && request.method === "GET") {
                const type = url.searchParams.get("type");
                const key = `DEPLOY_CONFIG_${type}`;
                const defaultCfg = { mode: 'latest', currentSha: null, deployTime: null };
                return new Response(await env.CONFIG_KV.get(key) || JSON.stringify(defaultCfg), { headers: { "Content-Type": "application/json" } });
            }
            if (url.pathname === "/api/favorites") {
                const type = url.searchParams.get("type");
                const key = `FAVORITES_${type}`;
                if (request.method === "GET") return new Response(await env.CONFIG_KV.get(key) || "[]", { headers: { "Content-Type": "application/json" } });
                if (request.method === "POST") {
                    const { action, item } = await request.json();
                    let favs = JSON.parse(await env.CONFIG_KV.get(key) || "[]");
                    if (action === 'add') { if (!favs.find(f => f.sha === item.sha)) favs.unshift(item); }
                    else if (action === 'remove') { favs = favs.filter(f => f.sha !== item.sha); }
                    await env.CONFIG_KV.put(key, JSON.stringify(favs));
                    return new Response(JSON.stringify({ success: true, favorites: favs }), { headers: { "Content-Type": "application/json" } });
                }
            }
            if (url.pathname === "/api/auto_config") {
                if (request.method === "GET") return new Response(await env.CONFIG_KV.get(GLOBAL_CONFIG_KEY) || "{}", { headers: { "Content-Type": "application/json" } });
                if (request.method === "POST") {
                    const body = await request.json();
                    await env.CONFIG_KV.put(GLOBAL_CONFIG_KEY, JSON.stringify(body));
                    return new Response(JSON.stringify({ success: true }));
                }
            }
            if (url.pathname === "/api/check_update" && request.method === "GET") {
                const type = url.searchParams.get("type");
                const mode = url.searchParams.get("mode");
                const limitStr = url.searchParams.get("limit");
                const limit = limitStr ? parseInt(limitStr) : 10;
                return await handleCheckUpdate(env, type, mode, limit);
            }
            if (url.pathname === "/api/get_code" && request.method === "GET") {
                const type = url.searchParams.get("type");
                return await handleGetCode(env, type);
            }
            if (url.pathname === "/api/deploy" && request.method === "POST") {
                const { type, variables, deletedVariables, targetSha, customCode, echTokenEnabled, echDisableWorkersDev, targetAccountIds } = await request.json();
                return await handleManualDeploy(env, type, variables, deletedVariables, ACCOUNTS_KEY, targetSha, customCode, echTokenEnabled, echDisableWorkersDev, targetAccountIds);
            }
            if (url.pathname === "/api/batch_deploy" && request.method === "POST") {
                const data = await request.json();
                return await handleBatchDeploy(env, data, ACCOUNTS_KEY);
            }
            if (url.pathname === "/api/zones" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken } = await request.json();
                return await handleGetZones(accountId, email, globalKey, apiToken);
            }
            if (url.pathname === "/api/all_workers" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken } = await request.json();
                return await handleGetAllWorkers(accountId, email, globalKey, apiToken);
            }
            if (url.pathname === "/api/delete_worker" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken, workerName, deleteKv } = await request.json();
                return await handleDeleteWorker(env, accountId, email, globalKey, apiToken, workerName, deleteKv);
            }
            if (url.pathname === "/api/stats" && request.method === "GET") return await handleStats(env, ACCOUNTS_KEY);
            if (url.pathname === "/api/fetch_bindings" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken, workerName } = await request.json();
                return await handleFetchBindings(accountId, email, globalKey, apiToken, workerName);
            }
            if (url.pathname === "/api/get_subdomain" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken } = await request.json();
                return await handleGetSubdomain(accountId, email, globalKey, apiToken);
            }
            if (url.pathname === "/api/change_subdomain" && request.method === "POST") {
                const { accountId, email, globalKey, apiToken, newSubdomain } = await request.json();
                return await handleChangeSubdomain(accountId, email, globalKey, apiToken, newSubdomain);
            }
            if (url.pathname === "/api/fix_1101" && request.method === "POST") {
                const { type } = await request.json();
                return await handleFix1101(env, type);
            }
            if (url.pathname === "/api/get_regions_data" && request.method === "GET") {
                return await handleGetRegionsData();
            }
            if (url.pathname === "/api/save_yxip" && request.method === "POST") {
                const data = await request.json();
                return await handleSaveYxip(env, data, ACCOUNTS_KEY);
            }

            return new Response(mainHtml(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });

        } catch (err) {
            return new Response(JSON.stringify({ success: false, msg: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
    }
};

// ================= 后端辅助函数 =================

function getAuthHeaders(emailOrAcc, key = null) {
    if (typeof emailOrAcc === 'object' && emailOrAcc !== null) {
        if (emailOrAcc.apiToken && emailOrAcc.apiToken.trim()) {
            return { "Authorization": `Bearer ${emailOrAcc.apiToken.trim()}`, "Content-Type": "application/json" };
        }
        return { "X-Auth-Email": emailOrAcc.email, "X-Auth-Key": emailOrAcc.globalKey, "Content-Type": "application/json" };
    }
    if (!key && emailOrAcc) {
        return { "Authorization": `Bearer ${emailOrAcc.trim()}`, "Content-Type": "application/json" };
    }
    return { "X-Auth-Email": emailOrAcc, "X-Auth-Key": key, "Content-Type": "application/json" };
}

function getUploadHeaders(emailOrAcc, key = null) {
    if (typeof emailOrAcc === 'object' && emailOrAcc !== null) {
        if (emailOrAcc.apiToken && emailOrAcc.apiToken.trim()) {
            return { "Authorization": `Bearer ${emailOrAcc.apiToken.trim()}` };
        }
        return { "X-Auth-Email": emailOrAcc.email, "X-Auth-Key": emailOrAcc.globalKey };
    }
    if (!key && emailOrAcc) {
        return { "Authorization": `Bearer ${emailOrAcc.trim()}` };
    }
    return { "X-Auth-Email": emailOrAcc, "X-Auth-Key": key };
}

async function resolveGithubUrls(env, type, sha = null) {
    const t = TEMPLATES[type];
    const cacheKey = `GH_INFO_CACHE_${type}`;
    let branch = t.ghBranch || 'main';
    let path = t.ghPath;

    // 尝试从 KV 缓存获取探测结果（未指定特定 sha 时加速）
    if (!sha && env && env.CONFIG_KV) {
        try {
            const cached = await env.CONFIG_KV.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Date.now() - (parsed.time || 0) < 15 * 60 * 1000) {
                    branch = parsed.branch || branch;
                    path = parsed.path || path;
                }
            }
        } catch (e) { }
    }

    const headers = { "User-Agent": "Cloudflare-Worker-Manager" };
    if (env && env.GITHUB_TOKEN) headers["Authorization"] = `token ${env.GITHUB_TOKEN}`;

    // 如果未缓存或需要探测
    if (!sha && (!branch || !path || path === t.ghPath)) {
        try {
            // 1. 获取默认分支
            const repoRes = await fetch(`https://api.github.com/repos/${t.ghUser}/${t.ghRepo}`, { headers });
            if (repoRes.ok) {
                const repoData = await repoRes.json();
                if (repoData.default_branch) branch = repoData.default_branch;
            }

            // 2. 获取树形文件列表以智能探测匹配文件
            const treeRes = await fetch(`https://api.github.com/repos/${t.ghUser}/${t.ghRepo}/git/trees/${branch}?recursive=1`, { headers });
            if (treeRes.ok) {
                const treeData = await treeRes.json();
                if (Array.isArray(treeData.tree)) {
                    let matchedFile = null;
                    if (type === 'cmliu') {
                        // 匹配以 _worker.js 结尾的文件，优先根目录
                        const files = treeData.tree.filter(item => item.type === 'blob' && item.path.endsWith('_worker.js'));
                        if (files.length > 0) {
                            matchedFile = files.find(f => f.path === '_worker.js') || files[0];
                        }
                    } else if (type === 'joey') {
                        // 匹配包含“少年你相信光吗”或 _worker.js
                        const files = treeData.tree.filter(item => item.type === 'blob' && (item.path.includes('少年你相信光吗') || item.path.endsWith('_worker.js')));
                        if (files.length > 0) {
                            matchedFile = files.find(f => f.path.includes('少年你相信光吗')) || files[0];
                        }
                    } else if (t.filePattern) {
                        const files = treeData.tree.filter(item => item.type === 'blob' && item.path.includes(t.filePattern));
                        if (files.length > 0) matchedFile = files[0];
                    }

                    if (matchedFile && matchedFile.path) {
                        path = matchedFile.path;
                    }
                }
            }

            // 写入 KV 缓存
            if (env && env.CONFIG_KV) {
                await env.CONFIG_KV.put(cacheKey, JSON.stringify({ branch, path, time: Date.now() }));
            }
        } catch (e) {
            console.error(`[GH Resolve Warning] ${type}: ${e.message}`);
        }
    }

    const safePath = path.split('/').map(p => encodeURIComponent(p)).join('/');
    const apiUrl = `https://api.github.com/repos/${t.ghUser}/${t.ghRepo}/commits`;
    const ref = sha || branch;
    const scriptUrl = `https://raw.githubusercontent.com/${t.ghUser}/${t.ghRepo}/${ref}/${safePath}`;

    return { apiUrl, scriptUrl, branch, path };
}



async function handleCronJob(env) {
    const ACCOUNTS_KEY = `ACCOUNTS_UNIFIED_STORAGE`;
    const GLOBAL_CONFIG_KEY = `AUTO_UPDATE_CFG_GLOBAL`;
    const configStr = await env.CONFIG_KV.get(GLOBAL_CONFIG_KEY);
    if (!configStr) return;
    const config = JSON.parse(configStr);
    if (!config.enabled) return;

    const now = Date.now();
    const lastCheck = config.lastCheck || 0;
    const intervalMs = (parseInt(config.interval) || 30) * 60 * 1000;


    if (now - lastCheck <= intervalMs) return;

    const accounts = JSON.parse(await env.CONFIG_KV.get(ACCOUNTS_KEY) || "[]");
    if (accounts.length === 0) return;

    const statsData = await fetchInternalStats(accounts);
    let actionTaken = false;

    const fuseThreshold = parseInt(config.fuseThreshold || 0);
    if (fuseThreshold > 0) {
        for (const acc of accounts) {
            const stat = statsData.find(s => s.alias === acc.alias);
            if (!stat || stat.error) continue;
            const limit = stat.max || 100000;
            // [熔断触发] 超过阈值
            if ((stat.total / limit) * 100 >= fuseThreshold) {
                // 动态识别需要熔断的模板（拥有 uuidField 的模板）
                const fuseTypes = Object.entries(TEMPLATES).filter(([_, t]) => t.uuidField).map(([k]) => k);
                for (const ft of fuseTypes) {
                    await rotateUUIDAndDeploy(env, ft, accounts, ACCOUNTS_KEY);
                }
                actionTaken = true;
                break;
            }
        }
    }

    if (!actionTaken) {
        // [自动更新] 动态识别模板
        const updateTypes = Object.entries(TEMPLATES).filter(([_, t]) => t.uuidField).map(([k]) => k);
        await Promise.all(updateTypes.map(type =>
            checkAndDeployUpdate(env, type, accounts, ACCOUNTS_KEY)
        ));
    }

    config.lastCheck = now;
    await env.CONFIG_KV.put(GLOBAL_CONFIG_KEY, JSON.stringify(config));
}

async function checkAndDeployUpdate(env, type, accounts, accountsKey) {
    try {
        const deployConfig = JSON.parse(await env.CONFIG_KV.get(`DEPLOY_CONFIG_${type}`) || '{"mode":"latest"}');
        if (deployConfig.mode === 'fixed') return;

        const res = await handleCheckUpdate(env, type, 'latest');
        const checkData = await res.json();

        if (checkData.remote && (!checkData.local || checkData.remote.sha !== checkData.local.sha)) {
            const varsStr = await env.CONFIG_KV.get(`VARS_${type}`);
            const variables = varsStr ? JSON.parse(varsStr) : [];
            await coreDeployLogic(env, type, variables, [], accountsKey, 'latest');
        }
    } catch (e) { console.error(`[Update Error] ${type}: ${e.message}`); }
}

async function rotateUUIDAndDeploy(env, type, accounts, accountsKey) {
    const VARS_KEY = `VARS_${type}`;
    const varsStr = await env.CONFIG_KV.get(VARS_KEY);
    let variables = varsStr ? JSON.parse(varsStr) : [];
    const uuidField = TEMPLATES[type].uuidField;
    if (!uuidField) return;

    let uuidUpdated = false;
    variables = variables.map(v => {
        if (v.key === uuidField) { v.value = crypto.randomUUID(); uuidUpdated = true; }
        return v;
    });
    if (!uuidUpdated) variables.push({ key: uuidField, value: crypto.randomUUID() });
    await env.CONFIG_KV.put(VARS_KEY, JSON.stringify(variables));

    const deployConfig = JSON.parse(await env.CONFIG_KV.get(`DEPLOY_CONFIG_${type}`) || '{"mode":"latest"}');
    const targetSha = deployConfig.mode === 'fixed' ? deployConfig.currentSha : 'latest';
    await coreDeployLogic(env, type, variables, [], accountsKey, targetSha);
}

async function handleGetCode(env, type) {
    try {
        const { scriptUrl } = await resolveGithubUrls(env, type);
        const res = await fetch(scriptUrl);
        if (!res.ok) throw new Error("Fetch failed: " + res.status);
        const code = await res.text();
        return new Response(JSON.stringify({ success: true, code: code }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleCheckUpdate(env, type, mode, limit = 10) {
    try {
        const DEPLOY_CONFIG_KEY = `DEPLOY_CONFIG_${type}`;
        const deployConfig = JSON.parse(await env.CONFIG_KV.get(DEPLOY_CONFIG_KEY) || '{"mode":"latest"}');
        const localSha = deployConfig.currentSha;
        const localTime = deployConfig.deployTime;
        const { apiUrl, branch, path } = await resolveGithubUrls(env, type);

        let fetchUrl = apiUrl + (mode === 'history' ? `?sha=${branch}&per_page=${limit}` : `?sha=${branch}&per_page=1`);
        const headers = { "User-Agent": "Cloudflare-Worker-Manager" };
        if (env.GITHUB_TOKEN) headers["Authorization"] = `token ${env.GITHUB_TOKEN}`;

        const ghRes = await fetch(fetchUrl + `&t=${Date.now()}`, { headers });
        if (!ghRes.ok) throw new Error(`GitHub API Error: ${ghRes.status}`);
        const ghData = await ghRes.json();

        if (mode === 'history') return new Response(JSON.stringify({ history: ghData }), { headers: { "Content-Type": "application/json" } });

        const latestCommit = Array.isArray(ghData) ? ghData[0] : ghData;
        let localCommitInfo = null;
        if (localSha) {
            if (localSha === latestCommit.sha) {
                localCommitInfo = { sha: localSha, date: latestCommit.commit.committer.date };
            } else {
                localCommitInfo = { sha: localSha, date: localTime };
            }
        }

        return new Response(JSON.stringify({
            local: localCommitInfo,
            remote: { sha: latestCommit.sha, date: latestCommit.commit.committer.date, message: latestCommit.commit.message },
            mode: deployConfig.mode,
            resolvedBranch: branch,
            resolvedPath: path
        }), { headers: { "Content-Type": "application/json" } });

    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500 }); }
}

async function handleManualDeploy(env, type, variables, deletedVariables, accountsKey, targetSha, customCode, echTokenEnabled, echDisableWorkersDev, targetAccountIds) {
    if (customCode) {
        const result = await coreDeployLogic(env, type, variables, deletedVariables, accountsKey, targetSha, customCode, echTokenEnabled, echDisableWorkersDev, targetAccountIds);
        return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }
    const result = await coreDeployLogic(env, type, variables, deletedVariables, accountsKey, targetSha, null, echTokenEnabled, echDisableWorkersDev, targetAccountIds);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
}

async function handleBatchDeploy(env, reqData, accountsKey) {
    const { template, workerName, kvName, config, targetAccounts, disableWorkersDev, customDomainPrefix, enableKV, savedVars } = reqData;
    const allAccounts = JSON.parse(await env.CONFIG_KV.get(accountsKey) || "[]");

    const accountsToDeploy = allAccounts.filter(a => targetAccounts.includes(a.alias));
    if (accountsToDeploy.length === 0) return new Response(JSON.stringify([{ name: "错误", success: false, msg: "未选择有效账号" }]), { headers: { "Content-Type": "application/json" } });

    let scriptContent = "";
    const { scriptUrl } = await resolveGithubUrls(env, template);
    try {
        const codeRes = await fetch(scriptUrl);
        if (!codeRes.ok) throw new Error("代码拉取失败: " + codeRes.status);
        scriptContent = await codeRes.text();
        if (template === 'joey') scriptContent = 'var window = globalThis;\n' + scriptContent;
    } catch (e) {
        return new Response(JSON.stringify([{ name: "网络错误", success: false, msg: e.message }]), { headers: { "Content-Type": "application/json" } });
    }

    const logs = [];
    let updatedAccounts = false;
    const compatDate = TEMPLATES[template]?.compatibilityDate || "2024-02-20";

    for (const acc of accountsToDeploy) {
        const log = { name: `${acc.alias} -> [${workerName}]`, success: false, msg: "" };
        try {
            const jsonHeaders = getAuthHeaders(acc);

            let nsId = "";
            if (enableKV) {
                const nsListRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/storage/kv/namespaces?per_page=100`, { headers: jsonHeaders });
                if (!nsListRes.ok) throw new Error("无法读取KV列表");
                const nsList = (await nsListRes.json()).result;
                const existNs = nsList.find(n => n.title === kvName);
                if (existNs) { nsId = existNs.id; } else {
                    const createNsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/storage/kv/namespaces`, {
                        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ title: kvName })
                    });
                    if (!createNsRes.ok) throw new Error("创建KV失败: " + (await createNsRes.json()).errors[0].message);
                    nsId = (await createNsRes.json()).result.id;
                }
            }

            const bindings = [];
            if (enableKV && nsId) {
                if (template === 'cmliu') bindings.push({ name: "KV", type: "kv_namespace", namespace_id: nsId });
                if (template === 'joey') bindings.push({ name: "C", type: "kv_namespace", namespace_id: nsId });
            }

            // 如果前端传了已保存变量，优先使用
            if (savedVars && Array.isArray(savedVars) && savedVars.length > 0) {
                savedVars.forEach(v => {
                    if (v.key && !bindings.find(b => b.name === v.key)) {
                        bindings.push({ name: v.key, type: "plain_text", text: v.value || "" });
                    }
                });
            } else {
                // 回退到 config 配置
                if (config.admin) bindings.push({ name: "ADMIN", type: "plain_text", text: config.admin });
                if (template === 'joey' && config.uuid) bindings.push({ name: "u", type: "plain_text", text: config.uuid });

                const defaultVars = TEMPLATES[template].defaultVars;
                defaultVars.forEach(key => {
                    if (key !== 'KV' && key !== 'C' && key !== 'ADMIN' && key !== 'u') {
                        if (key === 'UUID') {
                            bindings.push({ name: "UUID", type: "plain_text", text: config.uuid || crypto.randomUUID() });
                        } else {
                            bindings.push({ name: key, type: "plain_text", text: "" });
                        }
                    }
                });
            }

            const metadata = { main_module: "index.js", bindings: bindings, compatibility_date: compatDate };
            const formData = new FormData();
            formData.append("metadata", JSON.stringify(metadata));
            formData.append("script", new Blob([scriptContent], { type: "application/javascript+module" }), "index.js");

            const uploadHeaders = getUploadHeaders(acc);
            const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${workerName}`, {
                method: "PUT", headers: uploadHeaders, body: formData
            });

            if (deployRes.ok) {
                log.success = true;
                let msgs = [];
                const adminSuffix = TEMPLATES[template]?.adminPath || "";
                if (customDomainPrefix && acc.defaultZoneId && acc.defaultZoneName) {
                    const hostname = `${customDomainPrefix}.${acc.defaultZoneName}`;
                    const domainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/domains`, {
                        method: "PUT", headers: jsonHeaders,
                        body: JSON.stringify({ hostname: hostname, service: workerName, zone_id: acc.defaultZoneId })
                    });
                    if (domainRes.ok) msgs.push(`✅ 域名: https://${hostname}${adminSuffix}`);
                    else msgs.push(`⚠️ 域名绑定失败`);
                }
                if (disableWorkersDev) {
                    await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${workerName}/subdomain`, {
                        method: "POST", headers: jsonHeaders, body: JSON.stringify({ enabled: false })
                    });
                    msgs.push(`🚫 默认域名已禁用`);
                } else {
                    await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${workerName}/subdomain`, {
                        method: "POST", headers: jsonHeaders, body: JSON.stringify({ enabled: true })
                    });
                    const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/subdomain`, { headers: jsonHeaders });
                    const prefix = (await subRes.json()).result?.subdomain || "unknown";
                    msgs.push(`✅ 默认: https://${workerName}.${prefix}.workers.dev${adminSuffix}`);
                }
                log.msg = msgs.join(" | ");
                if (!acc[`workers_${template}`]) acc[`workers_${template}`] = [];
                if (!acc[`workers_${template}`].includes(workerName)) {
                    acc[`workers_${template}`].push(workerName);
                    updatedAccounts = true;
                }
            } else {
                log.msg = `❌ ${(await deployRes.json()).errors?.[0]?.message}`;
            }
        } catch (e) { log.msg = `❌ ${e.message}`; }
        logs.push(log);
    }

    if (updatedAccounts) {
        const finalAccounts = allAccounts.map(a => {
            const updated = accountsToDeploy.find(u => u.alias === a.alias);
            return updated ? updated : a;
        });
        await env.CONFIG_KV.put(accountsKey, JSON.stringify(finalAccounts));
    }
    return new Response(JSON.stringify(logs), { headers: { "Content-Type": "application/json" } });
}

// 核心部署逻辑
async function coreDeployLogic(env, type, variables, deletedVariables, accountsKey, targetSha, customCode = null, echTokenEnabled = false, echDisableWorkersDev = false, targetAccountIds = null) {
    try {
        // 规范化：'latest' 和空值统一视为“跟随最新”
        const isLatestMode = !targetSha || targetSha === 'latest';
        const shaForFetch = isLatestMode ? null : targetSha;

        let accounts = JSON.parse(await env.CONFIG_KV.get(accountsKey) || "[]");
        if (targetAccountIds && targetAccountIds.length > 0) {
            accounts = accounts.filter(a => targetAccountIds.includes(a.accountId));
        }
        if (accounts.length === 0) return [{ name: "提示", success: false, msg: "无账号配置" }];

        let githubScriptContent = "";
        let deployedSha = shaForFetch;

        if (customCode) {
            // 前端已提供混淆后的代码，直接使用
            githubScriptContent = customCode;
            if (!deployedSha) {
                // 获取最新 commit SHA
                const { apiUrl, branch } = await resolveGithubUrls(env, type, null);
                const headers = { "User-Agent": "CF-Worker" };
                if (env.GITHUB_TOKEN) headers["Authorization"] = `token ${env.GITHUB_TOKEN}`;
                try {
                    const apiRes = await fetch(apiUrl + `?sha=${branch}&per_page=1`, { headers });
                    if (apiRes.ok) deployedSha = (await apiRes.json())[0].sha;
                } catch (e) { }
            }
        } else {
            // 从 GitHub 下载代码
            const { scriptUrl, apiUrl, branch } = await resolveGithubUrls(env, type, shaForFetch);
            try {
                const codeRes = await fetch(scriptUrl + `?t=${Date.now()}`);
                if (!codeRes.ok) throw new Error(`代码下载失败: ${codeRes.status}`);
                githubScriptContent = await codeRes.text();

                if (!deployedSha) {
                    const headers = { "User-Agent": "CF-Worker" };
                    if (env.GITHUB_TOKEN) headers["Authorization"] = `token ${env.GITHUB_TOKEN}`;
                    const apiRes = await fetch(apiUrl + `?sha=${branch}&per_page=1`, { headers });
                    if (apiRes.ok) {
                        const commitData = (await apiRes.json())[0];
                        deployedSha = commitData.sha;
                    }
                }
            } catch (e) { return [{ name: "网络错误", success: false, msg: e.message }]; }
        }

        if (type === 'joey') githubScriptContent = 'var window = globalThis;\n' + githubScriptContent;
        if (type === 'ech') {
            const proxyVar = variables ? variables.find(v => v.key === 'PROXYIP') : null;
            const targetIP = proxyVar && proxyVar.value ? proxyVar.value.trim() : 'ProxyIP.CMLiussss.net';
            const proxyRegex = /const\s+CF_FALLBACK_IPS\s*=\s*\[.*?\];/s;
            githubScriptContent = githubScriptContent.replace(proxyRegex, `const CF_FALLBACK_IPS = ['${targetIP}'];`);

            // Token 注入：仅当 TOKEN 变量存在、有值且 echTokenEnabled=true 时才注入
            const tokenVar = variables ? variables.find(v => v.key === 'TOKEN') : null;
            const tokenVal = (tokenVar && tokenVar.value && tokenVar.value.trim() && echTokenEnabled)
                ? tokenVar.value.trim()
                : '';
            const tokenRegex = /const\s+token\s*=\s*['"]{1}.*?['"]{1};/;
            githubScriptContent = githubScriptContent.replace(tokenRegex, `const token = '${tokenVal}';`);
        }

        const compatDate = TEMPLATES[type]?.compatibilityDate || "2024-02-20";
        const logs = [];
        for (const acc of accounts) {
            const targetWorkers = acc[`workers_${type}`] || [];
            for (const wName of targetWorkers) {
                const logItem = { name: `${acc.alias} -> [${wName}]`, success: false, msg: "" };
                try {
                    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${wName}`;
                    const jsonHeaders = getAuthHeaders(acc);

                    const bindingsRes = await fetch(`${baseUrl}/bindings`, { headers: jsonHeaders });
                    let currentBindings = bindingsRes.ok ? (await bindingsRes.json()).result : [];
                    if (deletedVariables && deletedVariables.length > 0) currentBindings = currentBindings.filter(b => !deletedVariables.includes(b.name));

                    if (variables) {
                        variables.forEach(v => {
                            if (v.value && v.value.trim() !== "") {
                                const idx = currentBindings.findIndex(b => b.name === v.key);
                                if (idx !== -1) currentBindings[idx] = { name: v.key, type: "plain_text", text: v.value };
                                else currentBindings.push({ name: v.key, type: "plain_text", text: v.value });
                            }
                        });
                    }

                    const metadata = { main_module: "index.js", bindings: currentBindings, compatibility_date: compatDate };
                    const formData = new FormData();
                    formData.append("metadata", JSON.stringify(metadata));
                    formData.append("script", new Blob([githubScriptContent], { type: "application/javascript+module" }), "index.js");

                    const uploadHeaders = getUploadHeaders(acc);
                    const updateRes = await fetch(baseUrl, { method: "PUT", headers: uploadHeaders, body: formData });

                    if (updateRes.ok) {
                        logItem.success = true;
                        const msgs = [`✅ Ver: ${deployedSha ? deployedSha.substring(0, 7) : 'Unknown'}`];
                        // ECH 专属：控制 workers.dev 子域名启用/禁用
                        if (type === 'ech') {
                            try {
                                await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${wName}/subdomain`, {
                                    method: 'POST', headers: jsonHeaders,
                                    body: JSON.stringify({ enabled: !echDisableWorkersDev })
                                });
                                msgs.push(echDisableWorkersDev ? '🚫 默认域名已禁用' : '🌐 默认域名已启用');
                            } catch (e) { msgs.push('⚠️ 域名状态设置失败'); }
                        }
                        logItem.msg = msgs.join(' | ');
                    } else {
                        logItem.msg = `❌ ${(await updateRes.json()).errors?.[0]?.message}`;
                    }
                } catch (err) { logItem.msg = `❌ ${err.message}`; }
                logs.push(logItem);
            }
        }

        // 仅在至少有一个 worker 成功部署时才更新 DEPLOY_CONFIG
        const hasSuccess = logs.some(l => l.success);
        if (hasSuccess) {
            const DEPLOY_CONFIG_KEY = `DEPLOY_CONFIG_${type}`;
            const mode = isLatestMode ? 'latest' : 'fixed';
            await env.CONFIG_KV.put(DEPLOY_CONFIG_KEY, JSON.stringify({ mode: mode, currentSha: deployedSha || 'unknown', deployTime: new Date().toISOString() }));
        }
        return logs;
    } catch (e) { return [{ name: "系统错误", success: false, msg: e.message }]; }
}

async function fetchInternalStats(accounts) {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const query = `query getBillingMetrics($AccountID: String!, $filter: AccountWorkersInvocationsAdaptiveFilter_InputObject) {
         viewer { accounts(filter: {accountTag: $AccountID}) {
             workersInvocationsAdaptive(limit: 10000, filter: $filter) { sum { requests } }
             pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: $filter) { sum { requests } }
         }}}`;
    return await Promise.all(accounts.map(async (acc) => {
        try {
            const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
                method: "POST", headers: getAuthHeaders(acc),
                body: JSON.stringify({ query: query, variables: { AccountID: acc.accountId, filter: { datetime_geq: todayStart.toISOString(), datetime_leq: now.toISOString() } } })
            });
            const data = await res.json();
            const accountData = data.data?.viewer?.accounts?.[0];
            if (!accountData) return { alias: acc.alias, error: "无数据" };
            const workerReqs = accountData.workersInvocationsAdaptive?.reduce((a, b) => a + (b.sum.requests || 0), 0) || 0;
            const pagesReqs = accountData.pagesFunctionsInvocationsAdaptiveGroups?.reduce((a, b) => a + (b.sum.requests || 0), 0) || 0;
            return { alias: acc.alias, total: workerReqs + pagesReqs, max: 100000 };
        } catch (e) { return { alias: acc.alias, error: e.message }; }
    }));
}

async function handleStats(env, k) {
    try {
        const accounts = JSON.parse(await env.CONFIG_KV.get(k) || "[]");
        const results = await fetchInternalStats(accounts);
        return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500 }); }
}

async function handleFetchBindings(accountId, email, key, apiToken, workerName) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, {
            headers
        });
        const data = await res.json();
        const bindings = data.result
            .filter(b => b.type === "plain_text" || b.type === "secret_text")
            .map(b => ({ key: b.name, value: b.type === "plain_text" ? b.text : "" }));
        return new Response(JSON.stringify({ success: true, data: bindings }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleGetZones(accountId, email, key, apiToken) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&per_page=50`, {
            headers
        });
        const data = await res.json();
        const zones = data.result.map(z => ({ id: z.id, name: z.name }));
        return new Response(JSON.stringify({ success: true, zones: zones }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleGetAllWorkers(accountId, email, key, apiToken) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, {
            headers
        });
        const data = await res.json();
        const workers = data.result.map(w => ({
            id: w.id,
            created_on: w.created_on,
            modified_on: w.modified_on
        }));
        return new Response(JSON.stringify({ success: true, workers: workers }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleDeleteWorker(env, accountId, email, key, apiToken, workerName, deleteKv) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);

        let kvNamespaceIds = [];
        if (deleteKv) {
            const bindRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, { headers });
            if (bindRes.ok) {
                const binds = (await bindRes.json()).result;
                kvNamespaceIds = binds.filter(b => b.type === 'kv_namespace').map(b => b.namespace_id);
            }
        }

        const delWorkerRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}`, {
            method: "DELETE", headers
        });

        if (delWorkerRes.ok) {
            const ACCOUNTS_KEY = `ACCOUNTS_UNIFIED_STORAGE`;
            const accounts = JSON.parse(await env.CONFIG_KV.get(ACCOUNTS_KEY) || "[]");
            let updated = false;

            for (const acc of accounts) {
                if (acc.accountId === accountId) {
                    ['workers_cmliu', 'workers_joey', 'workers_ech'].forEach(type => {
                        if (acc[type] && acc[type].includes(workerName)) {
                            acc[type] = acc[type].filter(n => n !== workerName);
                            updated = true;
                        }
                    });
                }
            }

            if (updated) {
                await env.CONFIG_KV.put(ACCOUNTS_KEY, JSON.stringify(accounts));
            }

            if (deleteKv && kvNamespaceIds.length > 0) {
                await new Promise(r => setTimeout(r, 1000));
                for (const nsId of kvNamespaceIds) {
                    await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${nsId}`, {
                        method: "DELETE", headers
                    });
                }
            }
            return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
        } else {
            const err = await delWorkerRes.json();
            return new Response(JSON.stringify({ success: false, msg: err.errors[0]?.message || "删除失败" }), { status: 200 });
        }
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleGetSubdomain(accountId, email, key, apiToken) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers });
        const data = await res.json();
        if (data.success) {
            return new Response(JSON.stringify({ success: true, subdomain: data.result?.subdomain || '' }), { headers: { "Content-Type": "application/json" } });
        } else {
            return new Response(JSON.stringify({ success: false, msg: data.errors?.[0]?.message || '查询失败' }), { headers: { "Content-Type": "application/json" } });
        }
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleChangeSubdomain(accountId, email, key, apiToken, newSubdomain) {
    try {
        const headers = apiToken ? getAuthHeaders({ apiToken }) : getAuthHeaders(email, key);
        // Cloudflare API PUT subdomain 是 create-only，已有子域名需先 DELETE 再 PUT
        try {
            await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
                method: 'DELETE', headers
            });
        } catch (e) { }
        // 创建新子域名
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ subdomain: newSubdomain })
        });
        const data = await res.json();
        if (data.success) {
            return new Response(JSON.stringify({ success: true, subdomain: data.result?.subdomain || newSubdomain }), { headers: { "Content-Type": "application/json" } });
        } else {
            const errMsg = data.errors?.[0]?.message || '修改失败';
            if (errMsg.includes('already has')) {
                return new Response(JSON.stringify({ success: false, msg: 'Cloudflare 不支持通过 API 修改已有子域名，请到 Dashboard → Workers & Pages → 设置中手动修改。' }), { headers: { "Content-Type": "application/json" } });
            }
            return new Response(JSON.stringify({ success: false, msg: errMsg }), { headers: { "Content-Type": "application/json" } });
        }
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

// 一键修复 1101：删除 Worker → 改子域名 → 重建（带混淆）→ 恢复变量
async function handleFix1101(env, type) {
    const ACCOUNTS_KEY = `ACCOUNTS_UNIFIED_STORAGE`;
    const accounts = JSON.parse(await env.CONFIG_KV.get(ACCOUNTS_KEY) || "[]");
    if (accounts.length === 0) return new Response(JSON.stringify([{ name: "提示", success: false, msg: "无账号" }]), { headers: { "Content-Type": "application/json" } });

    const logs = [];

    // 1. 下载最新代码
    const { scriptUrl, apiUrl, branch } = await resolveGithubUrls(env, type, null);
    let freshCode;
    try {
        const codeRes = await fetch(scriptUrl + `?t=${Date.now()}`);
        if (!codeRes.ok) throw new Error(`HTTP ${codeRes.status}`);
        freshCode = await codeRes.text();
    } catch (e) {
        return new Response(JSON.stringify([{ name: "系统", success: false, msg: `代码下载失败: ${e.message}` }]), { headers: { "Content-Type": "application/json" } });
    }

    // 获取最新 SHA（用于更新 DEPLOY_CONFIG）
    let latestSha = null;
    try {
        const hdrs = { "User-Agent": "CF-Worker" };
        if (env.GITHUB_TOKEN) hdrs["Authorization"] = `token ${env.GITHUB_TOKEN}`;
        const apiRes = await fetch(apiUrl + `?sha=${branch}&per_page=1`, { headers: hdrs });
        if (apiRes.ok) latestSha = (await apiRes.json())[0].sha;
    } catch (e) { }

    const compatDate = TEMPLATES[type]?.compatibilityDate || "2024-02-20";

    for (const acc of accounts) {
        const targetWorkers = acc[`workers_${type}`] || [];
        if (targetWorkers.length === 0) {
            logs.push({ name: acc.alias, success: false, msg: "⏭️ 无此类 Worker，跳过" });
            continue;
        }

        const headers = getAuthHeaders(acc);

        for (const wName of targetWorkers) {
            const logItem = { name: `${acc.alias} → [${wName}]`, success: false, msg: "" };
            const steps = [];
            try {
                const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${wName}`;

                // Step 1: 记录当前变量绑定
                let savedBindings = [];
                try {
                    const bindRes = await fetch(`${baseUrl}/bindings`, { headers });
                    if (bindRes.ok) {
                        savedBindings = (await bindRes.json()).result || [];
                    }
                } catch (e) { }
                const varCount = savedBindings.filter(b => b.type === 'plain_text').length;
                steps.push(`📋 记录 ${savedBindings.length} 个绑定 (${varCount} 变量)`);

                // Step 1.5: 记录自定义域名
                let savedDomains = [];
                try {
                    const domainsRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/domains`, { headers });
                    if (domainsRes.ok) {
                        const allDomains = (await domainsRes.json()).result || [];
                        savedDomains = allDomains.filter(d => d.service === wName);
                    }
                } catch (e) { }
                if (savedDomains.length > 0) steps.push(`🔗 记录 ${savedDomains.length} 个自定义域名`);

                // Step 2: 删除 Worker（不删 KV）
                const delRes = await fetch(baseUrl, { method: "DELETE", headers });
                if (!delRes.ok) {
                    const err = await delRes.json();
                    throw new Error(`删除失败: ${err.errors?.[0]?.message || delRes.status}`);
                }
                steps.push("🗑️ 已删除");

                // Step 3: 随机修改子域名（容错，失败不阻断）
                try {
                    await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/subdomain`, { method: 'DELETE', headers });
                    const randomSub = 'w' + Math.random().toString(36).substring(2, 8) + Math.floor(Math.random() * 99);
                    const subRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/subdomain`, {
                        method: 'PUT', headers,
                        body: JSON.stringify({ subdomain: randomSub })
                    });
                    if (subRes.ok) steps.push(`🌐 子域名 → ${randomSub}`);
                    else steps.push("🌐 子域名: 跳过(API限制)");
                } catch (e) { steps.push("🌐 子域名: 跳过"); }

                // Step 4: 重建 Worker + 恢复变量
                let deployCode = freshCode;
                if (type === 'joey') deployCode = 'var window = globalThis;\n' + deployCode;

                // 从 KV 读取用户配置的变量值（VARS_cmliu / VARS_joey 等）
                const varsStr = await env.CONFIG_KV.get(`VARS_${type}`);
                const kvVars = varsStr ? JSON.parse(varsStr) : [];
                const kvVarMap = new Map(kvVars.map(v => [v.key, v.value]));

                // 恢复绑定：KV 变量值优先，其次 API 绑定值
                const restoredBindings = savedBindings.map(b => {
                    if (b.type === 'plain_text' || b.type === 'secret_text') {
                        // 优先用 VARS_type 中的值
                        const kvVal = kvVarMap.get(b.name);
                        const val = (kvVal !== undefined && kvVal !== '') ? kvVal : (b.text || '');
                        return { name: b.name, type: 'plain_text', text: val };
                    }
                    if (b.type === 'kv_namespace') return { name: b.name, type: 'kv_namespace', namespace_id: b.namespace_id };
                    return b; // 其他类型原样返回
                });
                // 补充 KV 中有但 Bindings 中没有的变量
                for (const [key, value] of kvVarMap) {
                    if (!restoredBindings.find(b => b.name === key)) {
                        restoredBindings.push({ name: key, type: 'plain_text', text: value || '' });
                    }
                }
                const restoredVarCount = restoredBindings.filter(b => b.type === 'plain_text').length;

                const metadata = {
                    main_module: "index.js",
                    bindings: restoredBindings,
                    compatibility_date: compatDate
                };
                const formData = new FormData();
                formData.append("metadata", JSON.stringify(metadata));
                formData.append("script", new Blob([deployCode], { type: "application/javascript+module" }), "index.js");

                const uploadHeaders = getUploadHeaders(acc);
                const uploadRes = await fetch(baseUrl, { method: "PUT", headers: uploadHeaders, body: formData });

                if (uploadRes.ok) {
                    logItem.success = true;
                    steps.push(`✅ 重建成功 (${restoredVarCount} 变量已恢复)`);

                    // Step 5: 恢复自定义域名
                    if (savedDomains.length > 0) {
                        let domainOk = 0;
                        for (const d of savedDomains) {
                            try {
                                const dRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/domains`, {
                                    method: 'PUT', headers,
                                    body: JSON.stringify({ hostname: d.hostname, service: wName, zone_id: d.zone_id, environment: d.environment || 'production' })
                                });
                                if (dRes.ok) domainOk++;
                            } catch (e) { }
                        }
                        steps.push(`🔗 域名恢复 ${domainOk}/${savedDomains.length}`);
                    }
                } else {
                    const err = await uploadRes.json();
                    steps.push(`❌ 重建失败: ${err.errors?.[0]?.message}`);
                }
            } catch (err) {
                steps.push(`❌ ${err.message}`);
            }
            logItem.msg = steps.join(' → ');
            logs.push(logItem);
        }
    }

    // 更新 DEPLOY_CONFIG
    const hasSuccess = logs.some(l => l.success);
    if (hasSuccess) {
        const DEPLOY_CONFIG_KEY = `DEPLOY_CONFIG_${type}`;
        await env.CONFIG_KV.put(DEPLOY_CONFIG_KEY, JSON.stringify({ mode: 'latest', currentSha: latestSha || 'unknown', deployTime: new Date().toISOString() }));
    }

    return new Response(JSON.stringify(logs), { headers: { "Content-Type": "application/json" } });
}

// 提取并返回全球区域节点的基础数据（替代前端调用外部txt）
async function handleGetRegionsData() {
    try {
        const response = await fetch("https://zip.cm.edu.kg/all.txt");
        let text = await response.text();
        text = text.replace(/^\uFEFF/, '');
        const lines = text.split('\n');

        const regionPools = {};
        for (const line of lines) {
            if (!line.includes('#')) continue;
            const parts = line.split('#');
            const code = parts[1] ? parts[1].trim().toUpperCase() : '';
            const ipPort = parts[0].trim();

            if (code) {
                if (!regionPools[code]) regionPools[code] = [];
                regionPools[code].push({ line, code, ipPort });
            }
        }
        return new Response(JSON.stringify({ success: true, data: regionPools }), {
            headers: { 'content-type': 'application/json; charset=UTF-8' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, msg: "Error fetching data: " + e.message }), { status: 500 });
    }
}

// 保存优选节点逻辑
async function handleSaveYxip(env, reqData, accountsKey) {
    const { type, accountId, email, globalKey, rawContent } = reqData;

    // 针对旧模式（无 KV）的 Joey：覆盖中控的 VARS_joey 全局变量 'yx' 
    if (type === 'joey_var') {
        const VARS_KEY = `VARS_joey`;
        try {
            const varsStr = await env.CONFIG_KV.get(VARS_KEY);
            let variables = varsStr ? JSON.parse(varsStr) : [];
            const idx = variables.findIndex(v => v.key === 'yx');
            if (idx !== -1) {
                variables[idx] = { key: 'yx', type: "plain_text", value: rawContent };
            } else {
                variables.push({ key: 'yx', type: "plain_text", value: rawContent });
            }
            await env.CONFIG_KV.put(VARS_KEY, JSON.stringify(variables));
            return new Response(JSON.stringify([{ name: "Joey 全局变量 (无 KV 模式)", success: true, msg: "✅ 变量 [yx] 已成功覆盖至全体记录供稍后部署使用", type: 'joey' }]), { headers: { "Content-Type": "application/json" } });
        } catch (e) {
            return new Response(JSON.stringify([{ name: "写入错误", success: false, msg: e.message }]), { status: 500 });
        }
    }

    // 不论是 cmliu 还是 joey，都需要写入对应 Worker 的目标绑定 KV 空间
    if (type === 'cmliu' || type === 'joey') {
        if (!accountId || !email || !globalKey) return new Response(JSON.stringify([{ name: "配置错误", success: false, msg: "未提供对应账户凭证" }]), { status: 400 });

        try {
            const accounts = JSON.parse(await env.CONFIG_KV.get(accountsKey) || "[]");
            const targetAccount = accounts.find(a => a.accountId === accountId);
            if (!targetAccount) return new Response(JSON.stringify([{ name: "查找错误", success: false, msg: "系统记录中找不到该账户" }]), { status: 404 });

            const targetWorkers = type === 'cmliu' ? targetAccount.workers_cmliu : targetAccount.workers_joey;
            const workerTypeName = type === 'cmliu' ? 'CMLiu' : 'Joey';
            if (!targetWorkers || targetWorkers.length === 0) return new Response(JSON.stringify([{ name: "查找错误", success: false, msg: `该账号下未发现已部署的 ${workerTypeName} 项目` }]), { status: 200 });

            const logs = [];
            const jsonHeaders = getAuthHeaders(email, globalKey);

            for (const wName of targetWorkers) {
                const logItem = { name: `[${workerTypeName}] ${wName}`, success: false, msg: "" };
                try {
                    // 1. 获取该 Worker 的绑定的 KV ID
                    const bindRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${wName}/bindings`, { headers: jsonHeaders });
                    if (!bindRes.ok) throw new Error("无法读取绑定的变量");

                    const binds = (await bindRes.json()).result;
                    const kvBind = binds.find(b => b.type === 'kv_namespace' && (b.name === 'KV' || b.name === 'CONFIG' || b.name === 'C'));
                    if (!kvBind) {
                        logItem.msg = "❌ 该项目未绑定名为 KV/CONFIG/C 的核心配置空间";
                    } else {
                        const nsId = kvBind.namespace_id;
                        // 2. 将内容写入到空间的指定键
                        let targetKey = "ADD.txt";
                        let finalContent = rawContent;
                        let contentType = "text/plain";

                        if (type === 'joey') {
                            targetKey = "c";
                            // 构造最终的 JSON 内容
                            const configObj = { "ev": "yes", "et": "no", "ex": "no", "epd": "no", "epi": "yes", "egi": "no", "d": "990200", "ipv4": "yes", "ipv6": "no", "ispMobile": "yes", "ispUnicom": "no", "ispTelecom": "no", "yx": rawContent, "dkby": "yes", "ech": "yes", "scu": "https://SUBAPI.cmliussss.net" };
                            finalContent = JSON.stringify(configObj);
                            contentType = "application/json";
                        }

                        const putRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${nsId}/values/${targetKey}`, {
                            method: "PUT",
                            headers: {
                                ...jsonHeaders,
                                "Content-Type": contentType
                            },
                            body: finalContent
                        });

                        if (putRes.ok) {
                            logItem.success = true;
                            logItem.msg = `✅ 已更新对应命名空间的 ${targetKey}`;
                        } else {
                            logItem.msg = `❌ 写入失败: ${(await putRes.json()).errors?.[0]?.message}`;
                        }
                    }
                } catch (e) { logItem.msg = `❌ ${e.message}`; } // loop block catch
                logs.push(logItem);
            }
            return new Response(JSON.stringify(logs), { headers: { "Content-Type": "application/json" } });

        } catch (e) {
            return new Response(JSON.stringify([{ name: "执行异常", success: false, msg: e.message }]), { status: 500 });
        }
    }

    return new Response(JSON.stringify([{ name: "参数错误", success: false, msg: "未知的请求类型: " + type }]), { status: 400 });
}

function loginHtml() {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Login</title></head>
<body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f3f4f6;font-family:sans-serif">
<div style="background:white;padding:2rem;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center">
<h2 style="margin:0 0 1rem;color:#1e293b">🔒 Worker 中控</h2>
<input type="password" id="login_code" placeholder="请输入密码" style="padding:10px;border:1px solid #cbd5e1;border-radius:4px;width:200px;margin-bottom:10px;display:block">
<button onclick="doLogin()" style="padding:10px 24px;background:#1e293b;color:white;border:none;border-radius:4px;cursor:pointer;width:100%">登录</button>
<div id="login_msg" style="color:red;font-size:12px;margin-top:8px"></div>
</div>
<script>
async function doLogin(){
    const code=document.getElementById('login_code').value;
    const msg=document.getElementById('login_msg');
    if(!code){msg.innerText='请输入密码';return;}
    try{
        const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});
        const d=await r.json();
        if(d.success){location.reload();}else{msg.innerText=d.msg||'密码错误';}
    }catch(e){msg.innerText='网络错误';}
}
document.getElementById('login_code').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
</script>
</body></html>`;
}

// ==========================================
// 2. 前端页面 (完整 HTML)
// ==========================================
function mainHtml() {
    return `
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cloudflare Worker 多账号中控管理系统</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
    <style>
      :root {
        --el-font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        --el-mono-family: 'JetBrains Mono', Consolas, Monaco, monospace;
        --el-color-primary: #409eff;
        --el-color-primary-light: #ecf5ff;
        --el-color-primary-hover: #66b1ff;
        --el-color-success: #67c23a;
        --el-color-success-light: #f0f9eb;
        --el-color-warning: #e6a23c;
        --el-color-warning-light: #fdf6ec;
        --el-color-danger: #f56c6c;
        --el-color-danger-light: #fef0f0;
        --el-color-info: #909399;
        
        --bg-page: #f0f2f5;
        --bg-card: #ffffff;
        --bg-subtle: #f8fafc;
        --bg-input: #ffffff;
        --border-color: #dcdfe6;
        --border-light: #ebeef5;
        --text-primary: #303133;
        --text-regular: #606266;
        --text-secondary: #909399;
        --text-placeholder: #c0c4cc;
        --shadow-base: 0 2px 12px 0 rgba(0, 0, 0, 0.06);
        --shadow-card: 0 1px 4px 0 rgba(0, 0, 0, 0.05);
      }

      [data-theme="dark"] {
        --bg-page: #0f172a;
        --bg-card: #1e293b;
        --bg-subtle: #141e33;
        --bg-input: #0f172a;
        --border-color: #334155;
        --border-light: #1e293b;
        --text-primary: #f8fafc;
        --text-regular: #cbd5e1;
        --text-secondary: #94a3b8;
        --text-placeholder: #64748b;
        --shadow-base: 0 4px 20px 0 rgba(0, 0, 0, 0.4);
        --shadow-card: 0 2px 8px 0 rgba(0, 0, 0, 0.3);
      }

      body {
        font-family: var(--el-font-family);
        background-color: var(--bg-page);
        color: var(--text-primary);
        transition: background-color 0.3s, color 0.3s;
      }

      code, pre, .font-mono {
        font-family: var(--el-mono-family);
      }

      /* Element UI 标准卡片 */
      .el-card {
        background-color: var(--bg-card);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        box-shadow: var(--shadow-card);
        transition: all 0.25s ease;
      }
      .el-card:hover {
        box-shadow: var(--shadow-base);
      }

      /* 标准按钮体系 */
      .el-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 500;
        font-size: 13px;
        border-radius: 6px;
        padding: 6px 14px;
        transition: all 0.2s;
        cursor: pointer;
        user-select: none;
        border: 1px solid transparent;
      }
      .el-btn-primary { background: #409eff; color: #fff; }
      .el-btn-primary:hover { background: #66b1ff; }
      .el-btn-success { background: #67c23a; color: #fff; }
      .el-btn-success:hover { background: #85ce61; }
      .el-btn-warning { background: #e6a23c; color: #fff; }
      .el-btn-warning:hover { background: #ebb563; }
      .el-btn-danger { background: #f56c6c; color: #fff; }
      .el-btn-danger:hover { background: #f78989; }
      .el-btn-default { background: var(--bg-card); color: var(--text-regular); border-color: var(--border-color); }
      .el-btn-default:hover { color: #409eff; border-color: #c6e2ff; background: var(--el-color-primary-light); }
      
      .el-btn-sm { padding: 4px 10px; font-size: 12px; border-radius: 4px; }
      .el-btn-xs { padding: 2px 6px; font-size: 11px; border-radius: 4px; }

      /* 表单输入控件 */
      .el-input {
        background-color: var(--bg-input);
        border: 1px solid var(--border-color);
        color: var(--text-primary);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
        transition: border-color 0.2s, box-shadow 0.2s;
        width: 100%;
        outline: none;
      }
      .el-input:focus {
        border-color: var(--el-color-primary);
        box-shadow: 0 0 0 2px rgba(64, 158, 255, 0.15);
      }
      .el-input::placeholder { color: var(--text-placeholder); }

      /* 标签页 Tabs */
      .el-tab-nav {
        display: flex;
        border-bottom: 2px solid var(--border-light);
        gap: 8px;
      }
      .el-tab-item {
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary);
        cursor: pointer;
        position: relative;
        transition: all 0.2s;
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
      }
      .el-tab-item:hover { color: var(--el-color-primary); }
      .el-tab-item.active {
        color: var(--el-color-primary);
        border-bottom-color: var(--el-color-primary);
      }

      /* 表格样式 */
      .el-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 13px;
      }
      .el-table th {
        background-color: var(--bg-subtle);
        color: var(--text-regular);
        font-weight: 600;
        padding: 10px 14px;
        text-align: left;
        border-bottom: 1px solid var(--border-color);
        white-space: nowrap;
      }
      .el-table td {
        padding: 10px 14px;
        border-bottom: 1px solid var(--border-light);
        color: var(--text-regular);
        transition: background-color 0.15s;
        white-space: nowrap;
      }
      .el-table tr:hover td {
        background-color: var(--bg-subtle);
      }

      /* 徽标 Tag */
      .el-tag {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        border: 1px solid transparent;
      }
      .el-tag-blue { background: #ecf5ff; color: #409eff; border-color: #d9ecff; }
      .el-tag-green { background: #f0f9eb; color: #67c23a; border-color: #e1f3d8; }
      .el-tag-orange { background: #fdf6ec; color: #e6a23c; border-color: #faecd8; }
      .el-tag-red { background: #fef0f0; color: #f56c6c; border-color: #fde2e2; }
      .el-tag-purple { background: #f4f0ff; color: #722ed1; border-color: #d3adf7; }
      .el-tag-gray { background: #f4f4f5; color: #909399; border-color: #e9e9eb; }

      [data-theme="dark"] .el-tag-blue { background: rgba(64,158,255,0.15); border-color: rgba(64,158,255,0.3); }
      [data-theme="dark"] .el-tag-green { background: rgba(103,194,58,0.15); border-color: rgba(103,194,58,0.3); }
      [data-theme="dark"] .el-tag-orange { background: rgba(230,162,60,0.15); border-color: rgba(230,162,60,0.3); }
      [data-theme="dark"] .el-tag-red { background: rgba(245,108,108,0.15); border-color: rgba(245,108,108,0.3); }
      [data-theme="dark"] .el-tag-purple { background: rgba(114,46,209,0.15); border-color: rgba(114,46,209,0.3); }
      [data-theme="dark"] .el-tag-gray { background: rgba(144,147,153,0.15); border-color: rgba(144,147,153,0.3); }

      /* 背景画布 */
      #starfield {
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        pointer-events: none; z-index: -1; opacity: 0; transition: opacity 0.5s;
      }
      [data-theme="dark"] #starfield { opacity: 1; }

      /* 自定义滚动条 */
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: #c0c4cc; border-radius: 3px; }
      [data-theme="dark"] ::-webkit-scrollbar-thumb { background: #475569; }
      ::-webkit-scrollbar-track { background: transparent; }

      /* 动画 */
      .animate-fade-in { animation: fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1); }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }
    </style>
  </head>
  <body class="p-3 md:p-6 min-h-screen">
    <canvas id="starfield"></canvas>
    
    <div class="max-w-[1550px] mx-auto space-y-4">
      
      <!-- 顶部 Header 导航条 -->
      <header class="el-card p-4 md:px-6 md:py-4 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
          <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white text-xl shadow-md font-bold">
                ⚡
              </div>
              <div>
                  <div class="flex items-center gap-2">
                      <h1 class="text-base md:text-lg font-bold text-slate-800 tracking-tight" style="color:var(--text-primary)">
                        Cloudflare Worker 多账号中控管理系统
                      </h1>
                      <span class="el-tag el-tag-blue font-mono">V10.11.0</span>
                      <span class="el-tag el-tag-green flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> 运行正常</span>
                  </div>
                  <div class="text-xs text-slate-400 mt-0.5" style="color:var(--text-secondary)">
                    动态分支感知 · 双轨鉴权(Token/Key) · 兼容锁定 · 自动熔断防护 · 全球 YXIP 调度
                  </div>
              </div>
          </div>
          
          <!-- 工具栏操作按钮组 -->
          <div class="flex flex-wrap items-center gap-2.5 w-full xl:w-auto">
               <button onclick="openBatchDeployModal()" class="el-btn el-btn-primary shadow-sm flex items-center gap-1.5">
                  <span>✨</span> 批量部署
               </button>
               
               <button onclick="accounts.some(a => (a.workers_cmliu && a.workers_cmliu.length > 0) || (a.workers_joey && a.workers_joey.length > 0)) ? showYxipModal() : alert('必须先部署至少一个支持的代理项目 (CMLiu 或 Joey) 才能使用反代落地部署功能！')" class="el-btn el-btn-warning shadow-sm flex items-center gap-1.5">
                  <span>⚡</span> 反代落地部署
               </button>

               <button onclick="openWorkbench()" id="btn_workbench" class="el-btn el-btn-default flex items-center gap-1.5 font-bold">
                  <span>📋</span> 工作台
               </button>

               <button onclick="manualReportIssue()" class="el-btn el-btn-default text-red-500 hover:text-red-600 flex items-center gap-1.5" title="一键复制诊断日志并直达 GitHub Issues 提交问题">
                  <span>🐛</span> 故障诊断
               </button>

               <div class="h-6 w-px bg-slate-200 mx-1" style="background-color:var(--border-color)"></div>

               <!-- 自动巡检设置区 -->
               <div class="flex items-center gap-2 px-3 py-1.5 rounded-md border" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                   <div class="flex items-center gap-1.5 text-xs font-semibold" style="color:var(--text-regular)">
                       <span>自动巡检:</span>
                       <input type="checkbox" id="auto_update_toggle" class="w-4 h-4 text-blue-600 rounded cursor-pointer accent-blue-600">
                   </div>
                   <div class="flex items-center gap-1 text-xs" style="color:var(--text-secondary)">
                       <input type="number" id="auto_update_interval" value="30" class="el-input py-0.5 px-1.5 w-12 text-center text-xs">
                       <span>分</span>
                   </div>
                   <div class="flex items-center gap-1 text-xs font-semibold text-rose-600">
                       <span>熔断:</span>
                       <input type="number" id="fuse_threshold" value="0" placeholder="0" class="el-input py-0.5 px-1.5 w-12 text-center text-xs font-bold text-rose-600 border-rose-200">
                   </div>
                   <button onclick="saveAutoConfig()" class="el-btn el-btn-default el-btn-xs">保存</button>
               </div>

               <!-- 主题切换 -->
               <button onclick="toggleTheme()" class="el-btn el-btn-default p-2 text-base rounded-full" id="theme_btn" title="切换深浅主题">🌙</button>
          </div>
      </header>

      <!-- 核心工作区：左右双分栏 -->
      <div id="layout_container" class="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        
        <!-- 左栏：账号矩阵管理 (占 7 份) -->
        <div id="section_accounts" class="lg:col-span-7 space-y-4">
            <div class="el-card p-5">
               <!-- 账号表头 -->
               <div class="flex justify-between items-center mb-4 pb-3 border-b" style="border-color:var(--border-light)">
                    <div class="flex items-center gap-2">
                        <span class="text-base font-bold flex items-center gap-2" style="color:var(--text-primary)">
                          <span>📡</span> Cloudflare 账号矩阵
                        </span>
                        <span id="account_count_badge" class="el-tag el-tag-gray text-xs">0 个账号</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button onclick="loadStats()" id="btn_stats" class="el-btn el-btn-default el-btn-sm flex items-center gap-1">
                           <span>🔄</span> 刷新用量
                        </button>
                        <button onclick="resetFormForAdd()" class="el-btn el-btn-primary el-btn-sm flex items-center gap-1">
                           <span>➕</span> 添加账号
                        </button>
                    </div>
               </div>
               
               <!-- 添加 / 编辑账号卡片 (Drawer 展开模式) -->
               <div id="account_form" class="hidden p-4 mb-4 rounded-lg border text-xs space-y-3.5 animate-fade-in" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                  <div class="font-bold text-sm flex items-center justify-between pb-2 border-b" style="color:var(--text-primary); border-color:var(--border-light)">
                      <span>⚙️ 编辑 / 新增 Cloudflare 账号</span>
                      <button onclick="cancelEdit()" class="text-slate-400 hover:text-slate-600 text-base font-bold">×</button>
                  </div>
                  
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                     <div>
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">账号别名 (Alias)</label>
                        <input id="in_alias" placeholder="例如: Account-01" class="el-input font-bold">
                     </div>
                     <div class="md:col-span-2">
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">Account ID (CF 账户 ID)</label>
                        <input id="in_id" placeholder="可在 Cloudflare 仪表盘右下角查看" class="el-input font-mono">
                     </div>
                  </div>
                  
                  <!-- 认证模式选项 -->
                  <div class="p-3 bg-white dark:bg-slate-900 rounded-md border space-y-2" style="border-color:var(--border-color)">
                     <div class="flex justify-between items-center">
                         <span class="font-bold text-xs" style="color:var(--text-primary)">🔐 鉴权凭据类型:</span>
                         <div class="flex items-center gap-4 text-xs">
                             <label class="flex items-center gap-1.5 cursor-pointer font-semibold text-blue-600">
                                <input type="radio" name="auth_mode" value="token" checked onchange="toggleAuthFields()" class="accent-blue-600"> 
                                API Token (推荐)
                             </label>
                             <label class="flex items-center gap-1.5 cursor-pointer font-semibold" style="color:var(--text-regular)">
                                <input type="radio" name="auth_mode" value="key" onchange="toggleAuthFields()" class="accent-blue-600"> 
                                Global API Key
                             </label>
                         </div>
                     </div>
                     <div id="field_auth_token" class="space-y-1 pt-1">
                         <input id="in_api_token" type="password" placeholder="请输入 Cloudflare API Token (需具备 Workers & KV 读写权限)" class="el-input font-mono">
                         <div class="text-[11px] text-slate-400">💡 推荐使用 API Token，细粒度权限控制且无需暴露登录邮箱。</div>
                     </div>
                     <div id="field_auth_key" class="hidden grid grid-cols-2 gap-2 pt-1">
                         <input id="in_email" placeholder="Cloudflare 登录邮箱" class="el-input">
                         <input id="in_gkey" type="password" placeholder="Global API Key" class="el-input font-mono">
                     </div>
                  </div>

                  <!-- 预设域名 -->
                  <div class="p-3 rounded-md border flex flex-col md:flex-row gap-2 items-start md:items-center" style="background-color:var(--bg-card); border-color:var(--border-color)">
                     <span class="font-bold text-xs flex-none" style="color:var(--text-primary)">🌐 预设托管域名:</span>
                     <select id="in_zone_select" class="el-input flex-1" onchange="updateZoneInfo()">
                         <option value="">(请先填写认证信息后点击读取)</option>
                     </select>
                     <input type="hidden" id="in_zone_name">
                     <input type="hidden" id="in_zone_id">
                     <button onclick="fetchZonesForAccount()" class="el-btn el-btn-default el-btn-sm flex-none">
                        <span>☁️</span> 自动读取域名
                     </button>
                  </div>

                  <!-- 绑定 Worker 实例名称 -->
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                     <div>
                        <label class="block text-[11px] font-semibold text-rose-600 mb-1">🔴 CMLiu Worker 名称</label>
                        <input id="in_workers_cmliu" placeholder="多个用英文逗号分隔" class="el-input font-mono text-xs">
                     </div>
                     <div>
                        <label class="block text-[11px] font-semibold text-blue-600 mb-1">🔵 Joey Worker 名称</label>
                        <input id="in_workers_joey" placeholder="多个用英文逗号分隔" class="el-input font-mono text-xs">
                     </div>
                     <div>
                        <label class="block text-[11px] font-semibold text-emerald-600 mb-1">🟢 ECH Worker 名称</label>
                        <input id="in_workers_ech" placeholder="多个用英文逗号分隔" class="el-input font-mono text-xs">
                     </div>
                  </div>

                  <!-- 保存与取消 -->
                  <div class="flex gap-2 pt-2 border-t" style="border-color:var(--border-light)">
                     <button onclick="saveAccount()" id="btn_save_acc" class="flex-1 el-btn el-btn-primary">💾 保存账号配置</button>
                     <button onclick="deleteFromEdit()" id="btn_del_edit" class="hidden el-btn el-btn-danger">🗑️ 删除</button>
                     <button onclick="cancelEdit()" class="el-btn el-btn-default">取消</button>
                  </div>
               </div>
               
               <!-- 账号列表数据表格 -->
               <div id="account_list_container" class="overflow-x-auto rounded-lg border min-h-[360px]" style="border-color:var(--border-color)">
                   <table class="el-table">
                       <thead>
                           <tr>
                              <th>备注 (别名)</th>
                              <th>预设域名</th>
                              <th>已部署 Worker</th>
                              <th>今日请求量</th>
                              <th>限额占比</th>
                              <th class="text-right">操作</th>
                           </tr>
                       </thead>
                       <tbody id="account_body"></tbody>
                   </table>
               </div>
            </div>
        </div>
   
        <!-- 右栏：项目配置与下发中心 (占 5 份，采用 Tab 切换极简舒展架构) -->
        <div id="section_projects" class="lg:col-span-5 space-y-4">
            <div class="el-card p-5">
                
                <!-- Tab 标签页切换栏 -->
                <div class="el-tab-nav mb-4">
                    <div class="el-tab-item active flex items-center gap-1.5" id="tab_btn_cmliu" onclick="switchProjectTab('cmliu')">
                        <span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> CMLiu (EdgeTunnel)
                    </div>
                    <div class="el-tab-item flex items-center gap-1.5" id="tab_btn_joey" onclick="switchProjectTab('joey')">
                        <span class="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Joey (CFnew)
                    </div>
                    <div class="el-tab-item flex items-center gap-1.5" id="tab_btn_ech" onclick="switchProjectTab('ech')">
                        <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> ECH-WK
                    </div>
                </div>

                <!-- Tab 1: CMLiu 项目配置面板 -->
                <div id="tab_panel_cmliu" class="space-y-4 animate-fade-in">
                    <div class="p-3 rounded-lg border space-y-2.5" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-sm text-rose-600">🔴 CMLiu 架构配置</span>
                                <a href="https://github.com/cmliu/edgetunnel" target="_blank" class="el-tag el-tag-blue">🔗 开源仓库</a>
                                <span id="badge_cmliu" class="el-tag el-tag-gray">Loading</span>
                            </div>
                            <button onclick="openVersionHistory('cmliu')" class="el-btn el-btn-default el-btn-xs">📜 历史版本/锁定</button>
                        </div>
                        <div id="ver_cmliu" class="text-xs font-mono p-2 rounded bg-white dark:bg-slate-900 border border-dashed" style="border-color:var(--border-color)">Checking...</div>
                        <div class="text-xs p-2 rounded flex items-center justify-between" style="background-color:var(--el-color-primary-light); color:var(--el-color-primary)">
                            <span>💡 管理后台访问路径: <b class="font-mono">/admin</b></span>
                            <span class="text-[11px] opacity-75">核心兼容日期: 2024-04-05</span>
                        </div>
                    </div>

                    <!-- 变量列表 -->
                    <div class="space-y-2">
                        <div class="flex justify-between items-center">
                            <label class="text-xs font-bold" style="color:var(--text-primary)">📝 环境变量配置 (VARS_cmliu):</label>
                            <div class="flex gap-1.5">
                                <button onclick="addVarRow('cmliu')" class="el-btn el-btn-default el-btn-xs">➕ 添加变量</button>
                                <button onclick="selectSyncAccount('cmliu')" class="el-btn el-btn-warning el-btn-xs">🔄 同步线上变量</button>
                            </div>
                        </div>
                        <div id="vars_cmliu" class="space-y-1.5 p-3 rounded-lg border max-h-[260px] overflow-y-auto" style="background-color:var(--bg-subtle); border-color:var(--border-color)"></div>
                    </div>

                    <!-- 操作按钮组 -->
                    <div class="grid grid-cols-3 gap-2 pt-2 border-t" style="border-color:var(--border-light)">
                        <button onclick="refreshUUID('cmliu')" class="el-btn el-btn-default">🎲 随机 UUID</button>
                        <button onclick="deploy('cmliu')" id="btn_deploy_cmliu" class="el-btn el-btn-danger font-bold col-span-2">🚀 部署全账号 CMLiu</button>
                    </div>
                    <button onclick="fix1101('cmliu')" id="btn_fix1101_cmliu" class="w-full el-btn el-btn-warning font-bold">🔧 一键智能修复 1101 错误</button>
                </div>

                <!-- Tab 2: Joey 项目配置面板 -->
                <div id="tab_panel_joey" class="hidden space-y-4 animate-fade-in">
                    <div class="p-3 rounded-lg border space-y-2.5" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-sm text-blue-600">🔵 Joey (CFnew) 架构配置</span>
                                <a href="https://github.com/byJoey/cfnew" target="_blank" class="el-tag el-tag-blue">🔗 开源仓库</a>
                                <span id="badge_joey" class="el-tag el-tag-gray">Loading</span>
                            </div>
                            <button onclick="openVersionHistory('joey')" class="el-btn el-btn-default el-btn-xs">📜 历史版本/锁定</button>
                        </div>
                        <div id="ver_joey" class="text-xs font-mono p-2 rounded bg-white dark:bg-slate-900 border border-dashed" style="border-color:var(--border-color)">Checking...</div>
                        <div class="text-xs p-2 rounded flex items-center justify-between" style="background-color:var(--el-color-primary-light); color:var(--el-color-primary)">
                            <span>💡 订阅获取路径: <b class="font-mono">/{UUID}</b></span>
                            <span class="text-[11px] opacity-75">核心兼容日期: 2024-02-20</span>
                        </div>
                    </div>

                    <!-- 变量列表 -->
                    <div class="space-y-2">
                        <div class="flex justify-between items-center">
                            <label class="text-xs font-bold" style="color:var(--text-primary)">📝 环境变量配置 (VARS_joey):</label>
                            <div class="flex gap-1.5">
                                <button onclick="addVarRow('joey')" class="el-btn el-btn-default el-btn-xs">➕ 添加变量</button>
                                <button onclick="selectSyncAccount('joey')" class="el-btn el-btn-warning el-btn-xs">🔄 同步线上变量</button>
                            </div>
                        </div>
                        <div id="vars_joey" class="space-y-1.5 p-3 rounded-lg border max-h-[260px] overflow-y-auto" style="background-color:var(--bg-subtle); border-color:var(--border-color)"></div>
                    </div>

                    <!-- 操作按钮组 -->
                    <div class="grid grid-cols-3 gap-2 pt-2 border-t" style="border-color:var(--border-light)">
                        <button onclick="refreshUUID('joey')" class="el-btn el-btn-default">🎲 随机 UUID</button>
                        <button onclick="deploy('joey')" id="btn_deploy_joey" class="el-btn el-btn-primary font-bold col-span-2">🚀 部署全账号 Joey</button>
                    </div>
                </div>

                <!-- Tab 3: ECH 项目配置面板 -->
                <div id="tab_panel_ech" class="hidden space-y-4 animate-fade-in">
                    <div class="p-3 rounded-lg border space-y-2.5" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <div class="flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-sm text-emerald-600">🟢 ECH 专属配置</span>
                                <a href="https://github.com/hc990275/ech-wk" target="_blank" class="el-tag el-tag-blue">🔗 开源仓库</a>
                                <span class="el-tag el-tag-green">Stable</span>
                            </div>
                        </div>
                    </div>

                    <!-- ProxyIP 选择与变量列表 -->
                    <div class="space-y-2">
                        <label class="text-xs font-bold" style="color:var(--text-primary)">🌐 预设 ProxyIP 节点池快捷注入:</label>
                        <div id="ech_proxy_selector_container"></div>
                        <div id="vars_ech" class="space-y-1.5 p-3 rounded-lg border max-h-[200px] overflow-y-auto" style="background-color:var(--bg-subtle); border-color:var(--border-color)"></div>
                    </div>

                    <!-- Token 鉴权开关 -->
                    <div class="p-3 rounded-lg border space-y-2" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <input type="checkbox" id="ech_token_enabled" class="w-4 h-4 text-emerald-600 rounded cursor-pointer accent-emerald-600" onchange="toggleEchToken()"/>
                                <label for="ech_token_enabled" class="font-bold text-xs" style="color:var(--text-primary)">🔑 开启 Token 访问鉴权</label>
                            </div>
                            <span id="ech_token_status" class="text-xs text-slate-400">(关闭 - 不填入)</span>
                        </div>
                        <input id="ech_token_input" type="text" placeholder="请填写 Token 凭据（开启后生效）" class="el-input opacity-50 cursor-not-allowed" disabled/>
                        
                        <div class="flex items-center gap-2 pt-2 border-t" style="border-color:var(--border-light)">
                            <input type="checkbox" id="ech_disable_workers_dev" class="w-4 h-4 text-rose-600 rounded cursor-pointer accent-rose-600">
                            <label for="ech_disable_workers_dev" class="font-semibold text-xs text-rose-600 cursor-pointer">🚫 部署后自动禁用默认 *.workers.dev 域名</label>
                        </div>
                    </div>

                    <button onclick="deploy('ech')" id="btn_deploy_ech" class="w-full el-btn el-btn-success font-bold">🚀 部署全账号 ECH Worker</button>
                </div>

            </div>
        </div>
      </div>
    </div>

    <!-- 弹窗部分：批量部署 Modal -->
    <div id="batch_deploy_modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
        <div class="el-card w-full max-w-[620px] overflow-hidden animate-fade-in shadow-2xl">
            <div class="p-4 flex justify-between items-center text-white bg-blue-600">
                <h3 class="font-bold text-sm flex items-center gap-2"><span>✨</span> 批量部署 Worker 实例</h3>
                <button onclick="document.getElementById('batch_deploy_modal').classList.add('hidden')" class="text-white/80 hover:text-white text-xl font-bold">×</button>
            </div>
            <div class="p-5 text-xs space-y-4">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">Worker 实例名称</label>
                        <input id="bd_name" class="el-input font-bold text-blue-600" placeholder="例如: cf-proxy-01">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">选择预设框架模板</label>
                        <select id="bd_template" onchange="toggleBatchInputs()" class="el-input">
                            <option value="cmliu">🔴 CMLiu (EdgeTunnel)</option>
                            <option value="joey">🔵 Joey (CFnew 相信光)</option>
                        </select>
                    </div>
                </div>
                
                <div class="grid grid-cols-2 gap-3 items-end">
                    <div>
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">KV 命名空间名称</label>
                        <input id="bd_kv_name" class="el-input" placeholder="默认与 Worker 同名">
                    </div>
                    <div class="flex flex-col gap-2 pb-1">
                         <label class="flex items-center gap-2 cursor-pointer font-semibold" style="color:var(--text-primary)">
                            <input type="checkbox" id="bd_enable_kv" class="w-4 h-4 text-blue-600 rounded accent-blue-600" checked>
                            绑定独立 KV 存储空间
                         </label>
                         <label class="flex items-center gap-2 cursor-pointer font-semibold text-emerald-600">
                            <input type="checkbox" id="bd_use_saved_vars" class="w-4 h-4 text-emerald-600 rounded accent-emerald-600" checked>
                            📦 注入已保存变量 (VARS)
                         </label>
                    </div>
                </div>

                <div class="p-3 rounded-lg border space-y-2" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                    <div class="flex items-center gap-2">
                         <input type="checkbox" id="bd_disable_workers_dev" class="w-4 h-4 text-rose-600 rounded accent-rose-600">
                         <label for="bd_disable_workers_dev" class="font-semibold text-rose-600 cursor-pointer">🚫 禁用默认 *.workers.dev 域名</label>
                    </div>
                    <div class="border-t pt-2" style="border-color:var(--border-light)">
                        <label class="block text-xs font-semibold mb-1" style="color:var(--text-primary)">🌐 自动绑定自定义二级域名 (仅输入前缀):</label>
                        <div class="flex gap-1 items-center">
                            <input id="bd_domain_prefix" class="el-input w-1/2 font-mono" placeholder="如 proxy-01">
                            <span class="text-slate-400 font-bold">.</span>
                            <span class="text-xs text-slate-500 italic">[自动拼接账号预设域名]</span>
                        </div>
                    </div>
                </div>

                <div id="bd_config_cmliu" class="p-3 rounded-lg border space-y-1.5" style="background-color:var(--el-color-danger-light); border-color:#fde2e2">
                    <div class="flex justify-between items-center">
                        <label class="font-bold text-xs text-rose-700">设置 ADMIN 后台登录密码</label>
                        <span class="text-[11px] text-rose-500">访问路径: <b>/admin</b></span>
                    </div>
                    <input id="bd_admin_pass" class="el-input bg-white" placeholder="请输入后台管理密码">
                </div>

                <div id="bd_config_joey" class="hidden p-3 rounded-lg border space-y-1.5" style="background-color:var(--el-color-primary-light); border-color:#d9ecff">
                    <div class="flex justify-between items-center">
                        <label class="font-bold text-xs text-blue-700">设置用户 UUID (u)</label>
                        <span class="text-[11px] text-blue-500">订阅路径: <b>/{UUID}</b></span>
                    </div>
                    <div class="flex gap-2">
                        <input id="bd_uuid" class="el-input bg-white font-mono" placeholder="UUID">
                        <button onclick="document.getElementById('bd_uuid').value = crypto.randomUUID()" class="el-btn el-btn-primary el-btn-sm">🎲</button>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold mb-1" style="color:var(--text-regular)">选择目标下发账号:</label>
                    <div id="bd_account_list" class="max-h-[120px] overflow-y-auto border rounded p-2.5 grid grid-cols-2 gap-2" style="background-color:var(--bg-subtle); border-color:var(--border-color)"></div>
                </div>

                <div class="pt-3 border-t flex justify-end gap-2" style="border-color:var(--border-light)">
                    <button onclick="document.getElementById('batch_deploy_modal').classList.add('hidden')" class="el-btn el-btn-default">取消</button>
                    <button onclick="doBatchDeploy()" id="btn_do_batch" class="el-btn el-btn-primary font-bold">🚀 开始下发部署</button>
                </div>
            </div>
        </div>
    </div>

    <!-- 弹窗部分：反代落地部署 (YXIP) Modal -->
    <div id="yxip_modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-start pt-[5vh] z-[60] overflow-y-auto p-4">
        <div class="el-card w-full max-w-[800px] my-[3vh] overflow-hidden animate-fade-in shadow-2xl">
            <div class="p-4 flex justify-between items-center text-white bg-amber-500">
                <h3 class="font-bold text-sm flex items-center gap-2"><span>⚡</span> 全球反代落地节点优选调度 (YXIP)</h3>
                <button onclick="document.getElementById('yxip_modal').classList.add('hidden')" class="text-white/80 hover:text-white text-xl font-bold">×</button>
            </div>
            
            <div class="p-5 text-xs space-y-4">
                <div class="space-y-2">
                    <label class="font-bold text-xs" style="color:var(--text-primary)">1. 操作目标配置与下发策略：</label>
                    <div class="p-3.5 border rounded-lg space-y-3" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <select id="yxip_type" class="el-input bg-white dark:bg-slate-900" onchange="toggleYxipAccountSelect()">
                            <option value="joey">🚀 Joey 专属 (KV 模式): 直写项目绑定的核心配置库 (键 c)</option>
                            <option value="joey_var">🪐 Joey 兼容 (变量模式): 写入中控面板全局统一变量组 [yx]</option>
                            <option value="cmliu">🌐 CMLiu 专属 (KV 模式): 直写项目绑定的自带节点库 (ADD.txt)</option>
                        </select>

                        <div id="yxip_cmliu_account_area">
                            <label class="block text-[11px] font-semibold mb-1.5" style="color:var(--text-regular)">选择目标 Cloudflare 账号:</label>
                            <div id="yxip_account_list" class="max-h-[140px] overflow-y-auto border rounded p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2" style="background-color:var(--bg-card); border-color:var(--border-color)"></div>
                        </div>
                    </div>
                </div>

                <div class="space-y-2">
                    <div class="flex justify-between items-center">
                        <label class="font-bold text-xs" style="color:var(--text-primary)">2. 全球区域节点筛选池：</label>
                        <div class="flex items-center gap-2">
                            <span class="text-slate-400">单地区上限:</span>
                            <input type="number" id="yxip_limit" value="10" min="1" max="100" class="el-input py-0.5 px-2 w-16 text-center text-xs">
                            <span class="text-slate-400">个</span>
                        </div>
                    </div>
                    
                    <div class="flex gap-2">
                        <button onclick="yxipSelectAll()" class="el-btn el-btn-default el-btn-xs">全选区域</button>
                        <button onclick="yxipSelectNone()" class="el-btn el-btn-default el-btn-xs">清除选择</button>
                    </div>
                    
                    <div id="yxip_regions" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-[220px] overflow-y-auto p-2.5 border rounded-lg" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                        <div class="col-span-full text-center py-4 text-slate-400">正在拉取全球节点池...</div>
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-3 border-t" style="border-color:var(--border-light)">
                    <button onclick="document.getElementById('yxip_modal').classList.add('hidden')" class="el-btn el-btn-default">取消</button>
                    <button onclick="doYxipDeploy()" class="el-btn el-btn-warning font-bold flex items-center gap-1">
                        <span id="yxip_btn_icon">⚡</span> 开始提取并全量下发
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- 弹窗部分：账号 Worker 资源管理 Modal -->
    <div id="account_manage_modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
        <div class="el-card w-full max-w-[680px] max-h-[85vh] flex flex-col overflow-hidden animate-fade-in shadow-2xl">
            <div class="p-4 flex justify-between items-center text-white bg-slate-800">
                <h3 class="font-bold text-sm" id="manage_modal_title">📂 账号资源管理</h3>
                <button onclick="document.getElementById('account_manage_modal').classList.add('hidden')" class="text-white/80 hover:text-white text-xl font-bold">×</button>
            </div>
            <div class="p-3 border-b text-xs space-y-2" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                <div class="flex items-center justify-between p-2 rounded border" style="background-color:var(--el-color-primary-light); border-color:#d9ecff">
                    <div class="flex items-center gap-2">
                        <span class="font-bold text-blue-700">🌐 workers.dev 子域名:</span>
                        <span id="manage_subdomain_display" class="font-mono font-bold text-blue-600">加载中...</span>
                        <span class="text-slate-400">.workers.dev</span>
                    </div>
                    <button onclick="promptChangeSubdomain()" class="el-btn el-btn-primary el-btn-xs font-bold">✏️ 修改子域名</button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                <div id="manage_loading" class="text-center py-6 text-slate-400 text-xs">正在拉取 Worker 列表...</div>
                <table class="el-table hidden" id="manage_table">
                    <thead>
                        <tr><th>Worker 实例</th><th>创建时间</th><th>更新时间</th><th class="text-right">操作</th></tr>
                    </thead>
                    <tbody id="manage_list_body"></tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- 弹窗部分：版本历史 & 收藏 Modal -->
    <div id="history_modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
        <div class="el-card w-full max-w-[480px] max-h-[85vh] flex flex-col overflow-hidden animate-fade-in shadow-2xl">
            <div class="p-3.5 border-b flex justify-between items-center" style="background-color:var(--bg-subtle); border-color:var(--border-color)">
                <h3 class="text-sm font-bold flex items-center gap-2" style="color:var(--text-primary)">
                  <span>📜</span> 上游版本历史与版本锁定
                </h3>
                <div class="flex items-center gap-2">
                    <button onclick="openFavoritesPanel()" class="el-btn el-btn-warning el-btn-xs">⭐ 我的收藏</button>
                    <button onclick="document.getElementById('history_modal').classList.add('hidden')" class="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
                </div>
            </div>
            
            <div id="fav_panel_view" class="hidden flex-col h-full p-3 space-y-2 overflow-y-auto" style="background-color:var(--el-color-warning-light)">
                <div class="flex justify-between items-center pb-2 border-b border-amber-200">
                    <span class="text-xs font-bold text-amber-800">⭐ 收藏的版本</span>
                    <button onclick="closeFavoritesPanel()" class="el-btn el-btn-default el-btn-xs">返回历史列表</button>
                </div>
                <div id="fav_full_list" class="space-y-1.5"></div>
            </div>

            <div id="history_panel_view" class="flex flex-col h-full">
                <div class="p-2.5 border-b flex justify-between items-center text-xs" style="border-color:var(--border-light)">
                    <span style="color:var(--text-secondary)">显示最近提交数:</span>
                    <input type="number" id="history_limit_input" value="10" class="el-input py-0.5 px-2 w-16 text-center text-xs" onchange="refreshHistory()">
                </div>
                <div class="flex-1 overflow-y-auto p-3 space-y-2" style="background-color:var(--bg-subtle)">
                    <div id="history_list" class="space-y-1.5"></div>
                </div>
            </div>
        </div>
    </div>

    <!-- 弹窗部分：同步源选择 Modal -->
    <div id="sync_select_modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
        <div class="el-card w-full max-w-[360px] p-4 animate-fade-in shadow-2xl flex flex-col">
            <h3 class="text-sm font-bold mb-3" style="color:var(--text-primary)">📥 选择同步变量的来源账号</h3>
            <div id="sync_list" class="space-y-1.5 overflow-y-auto max-h-[300px] mb-3"></div>
            <button onclick="document.getElementById('sync_select_modal').classList.add('hidden')" class="el-btn el-btn-default w-full">取消</button>
        </div>
    </div>

    <!-- 可拖动悬浮工作台 -->
    <div id="workbench_modal" class="hidden fixed inset-0 z-50" style="pointer-events:none">
        <div id="workbench_panel" class="bg-slate-950 rounded-xl shadow-2xl flex flex-col border border-slate-700" style="pointer-events:auto;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:720px;max-width:92vw;height:55vh;max-height:85vh;resize:both;overflow:hidden">
            <div id="workbench_drag" class="flex justify-between items-center px-4 py-2.5 border-b border-slate-800 cursor-move select-none bg-slate-900">
                <h3 class="text-xs font-bold text-emerald-400 flex items-center gap-2">
                   <span>💻</span> 执行控制台 / 实时工作台
                </h3>
                <div class="flex items-center gap-2">
                    <button onclick="manualReportIssue()" class="text-[11px] text-amber-400 hover:text-amber-300 border border-amber-500/40 bg-amber-950/40 px-2 py-0.5 rounded font-bold">🐛 报障 / Issue</button>
                    <button onclick="document.getElementById('workbench_log').innerHTML=''" class="text-[11px] text-slate-400 hover:text-slate-200 border border-slate-700 px-2 py-0.5 rounded">🗑️ 清空日志</button>
                    <button onclick="closeWorkbench()" class="text-slate-400 hover:text-white text-lg font-bold leading-none">&times;</button>
                </div>
            </div>
            <div id="workbench_log" class="flex-1 overflow-y-auto p-3 text-xs font-mono text-emerald-400 space-y-1 bg-slate-950">
                <div class="text-slate-600">// 等待执行任务...</div>
            </div>
        </div>
    </div>

    <script>
      const TEMPLATES = ${JSON.stringify(Object.fromEntries(Object.entries(TEMPLATES).map(([k, v]) => [k, { defaultVars: v.defaultVars, uuidField: v.uuidField, name: v.name }])))};
      const ECH_PROXIES = ${JSON.stringify(ECH_PROXIES)};
  
      let accounts = [];
      let editingIndex = -1;
      let deletedVars = { cmliu: [], joey: [], ech: [] };
      let deployConfigs = {}; 
      let currentHistoryType = null;
      const recentWbLogs = [];
  
      
      // ==========================================
      // Element UI Tab 切换
      // ==========================================
      function switchProjectTab(tab) {
          ['cmliu', 'joey', 'ech'].forEach(t => {
              const btn = document.getElementById('tab_btn_' + t);
              const panel = document.getElementById('tab_panel_' + t);
              if (btn) btn.classList.toggle('active', t === tab);
              if (panel) panel.classList.toggle('hidden', t !== tab);
          });
      }

      async function init() {
          renderProxySelector();
          await loadAccounts();
          await Promise.all(['cmliu','joey','ech'].map(t => loadVars(t)));
          await loadGlobalConfig();
          loadStats();
          ['cmliu','joey'].forEach(t => { checkDeployConfig(t); checkUpdate(t); });
      }

      // ====            // ==========================================
      // Debug / 错误捕获与一键反馈模块
      // ==========================================
      function getFormattedDebugReport(title, detail, context = {}) {
          const timeStr = new Date().toLocaleString();
          const q3 = String.fromCharCode(96, 96, 96);
          const contextStr = Object.keys(context).length > 0 ? ('\\n\\n### 操作上下文\\\n' + q3 + 'json\\\n' + JSON.stringify(context, null, 2) + '\\\n' + q3) : '';
          const logsStr = recentWbLogs.length > 0 ? ('\\n\\n### 最近工作台日志\\\n' + q3 + '\\\n' + recentWbLogs.slice(-15).join('\\\n') + '\\\n' + q3) : '';
          return '### 错误概述\\n**' + title + '**\\n\\n### 详细报错信息\\\n' + q3 + '\\\n' + detail + '\\\n' + q3 + contextStr + logsStr + '\\n\\n### 发生时间\\\n' + timeStr + '\\n\\n---\\n*来自 CFAuto (V10.11.0) 智能中控诊断模块*';
      }

function copyToClipboard(text, successMsg = '已复制到剪贴板') {
          if (navigator.clipboard && window.isSecureContext) {
              navigator.clipboard.writeText(text).then(() => {
                  Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: successMsg, showConfirmButton: false, timer: 2000 });
              }).catch(() => fallbackCopy(text, successMsg));
          } else {
              fallbackCopy(text, successMsg);
          }
      }

      function fallbackCopy(text, successMsg) {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try {
              document.execCommand('copy');
              Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: successMsg, showConfirmButton: false, timer: 2000 });
          } catch(e) {
              Swal.fire('复制失败', '请手动选择复制', 'error');
          }
          document.body.removeChild(ta);
      }

      function showDebugError(title, detail, context = {}) {
          const report = getFormattedDebugReport(title, detail, context);
          const issueTitle = encodeURIComponent('[Bug Report] ' + title + ': ' + (typeof detail === 'string' ? detail.slice(0, 45) : ''));
          const issueBody = encodeURIComponent(report);
          const issueUrl = 'https://github.com/hc990275/cfauto/issues/new?title=' + issueTitle + '&body=' + issueBody;

          Swal.fire({
              title: '❌ ' + title,
              html: \`
                  <div class="text-left text-xs space-y-2">
                      <div class="bg-red-50 text-red-700 p-2.5 rounded border border-red-200 font-mono break-all max-h-36 overflow-y-auto">\${detail || '未知异常'}</div>
                      <div class="flex gap-2 pt-2">
                          <button id="btn_copy_debug_log" class="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-bold py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1">📋 复制错误日志</button>
                          <button id="btn_open_github_issue" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-2 rounded text-xs flex items-center justify-center gap-1">🚀 一键提交 Issue</button>
                      </div>
                  </div>
              \`,
              icon: 'error',
              showConfirmButton: true,
              confirmButtonText: '关闭',
              confirmButtonColor: '#64748b',
              didOpen: () => {
                  document.getElementById('btn_copy_debug_log').onclick = () => copyToClipboard(report, '📋 错误日志已复制，可随时粘贴！');
                  document.getElementById('btn_open_github_issue').onclick = () => {
                      window.open(issueUrl, '_blank');
                      Swal.fire({ toast: true, position: 'top-end', icon: 'info', title: '已打开 GitHub Issues 页面', showConfirmButton: false, timer: 2500 });
                  };
              }
          });
      }

      function manualReportIssue() {
          const logs = recentWbLogs.slice(-25).join('\\\n') || '（暂无近期日志）';
          showDebugError('用户主动故障报障', '当前系统运行状态与近期工作台日志汇报', { logs: logs });
      }

      function toggleAuthFields() {
          const isToken = document.querySelector('input[name="auth_mode"]:checked').value === 'token';
          document.getElementById('field_auth_token').classList.toggle('hidden', !isToken);
          document.getElementById('field_auth_key').classList.toggle('hidden', isToken);
      }

      function openWorkbench() {
          document.getElementById('workbench_modal').classList.remove('hidden');
      }
      function closeWorkbench() {
          document.getElementById('workbench_modal').classList.add('hidden');
      }
      function wbLog(msg, colorClass) {
          recentWbLogs.push('[' + new Date().toLocaleTimeString() + '] ' + msg);
          if (recentWbLogs.length > 200) recentWbLogs.shift();
          const log = document.getElementById('workbench_log');
          const div = document.createElement('div');
          if (colorClass) div.className = colorClass;
          div.textContent = msg;
          log.appendChild(div);
          log.scrollTop = log.scrollHeight;
      }

      // 工作台拖动
      (function initDrag() {
          let isDragging = false, startX, startY, startLeft, startTop;
          document.addEventListener('mousedown', e => {
              const drag = document.getElementById('workbench_drag');
              if (!drag || !drag.contains(e.target) || e.target.tagName === 'BUTTON') return;
              const panel = document.getElementById('workbench_panel');
              isDragging = true;
              const rect = panel.getBoundingClientRect();
              panel.style.transform = 'none';
              panel.style.left = rect.left + 'px';
              panel.style.top = rect.top + 'px';
              startX = e.clientX; startY = e.clientY;
              startLeft = rect.left; startTop = rect.top;
              e.preventDefault();
          });
          document.addEventListener('mousemove', e => {
              if (!isDragging) return;
              const panel = document.getElementById('workbench_panel');
              panel.style.left = Math.max(0, startLeft + e.clientX - startX) + 'px';
              panel.style.top = Math.max(0, startTop + e.clientY - startY) + 'px';
          });
          document.addEventListener('mouseup', () => { isDragging = false; });
      })();

      async function fetchZonesForAccount() {
          const isToken = document.querySelector('input[name="auth_mode"]:checked')?.value === 'token';
          const apiToken = document.getElementById('in_api_token').value.trim();
          const email = document.getElementById('in_email').value.trim();
          const key = document.getElementById('in_gkey').value.trim();
          const id = document.getElementById('in_id').value.trim();
          const select = document.getElementById('in_zone_select');

          if (isToken && !apiToken) return Swal.fire('提示', '请先填写 API Token', 'warning');
          if (!isToken && (!email || !key)) return Swal.fire('提示', '请先填写 Email 与 Global API Key', 'warning');
          if (!id) return Swal.fire('提示', '请先填写 Account ID', 'warning');

          select.innerHTML = '<option>Loading...</option>';
          try {
              const payload = { accountId: id };
              if (isToken || apiToken) payload.apiToken = apiToken;
              if (email && key) { payload.email = email; payload.globalKey = key; }

              const res = await fetch('/api/zones', {
                  method: 'POST',
                  body: JSON.stringify(payload)
              });
              const d = await res.json();
              if (d.success) {
                  select.innerHTML = '<option value="">-- 请选择预设域名 --</option>' + 
                      d.zones.map(z => \`<option value="\${z.id}" data-name="\${z.name}">\${z.name}</option>\`).join('');
              } else {
                  select.innerHTML = '<option>读取失败</option>';
                  showDebugError('域名读取失败', d.msg || '无法拉取 Cloudflare 托管域名', { accountId: id });
              }
          } catch(e) { 
              select.innerHTML = '<option>网络错误</option>'; 
              showDebugError('网络异常', e.message, { accountId: id });
          }
      }

      function updateZoneInfo() {
          const sel = document.getElementById('in_zone_select');
          if(sel.selectedIndex > 0) {
              document.getElementById('in_zone_id').value = sel.value;
              document.getElementById('in_zone_name').value = sel.options[sel.selectedIndex].dataset.name;
          }
      }

      // 批量部署逻辑
      async function doBatchDeploy() {
          const btn = document.getElementById('btn_do_batch');
          const t = document.getElementById('bd_template').value;
          const name = document.getElementById('bd_name').value;
          const kvName = document.getElementById('bd_kv_name').value;
          const enableKV = document.getElementById('bd_enable_kv').checked;
          const useSavedVars = document.getElementById('bd_use_saved_vars').checked;

          if (!name) return Swal.fire('提示', 'Worker名称必填', 'warning');
          if (enableKV && !kvName) return Swal.fire('提示', '开启 KV 绑定时必须填写 KV 名称', 'warning');
          
          btn.disabled = true;
          btn.innerText = "⏳ 准备中...";
          openWorkbench();
          wbLog('✨ 开始批量部署...', 'text-yellow-400');
          
          try {
             btn.innerText = "🚀 部署中...";
             const chks = document.querySelectorAll('.bd-acc-chk:checked');
             if(chks.length===0) throw new Error("至少选择一个账号");
             const targetAccounts = Array.from(chks).map(c => c.value);
             const config = {};
             if (t === 'cmliu') {
                  config.admin = document.getElementById('bd_admin_pass').value;
                  config.uuid = document.getElementById('bd_uuid').value; 
             } else {
                  config.uuid = document.getElementById('bd_uuid').value;
             }

              let savedVars = null;
              if (useSavedVars) {
                  wbLog('📦 读取已保存变量 (VARS_' + t + ')...', 'text-blue-300');
                  try {
                      const vr = await fetch('/api/settings?type=' + t);
                      savedVars = await vr.json();
                      if (Array.isArray(savedVars) && savedVars.length > 0) {
                          wbLog('✅ 读取到 ' + savedVars.length + ' 个变量', 'text-green-300');
                          Object.entries(config).forEach(([k, v]) => {
                              if (v) {
                                  const idx = savedVars.findIndex(sv => sv.key === k);
                                  if (idx !== -1) savedVars[idx].value = v;
                                  else savedVars.push({ key: k, value: v });
                              }
                          });
                      } else { savedVars = null; }
                  } catch(e) { savedVars = null; }
              }

              const res = await fetch('/api/batch_deploy', {
                   method: 'POST',
                   body: JSON.stringify({ 
                       template: t, 
                       workerName: name, 
                       kvName: kvName, 
                       config: config, 
                       targetAccounts: targetAccounts,
                       disableWorkersDev: document.getElementById('bd_disable_workers_dev').checked,
                       customDomainPrefix: document.getElementById('bd_domain_prefix').value,
                       enableKV: enableKV,
                       savedVars: savedVars 
                   })
               });
              const logs = await res.json();
              let hasErr = false;
              let errMsg = '';
              logs.forEach(l => {
                  if (l.success && l.msg.startsWith('✅')) wbLog('✅ ' + l.msg.replace('✅ ', ''), 'text-white');
                  else {
                      wbLog('[' + (l.success ? 'OK' : 'ERR') + '] ' + l.name + ': ' + l.msg, l.success ? '' : 'text-red-400');
                      if (!l.success) { hasErr = true; errMsg += l.name + ': ' + l.msg + '\\\n'; }
                  }
              });
              
              document.getElementById('batch_deploy_modal').classList.add('hidden');
              await loadAccounts(); 
              if (hasErr) {
                  showDebugError('批量部署中存在错误', errMsg, { template: t, workerName: name, targetAccounts });
              } else {
                  Swal.fire('完成', '全部部署完成，请查看工作台', 'success');
              }

           } catch(e) { 
               showDebugError('批量部署失败', e.message, { template: t, workerName: name });
               wbLog('❌ Error: ' + e.message, 'text-red-500');
           }
          btn.disabled = false;
          btn.innerText = "🚀 开始部署";
      }

      function openBatchDeployModal() {
          const m = document.getElementById('batch_deploy_modal');
          const list = document.getElementById('bd_account_list');
          list.innerHTML = '';
          accounts.forEach(a => {
              const div = document.createElement('div');
              div.className = "flex items-center gap-1";
              div.innerHTML = \`<input type="checkbox" value="\${a.alias}" class="bd-acc-chk" id="chk_\${a.alias}"><label for="chk_\${a.alias}">\${a.alias}</label>\`;
              list.appendChild(div);
          });
          document.getElementById('bd_uuid').value = crypto.randomUUID();
          toggleBatchInputs();
          m.classList.remove('hidden');
      }

      function toggleBatchInputs() {
          const t = document.getElementById('bd_template').value;
          document.getElementById('bd_config_cmliu').classList.toggle('hidden', t !== 'cmliu');
          document.getElementById('bd_config_joey').classList.toggle('hidden', t !== 'joey');
          const kvCheck = document.getElementById('bd_enable_kv');
          if (t === 'joey') kvCheck.checked = false; else kvCheck.checked = true;
      }

      let currentManageAccIndex = -1;

      async function openAccountManage(i) {
          currentManageAccIndex = i;
          const acc = accounts[i];
          if (!acc.apiToken && !acc.globalKey) return Swal.fire('无法管理', '请先配置 API Token 或 Global API Key', 'error');

          const modal = document.getElementById('account_manage_modal');
          const table = document.getElementById('manage_table');
          const tbody = document.getElementById('manage_list_body');
          const loading = document.getElementById('manage_loading');
          const subDisplay = document.getElementById('manage_subdomain_display');
          
          document.getElementById('manage_modal_title').innerText = '📂 管理账号: ' + acc.alias;
          subDisplay.innerText = '加载中...';
          modal.classList.remove('hidden');
          table.classList.add('hidden');
          loading.classList.remove('hidden');
          tbody.innerHTML = '';

          const payload = { accountId: acc.accountId, email: acc.email, globalKey: acc.globalKey, apiToken: acc.apiToken };

          try {
              const [workersRes, subRes] = await Promise.all([
                  fetch('/api/all_workers', {
                      method: 'POST',
                      body: JSON.stringify(payload)
                  }),
                  fetch('/api/get_subdomain', {
                      method: 'POST',
                      body: JSON.stringify(payload)
                  })
              ]);
              
              const subData = await subRes.json();
              if (subData.success && subData.subdomain) {
                  subDisplay.innerText = subData.subdomain;
              } else {
                  subDisplay.innerText = subData.msg || '未设置';
              }

              const d = await workersRes.json();
              loading.classList.add('hidden');
              
              if (d.success) {
                  table.classList.remove('hidden');
                  if (d.workers.length === 0) {
                      tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4">无 Worker</td></tr>';
                  } else {
                      tbody.innerHTML = d.workers.map(w => \`
                          <tr class="hover:bg-gray-50 border-b">
                              <td class="font-bold text-indigo-600">\${w.id}</td>
                              <td>\${new Date(w.created_on).toLocaleDateString()}</td>
                              <td>\${new Date(w.modified_on).toLocaleDateString()}</td>
                              <td class="text-right">
                                  <button onclick="confirmDeleteWorker('\${acc.alias}', '\${w.id}', \${i})" class="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">🗑️ 删除</button>
                              </td>
                          </tr>
                      \`).join('');
                  }
              } else {
                  tbody.innerHTML = \`<tr><td colspan="4" class="text-center text-red-500 py-4">\${d.msg}</td></tr>\`;
                  table.classList.add('hidden');
                  showDebugError('账号 Worker 列表读取失败', d.msg, { accountAlias: acc.alias });
              }
          } catch(e) { 
              loading.innerText = "网络错误"; 
              showDebugError('管理接口连接异常', e.message, { accountAlias: acc.alias });
          }
      }

      async function promptChangeSubdomain() {
          if (currentManageAccIndex < 0) return;
          const acc = accounts[currentManageAccIndex];
          const currentSub = document.getElementById('manage_subdomain_display').innerText;
          
          const { value: newSub } = await Swal.fire({
              title: '修改 Workers.dev 子域名',
              html: \`
                  <div class="text-left text-sm space-y-2">
                      <div class="bg-gray-50 p-2 rounded">当前: <b>\${currentSub}</b>.workers.dev</div>
                      <input id="swal_new_subdomain" class="swal2-input" placeholder="输入新子域名前缀" style="margin:0;width:100%">
                      <div class="text-xs text-gray-400">⚠️ 修改子域名可能需要数分钟生效，且可能影响现有 Worker 的访问地址。</div>
                  </div>
              \`,
              focusConfirm: false,
              showCancelButton: true,
              confirmButtonText: '确认修改',
              cancelButtonText: '取消',
              confirmButtonColor: '#4f46e5',
              preConfirm: () => {
                  const val = document.getElementById('swal_new_subdomain').value.trim();
                  if (!val) { Swal.showValidationMessage('请输入新子域名'); return false; }
                  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(val) && val.length > 1 || val.length < 1) {
                      Swal.showValidationMessage('子域名只能包含字母、数字和连字符'); return false;
                  }
                  return val;
              }
          });

          if (!newSub) return;

          const confirm2 = await Swal.fire({
              title: '二次确认',
              html: '确定将子域名从 <b>' + currentSub + '</b> 改为 <b>' + newSub + '</b> 吗？<br><span class="text-xs text-red-500">此操作会影响所有使用 workers.dev 域名的 Worker！</span>',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: '确认修改',
              cancelButtonText: '取消',
              confirmButtonColor: '#d33'
          });

          if (!confirm2.isConfirmed) return;

          try {
              Swal.fire({ title: '修改中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
              const res = await fetch('/api/change_subdomain', {
                  method: 'POST',
                  body: JSON.stringify({ accountId: acc.accountId, email: acc.email, globalKey: acc.globalKey, apiToken: acc.apiToken, newSubdomain: newSub })
              });
              const data = await res.json();
              if (data.success) {
                  document.getElementById('manage_subdomain_display').innerText = data.subdomain || newSub;
                  Swal.fire('修改成功', '子域名已更新为: ' + (data.subdomain || newSub) + '.workers.dev', 'success');
              } else {
                  showDebugError('修改子域名失败', data.msg, { accountAlias: acc.alias, newSub });
              }
          } catch(e) {
              showDebugError('修改子域名网络异常', e.message, { accountAlias: acc.alias, newSub });
          }
      }

      async function confirmDeleteWorker(alias, workerId, accIndex) {
          const result = await Swal.fire({
              title: '危险操作',
              html: \`
                <p>确认要删除 <b>\${workerId}</b> 吗？</p>
                <div class="mt-4 text-left bg-gray-50 p-2 rounded text-xs">
                    <label class="flex items-center space-x-2">
                        <input type="checkbox" id="del_kv_chk" checked class="form-checkbox text-red-600">
                        <span class="text-gray-700 font-bold">同时删除绑定的 KV (推荐)</span>
                    </label>
                    <p class="text-gray-400 mt-1 pl-5">执行顺序: 1.读取绑定 -> 2.删除Worker(自动解绑) -> 3.删除KV空间</p>
                </div>
              \`,
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: '确认删除',
              confirmButtonColor: '#d33',
              showLoaderOnConfirm: true,
              preConfirm: () => {
                  const deleteKv = document.getElementById('del_kv_chk').checked;
                  const acc = accounts[accIndex];
                  return fetch('/api/delete_worker', {
                      method: 'POST',
                      body: JSON.stringify({ 
                          accountId: acc.accountId, 
                          email: acc.email, 
                          globalKey: acc.globalKey, 
                          apiToken: acc.apiToken,
                          workerName: workerId,
                          deleteKv: deleteKv 
                      })
                  }).then(response => response.json()).then(data => {
                      if (!data.success) throw new Error(data.msg);
                      return data;
                  }).catch(error => Swal.showValidationMessage('删除失败: ' + error));
              }
          });

          if (result.isConfirmed) {
              Swal.fire('已删除', 'Worker 及相关资源已清理', 'success');
              await loadAccounts(); 
              openAccountManage(accIndex);
          }
      }

      function renderTable() {
          const tb = document.getElementById('account_body');
          const badge = document.getElementById('account_count_badge');
          if (badge) badge.innerText = accounts.length + ' 个已配置账号';
          
          if (accounts.length === 0) { 
              tb.innerHTML = '<tr><td colspan="6" class="text-center text-slate-400 py-8 text-xs">暂无配置账号，请点击右上角「➕ 添加账号」</td></tr>'; 
              return; 
          }
          const sortedAccounts = [...accounts].sort((a, b) => (b.stats ? b.stats.total : 0) - (a.stats ? a.stats.total : 0));
          tb.innerHTML = sortedAccounts.map((a) => {
              const originalIndex = accounts.findIndex(acc => acc.alias === a.alias);
              const count = (a.workers_cmliu||[]).length + (a.workers_joey||[]).length + (a.workers_ech||[]).length;
              const totalReq = a.stats ? a.stats.total : 0;
              const maxReq = a.stats ? a.stats.max : 100000;
              const percent = ((totalReq / maxReq) * 100).toFixed(1);
              
              let barColor = 'bg-emerald-500'; 
              let tagColor = 'el-tag-green';
              if (percent > 70) { barColor = 'bg-amber-500'; tagColor = 'el-tag-orange'; }
              if (percent >= 90) { barColor = 'bg-rose-500'; tagColor = 'el-tag-red'; }
              
              const zoneBadge = a.defaultZoneName ? ('<span class="el-tag el-tag-purple font-mono">' + a.defaultZoneName + '</span>') : '<span class="text-slate-300">-</span>';
              
              return '<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50">' +
                  '<td class="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">' +
                      '<span>🔑</span>' + a.alias +
                  '</td>' +
                  '<td>' + zoneBadge + '</td>' +
                  '<td><span class="el-tag el-tag-blue font-mono font-bold">' + count + ' 个</span></td>' +
                  '<td class="font-mono text-xs font-semibold">' + totalReq.toLocaleString() + '</td>' +
                  '<td>' +
                      '<div class="flex items-center gap-2">' +
                          '<div class="w-16 bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">' +
                              '<div class="' + barColor + ' h-2 transition-all duration-500" style="width: ' + Math.min(percent, 100) + '%"></div>' +
                          '</div>' +
                          '<span class="el-tag ' + tagColor + ' text-[10px]">' + percent + '%</span>' +
                      '</div>' +
                  '</td>' +
                  '<td class="text-right space-x-1">' +
                      '<button onclick="openAccountManage(' + originalIndex + ')" class="el-btn el-btn-default el-btn-xs font-bold text-indigo-600 hover:text-indigo-700">📂 管理</button>' +
                      '<button onclick="editAccount(' + originalIndex + ')" class="el-btn el-btn-default el-btn-xs">✏️ 编辑</button>' +
                      '<button onclick="delAccount(' + originalIndex + ')" class="el-btn el-btn-default el-btn-xs text-rose-500 hover:text-rose-600">🗑️</button>' +
                  '</td>' +
              '</tr>';
          }).join('');
      }

      async function loadAccounts() { try { const r = await fetch('/api/accounts'); accounts = await r.json(); accounts.forEach(a => a.stats = a.stats || {total:0,max:100000}); renderTable(); } catch(e){} }
      
      async function saveAccount() { 
          const isToken = document.querySelector('input[name="auth_mode"]:checked')?.value === 'token';
          const o={
              alias:document.getElementById('in_alias').value.trim(),
              accountId:document.getElementById('in_id').value.trim(),
              apiToken:isToken ? document.getElementById('in_api_token').value.trim() : (document.getElementById('in_api_token').value.trim() || undefined),
              email:!isToken ? document.getElementById('in_email').value.trim() : (document.getElementById('in_email').value.trim() || undefined),
              globalKey:!isToken ? document.getElementById('in_gkey').value.trim() : (document.getElementById('in_gkey').value.trim() || undefined),
              defaultZoneName:document.getElementById('in_zone_name').value,
              defaultZoneId:document.getElementById('in_zone_id').value,
              stats:(editingIndex>=0 && accounts[editingIndex]) ? (accounts[editingIndex].stats || {total:0,max:100000}) : {total:0,max:100000}
          }; 
          ['cmliu','joey','ech'].forEach(t=>o['workers_'+t]=document.getElementById('in_workers_'+t).value.split(/,|，/).map(s=>s.trim()).filter(s=>s)); 
          if(editingIndex>=0)accounts[editingIndex]=o; else accounts.push(o); 
          await fetch('/api/accounts',{method:'POST',body:JSON.stringify(accounts)}); 
          renderTable(); 
          document.getElementById('account_form').classList.add('hidden'); 
      }

      function editAccount(i){ 
          editingIndex=i; const a=accounts[i]; 
          document.getElementById('in_alias').value=a.alias||""; 
          document.getElementById('in_id').value=a.accountId||""; 
          document.getElementById('in_api_token').value=a.apiToken||"";
          document.getElementById('in_email').value=a.email||""; 
          document.getElementById('in_gkey').value=a.globalKey||""; 
          document.getElementById('in_zone_name').value=a.defaultZoneName||""; 
          document.getElementById('in_zone_id').value=a.defaultZoneId||""; 
          
          const hasToken = !!a.apiToken;
          const radioToken = document.querySelector('input[name="auth_mode"][value="token"]');
          const radioKey = document.querySelector('input[name="auth_mode"][value="key"]');
          if (hasToken) { radioToken.checked = true; } else { radioKey.checked = true; }
          toggleAuthFields();

          const select = document.getElementById('in_zone_select');
          if(a.defaultZoneName) { select.innerHTML = \`<option value="\${a.defaultZoneId}" data-name="\${a.defaultZoneName}" selected>\${a.defaultZoneName}</option>\`; } else { select.innerHTML = '<option value="">(请点击读取)</option>'; }

          ['cmliu','joey','ech'].forEach(t=>document.getElementById('in_workers_'+t).value=(a['workers_'+t]||[]).join(',')); 
          document.getElementById('account_form').classList.remove('hidden'); 
      }

      async function delAccount(i){ if(confirm('删除账号配置？')){ accounts.splice(i,1); await fetch('/api/accounts',{method:'POST',body:JSON.stringify(accounts)}); renderTable(); } }
      function resetFormForAdd(){ 
          editingIndex=-1; 
          document.querySelectorAll('#account_form input').forEach(i=>{ if(i.type!=='radio') i.value=''; }); 
          document.querySelector('input[name="auth_mode"][value="token"]').checked = true;
          toggleAuthFields();
          document.getElementById('in_zone_select').innerHTML='<option value="">(请先填写API信息后点击读取)</option>'; 
          document.getElementById('account_form').classList.remove('hidden'); 
      }
      function cancelEdit(){ document.getElementById('account_form').classList.add('hidden'); }
      async function deleteFromEdit(){ if(editingIndex>=0)delAccount(editingIndex); cancelEdit(); }
      async function loadStats(){ const b=document.getElementById('btn_stats'); b.disabled=true; try{ const r=await fetch('/api/stats'); const d=await r.json(); accounts.forEach(a=>{ const s=d.find(x=>x.alias===a.alias); a.stats=s&&!s.error?s:{total:0,max:100000}; }); renderTable(); }catch(e){} b.disabled=false; }

      function toggleEchToken() {
          const enabled = document.getElementById('ech_token_enabled').checked;
          const input = document.getElementById('ech_token_input');
          const status = document.getElementById('ech_token_status');
          if (enabled) {
              input.disabled = false;
              input.classList.remove('opacity-50', 'cursor-not-allowed');
              status.textContent = '(已开启 - Token 将注入)';
              status.className = 'text-green-600 text-[10px] font-bold';
          } else {
              input.disabled = true;
              input.classList.add('opacity-50', 'cursor-not-allowed');
              status.textContent = '(关闭 - 不填入)';
              status.className = 'text-gray-400 text-[10px]';
          }
      }

      async function deploy(t, sha='') {
         const btn = document.getElementById('btn_deploy_' + t); const ot = btn.innerText; btn.innerText = '⏳ 部署中...'; btn.disabled = true;
         const vars = []; document.querySelectorAll('.var-row-' + t).forEach(r => { const k = r.querySelector('.key').value; const v = r.querySelector('.val').value; if(k) vars.push({key: k, value: v}); });

         let echTokenEnabled = false;
         let echDisableWorkersDev = false;
         if (t === 'ech') {
             const tokenEnabled = document.getElementById('ech_token_enabled').checked;
             const tokenVal = document.getElementById('ech_token_input').value.trim();
             echTokenEnabled = tokenEnabled && !!tokenVal;
             if (tokenVal) {
                 const idx = vars.findIndex(v => v.key === 'TOKEN');
                 if (idx !== -1) vars[idx].value = tokenVal;
                 else vars.push({ key: 'TOKEN', value: tokenVal });
             }
             vars._echTokenEnabled = echTokenEnabled;
             echDisableWorkersDev = document.getElementById('ech_disable_workers_dev').checked;
         }

         await fetch('/api/settings?type=' + t, {method: 'POST', body: JSON.stringify(vars)});
         openWorkbench();
         wbLog('⚡ Deploying ' + t + '...', 'text-yellow-400');
         try {
             const res = await fetch('/api/deploy?type=' + t, { method: 'POST', body: JSON.stringify({ type: t, variables: vars, deletedVariables: deletedVars[t], targetSha: sha, echTokenEnabled: echTokenEnabled, echDisableWorkersDev: echDisableWorkersDev }) });
             const logs = await res.json();
             let hasErr = false;
             let errMsg = '';
             logs.forEach(l => {
                 wbLog('[' + (l.success ? 'OK' : 'ERR') + '] ' + l.name + ': ' + l.msg, l.success ? '' : 'text-red-400');
                 if (!l.success) { hasErr = true; errMsg += l.name + ': ' + l.msg + '\\\n'; }
             });
             deletedVars[t] = [];
             if (hasErr) {
                 showDebugError('部署过程存在错误', errMsg, { template: t, targetSha: sha });
             }
             setTimeout(() => { checkUpdate(t); checkDeployConfig(t); }, 1000);
         } catch(e) { 
             wbLog('Error: ' + e.message, 'text-red-500'); 
             showDebugError('部署执行失败', e.message, { template: t });
         }
         btn.innerText = ot; btn.disabled = false;
      }

      async function fix1101(t) {
          const confirm = await Swal.fire({
              title: '🔧 一键修复 1101',
              html: '<div class="text-left text-sm"><p class="mb-2">将对所有账号执行：</p><ol class="list-decimal pl-5 space-y-1"><li>📋 记录变量绑定 + 自定义域名</li><li>🗑️ 删除 Worker</li><li>🌐 随机修改子域名</li><li>🚀 用相同名称重建</li><li>♻️ 恢复所有变量值 + 自定义域名</li></ol><p class="mt-3 text-orange-600 font-bold">⚠️ 子域名变更影响该账号下所有 Worker！</p></div>',
              icon: 'warning', showCancelButton: true,
              confirmButtonText: '执行修复', cancelButtonText: '取消',
              confirmButtonColor: '#f97316'
          });
          if (!confirm.isConfirmed) return;
          const btn = document.getElementById('btn_fix1101_' + t); const ot = btn.innerText; btn.innerText = '⏳ 修复中...'; btn.disabled = true;
          openWorkbench();
          wbLog('🔧 正在修复 ' + t + ' 的 1101...', 'text-orange-400');
          try {
              const res = await fetch('/api/fix_1101', { method: 'POST', body: JSON.stringify({ type: t }) });
              const logs = await res.json();
              let hasErr = false;
              let errMsg = '';
              logs.forEach(l => {
                  const color = l.success ? 'text-green-300' : 'text-red-400';
                  wbLog('[' + (l.success ? '✅' : '❌') + '] ' + l.name, color);
                  if (l.msg) l.msg.split(' | ').forEach(s => wbLog('   ' + s, 'text-slate-400'));
                  if (!l.success) { hasErr = true; errMsg += l.name + ': ' + l.msg + '\\\n'; }
              });
              if (hasErr) {
                  showDebugError('1101 修复过程存在异常', errMsg, { template: t });
              }
              setTimeout(() => { checkUpdate(t); checkDeployConfig(t); }, 1000);
          } catch(e) { 
              wbLog('Error: ' + e.message, 'text-red-500'); 
              showDebugError('1101 修复接口异常', e.message, { template: t });
          }
          btn.innerText = ot; btn.disabled = false;
      }

      function selectSyncAccount(t) {
          const m = document.getElementById('sync_select_modal');
          const l = document.getElementById('sync_list');
          const v = accounts.filter(a => a[\`workers_\${t}\`] && a[\`workers_\${t}\`].length);
          l.innerHTML = '';
          v.forEach(a => {
              const b = document.createElement('button');
              b.className = "w-full text-left bg-slate-50 p-2 mb-1 text-xs border rounded hover:bg-blue-50";
              b.innerHTML = \`<b>\${a.alias}</b> -> \${a[\`workers_\${t}\`][0]}\`;
              b.onclick = () => doSync(a, t, a[\`workers_\${t}\`][0]);
              l.appendChild(b);
          });
          m.classList.remove('hidden');
      }

      async function doSync(a, t, n) {
          document.getElementById('sync_select_modal').classList.add('hidden');
          if (!confirm('确认覆盖当前变量配置?')) return;
          const r = await fetch('/api/fetch_bindings', {
              method: 'POST',
              body: JSON.stringify({ accountId: a.accountId, email: a.email, globalKey: a.globalKey, apiToken: a.apiToken, workerName: n })
          });
          const d = await r.json();
          if (d.success) {
              const c = document.getElementById(\`vars_\${t}\`);
              c.innerHTML = ''; deletedVars[t] = [];
              d.data.forEach(v => addVarRow(t, v.key, v.value));
              Swal.fire('同步成功', '变量已更新', 'success');
          } else { 
              showDebugError('同步变量失败', d.msg, { accountAlias: a.alias, workerName: n });
          }
      }

      function renderProxySelector(){ 
          const c=document.getElementById('ech_proxy_selector_container'); 
          let h='<select id="ech_proxy_select" onchange="applyEchProxy()" class="w-full text-xs border rounded p-1 mb-1"><option value="">-- 选择 ProxyIP 节点 --</option>'; 
          ECH_PROXIES.forEach(g=>{ 
              h+=\`<optgroup label="\${g.group}">\`; 
              g.list.forEach(i=>h+=\`<option value="\${i.split(' ')[0]}">\${i}</option>\`); 
              h+='</optgroup>'; 
          }); 
          c.innerHTML=h+'</select>'; 
      }
      function applyEchProxy(){ const v=document.getElementById('ech_proxy_select').value; if(v)addVarRow('ech','PROXYIP',v); }
      function addVarRow(t, k = '', v = '') {
          const c = document.getElementById('vars_' + t);
          if (!c) return;
          const d = document.createElement('div');
          d.className = 'flex gap-2 items-center mb-1.5 var-row-' + t;
          
          const keyInput = document.createElement('input');
          keyInput.className = 'el-input w-1/3 key font-bold font-mono text-xs';
          keyInput.placeholder = 'Variable Key';
          keyInput.value = k;
          d.appendChild(keyInput);

          const valInput = document.createElement('input');
          valInput.className = 'el-input w-2/3 val font-mono text-xs';
          valInput.placeholder = 'Value';
          valInput.value = v;
          d.appendChild(valInput);

          if (t === 'cmliu' && (k === 'PROXYIP' || k === 'DOH')) {
              const options = k === 'DOH' ? ["https://dns.jhb.ovh/joeyblog", "https://doh.cmliussss.com/CMLiussss", "cloudflare-ech.com"] : ECH_PROXIES.flatMap(g => g.list);
              const select = document.createElement('select');
              select.className = 'el-input py-1 px-1.5 w-8 text-xs cursor-pointer';
              select.innerHTML = '<option>▼</option>' + options.map(u => '<option value="' + u.split(' ')[0] + '">' + u + '</option>').join('');
              select.onchange = () => { valInput.value = select.value; };
              d.appendChild(select);
          }

          const delBtn = document.createElement('button');
          delBtn.className = 'el-btn el-btn-default el-btn-xs text-rose-500 hover:bg-rose-50 font-bold px-2';
          delBtn.textContent = '×';
          delBtn.onclick = () => removeVarRow(delBtn, t);
          d.appendChild(delBtn);

          c.appendChild(d);
      }
      function removeVarRow(b,t){ const k=b.parentElement.querySelector('.key').value; if(k)deletedVars[t].push(k); b.parentElement.remove(); }
      async function loadVars(t){ const c=document.getElementById(\`vars_\${t}\`); c.innerHTML='<div class="text-center text-gray-300">...</div>'; try{ const r=await fetch(\`/api/settings?type=\${t}\`); const v=await r.json(); const m=new Map(); if(Array.isArray(v))v.forEach(x=>m.set(x.key,x.value)); TEMPLATES[t].defaultVars.forEach(k=>{ if(!m.has(k))m.set(k,k===TEMPLATES[t].uuidField?crypto.randomUUID():'') }); c.innerHTML=''; deletedVars[t]=[]; m.forEach((val,key)=>addVarRow(t,key,val)); }catch(e){ c.innerHTML='Load Error'; } }
      
      // Auto Config
      async function loadGlobalConfig(){ try{ const r=await fetch('/api/auto_config'); const c=await r.json(); document.getElementById('auto_update_toggle').checked=!!c.enabled; document.getElementById('auto_update_interval').value=c.interval||30; document.getElementById('fuse_threshold').value=c.fuseThreshold||0; }catch(e){} }
      async function saveAutoConfig(){ await fetch('/api/auto_config',{method:'POST',body:JSON.stringify({enabled:document.getElementById('auto_update_toggle').checked, interval:document.getElementById('auto_update_interval').value, fuseThreshold:document.getElementById('fuse_threshold').value})}); alert('已保存配置'); }
      
      async function checkUpdate(t){ 
          const el=document.getElementById(\`ver_\${t}\`); 
          try{ 
              const r=await fetch(\`/api/check_update?type=\${t}\`); 
              const d=await r.json(); 
              
              if(d.error) throw new Error(d.error);

              const remoteDate = new Date(d.remote.date).toLocaleString([], {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
              let statusHtml = '';
              let localDateStr = '未部署';

              if (d.local && d.local.date) {
                   localDateStr = new Date(d.local.date).toLocaleString([], {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
              }

              if(d.remote && (!d.local || d.remote.sha !== d.local.sha)) {
                  statusHtml = \`<div class="flex justify-between text-red-600 font-bold"><span>🚀 上游: \${remoteDate}</span><span class="animate-pulse">New!</span></div>\`;
              } else {
                  statusHtml = \`<div class="flex justify-between text-green-600"><span>✅ 上游: \${remoteDate}</span><span>Latest</span></div>\`;
              }
              
              const localClass = (d.local && d.remote && d.local.sha === d.remote.sha) ? 'text-gray-500' : 'text-orange-500 font-bold';
              const localHtml = \`<div class="flex justify-between \${localClass}"><span>💻 本地: \${localDateStr}</span><span>\${d.mode==='fixed'?'🔒 Locked':''}</span></div>\`;

              el.innerHTML = statusHtml + localHtml;
          }catch(err){ 
              el.innerHTML="<span class='text-red-400'>Check Fail</span>"; 
          } 
      }
      
      function timeAgo(s){ const sec=(new Date()-new Date(s))/1000; if(sec>86400)return Math.floor(sec/86400)+"天前"; if(sec>3600)return Math.floor(sec/3600)+"小时前"; return "刚刚"; }
      function refreshUUID(t){ const k=TEMPLATES[t].uuidField; if(k)document.querySelectorAll(\`.var-row-\${t}\`).forEach(r=>{ if(r.querySelector('.key').value===k){ const i=r.querySelector('.val'); i.value=crypto.randomUUID(); i.classList.add('bg-green-100'); setTimeout(()=>i.classList.remove('bg-green-100'),500); } }); }
      async function checkDeployConfig(t){ try{ const r=await fetch(\`/api/deploy_config?type=\${t}\`); const c=await r.json(); deployConfigs[t]=c; const b=document.getElementById(\`badge_\${t}\`); if(c.mode==='fixed'){ b.className="text-[9px] px-1.5 py-0.5 rounded text-white bg-orange-500 font-bold"; b.innerText="🔒 Locked"; }else{ b.className="text-[9px] px-1.5 py-0.5 rounded text-white bg-green-500"; b.innerText="Auto Update"; } }catch(e){} }

      // 历史记录 & 收藏
      async function openVersionHistory(type){ currentHistoryType=type; refreshHistory(); }
      async function refreshHistory() {
          const type = currentHistoryType; if(!type) return;
          const limit = document.getElementById('history_limit_input').value || 10;
          const modal=document.getElementById('history_modal');const hList=document.getElementById('history_list');
          
          modal.classList.remove('hidden');
          document.getElementById('fav_panel_view').classList.add('hidden');
          document.getElementById('history_panel_view').classList.remove('hidden');

          hList.innerHTML='<div class="text-center text-gray-400 text-xs py-4">加载中...</div>';

          try{
            const[histRes,favRes]=await Promise.all([fetch(\`/api/check_update?type=\${type}&mode=history&limit=\${limit}\`),fetch(\`/api/favorites?type=\${type}\`)]);
            const histData=await histRes.json();const favData=await favRes.json();
            
            window.currentFavData = favData || [];

            hList.innerHTML='';
            const latestBtn=document.createElement('div');
            latestBtn.className="bg-green-50 hover:bg-green-100 p-2 rounded border border-green-200 cursor-pointer transition mb-2";
            latestBtn.innerHTML=\`<div class="flex justify-between items-center"><span class="font-bold text-green-700 text-xs">⚡ Always Latest (部署最新)</span></div>\`;
            latestBtn.onclick=()=>{modal.classList.add('hidden');deploy(type,'latest');};
            hList.appendChild(latestBtn);
            
            if(histData.history){
                histData.history.forEach(commit=>{
                    const item={sha:commit.sha,date:commit.commit.committer.date,message:commit.commit.message};
                    const isFav=window.currentFavData.find(f=>f.sha===item.sha);
                    renderHistoryItem(type,item,hList,false,isFav);
                });
            }
          }catch(e){
              hList.innerHTML='<div class="text-red-400 text-xs">网络错误: ' + e.message + '</div>';
              showDebugError('拉取版本历史失败', e.message, { template: type });
          }
      }

      function openFavoritesPanel() {
          document.getElementById('history_panel_view').classList.add('hidden');
          const panel = document.getElementById('fav_panel_view');
          const list = document.getElementById('fav_full_list');
          panel.classList.remove('hidden');
          panel.classList.add('flex');
          list.innerHTML = '';
          
          if(window.currentFavData && window.currentFavData.length > 0) {
              window.currentFavData.forEach(item => {
                  renderHistoryItem(currentHistoryType, item, list, true, true);
              });
          } else {
              list.innerHTML = '<div class="text-center text-gray-400 text-xs py-4">暂无收藏</div>';
          }
      }

      function closeFavoritesPanel() {
          document.getElementById('fav_panel_view').classList.add('hidden');
          document.getElementById('fav_panel_view').classList.remove('flex');
          document.getElementById('history_panel_view').classList.remove('hidden');
      }
      
      function renderHistoryItem(type,item,container,isFavSection,isFavInHist){
          const shortSha=item.sha.substring(0,7);
          const date=new Date(item.date).toLocaleString();
          const isCurrent=deployConfigs[type]&&deployConfigs[type].currentSha===item.sha;
          const el=document.createElement('div');
          el.className=\`group relative p-2 rounded border transition mb-1 flex gap-2 \${isCurrent?'bg-orange-50 border-orange-300':'bg-white border-gray-100 hover:border-blue-200'}\`;
          
          const starBtn=document.createElement('button');
          starBtn.className=\`text-sm focus:outline-none \${(isFavSection||isFavInHist)?'text-orange-400':'text-gray-300 hover:text-orange-400'}\`;
          starBtn.innerHTML=(isFavSection||isFavInHist)?'★':'☆';
          starBtn.onclick=(e)=>{
              e.stopPropagation();
              toggleFavorite(type,item,(isFavSection||isFavInHist));
          };
          
          const content=document.createElement('div');
          content.className="flex-1 cursor-pointer overflow-hidden";
          content.innerHTML=\`<div class="flex justify-between items-center mb-0.5"><span class="font-mono text-[10px] bg-slate-100 px-1 rounded text-slate-600">\${shortSha}</span><span class="text-[9px] text-gray-400">\${date}</span></div><div class="text-[10px] text-gray-700 truncate">\${item.message}</div>\`;
          content.onclick=()=>{if(confirm(\`确认回滚/锁定到版本 [\${shortSha}]？\`)){document.getElementById('history_modal').classList.add('hidden');deploy(type,item.sha);}};
          
          el.appendChild(starBtn);el.appendChild(content);container.appendChild(el);
      }
      
      async function toggleFavorite(type,item,isRemove){
          await fetch(\`/api/favorites?type=\${type}\`,{method:'POST',body:JSON.stringify({action:isRemove?'remove':'add',item:item})});
          const r = await fetch(\`/api/favorites?type=\${type}\`);
          window.currentFavData = await r.json();
          if(!document.getElementById('fav_panel_view').classList.contains('hidden')) {
              openFavoritesPanel();
          } else {
              refreshHistory();
          }
      }

      // ============== 星空主题引擎 ==============
      let starAnimId = null;
      function initStarfield() {
          const canvas = document.getElementById('starfield');
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          let stars = [], shootingStars = [];
          
          function resize() {
              canvas.width = window.innerWidth;
              canvas.height = window.innerHeight;
          }
          resize();
          window.addEventListener('resize', resize);
          
          function createStars() {
              stars = [];
              const count = Math.floor((canvas.width * canvas.height) / 3000);
              for (let i = 0; i < count; i++) {
                  stars.push({
                      x: Math.random() * canvas.width,
                      y: Math.random() * canvas.height,
                      r: Math.random() * 1.5 + 0.3,
                      alpha: Math.random(),
                      delta: (Math.random() * 0.02 + 0.003) * (Math.random() > 0.5 ? 1 : -1),
                      color: ['#ffffff', '#c4b5fd', '#93c5fd', '#fcd34d', '#a5b4fc'][Math.floor(Math.random() * 5)]
                  });
              }
          }
          createStars();
          window.addEventListener('resize', createStars);

          function maybeShootingStar() {
              if (Math.random() < 0.008 && shootingStars.length < 3) {
                  shootingStars.push({
                      x: Math.random() * canvas.width * 0.7,
                      y: Math.random() * canvas.height * 0.3,
                      len: Math.random() * 80 + 40,
                      speed: Math.random() * 6 + 4,
                      alpha: 1
                  });
              }
          }
          
          function draw() {
              ctx.clearRect(0, 0, canvas.width, canvas.height);
              const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width*0.7);
              grad.addColorStop(0, '#0f172a');
              grad.addColorStop(0.5, '#0c1222');
              grad.addColorStop(1, '#020617');
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              
              const nebula = ctx.createRadialGradient(canvas.width * 0.2, canvas.height * 0.3, 0, canvas.width * 0.2, canvas.height * 0.3, 300);
              nebula.addColorStop(0, 'rgba(139, 92, 246, 0.03)');
              nebula.addColorStop(1, 'transparent');
              ctx.fillStyle = nebula;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              
              const nebula2 = ctx.createRadialGradient(canvas.width * 0.8, canvas.height * 0.7, 0, canvas.width * 0.8, canvas.height * 0.7, 250);
              nebula2.addColorStop(0, 'rgba(59, 130, 246, 0.025)');
              nebula2.addColorStop(1, 'transparent');
              ctx.fillStyle = nebula2;
              ctx.fillRect(0, 0, canvas.width, canvas.height);

              for (const s of stars) {
                  s.alpha += s.delta;
                  if (s.alpha <= 0.1 || s.alpha >= 1) s.delta = -s.delta;
                  ctx.beginPath();
                  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
                  ctx.fillStyle = s.color;
                  ctx.globalAlpha = Math.max(0.1, Math.min(1, s.alpha));
                  ctx.fill();
              }
              ctx.globalAlpha = 1;
              
              maybeShootingStar();
              shootingStars = shootingStars.filter(m => {
                  m.x += m.speed; m.y += m.speed * 0.6; m.alpha -= 0.015;
                  if (m.alpha <= 0) return false;
                  ctx.save();
                  ctx.globalAlpha = m.alpha;
                  const gradient = ctx.createLinearGradient(m.x, m.y, m.x - m.len, m.y - m.len * 0.6);
                  gradient.addColorStop(0, '#ffffff');
                  gradient.addColorStop(1, 'transparent');
                  ctx.strokeStyle = gradient;
                  ctx.lineWidth = 1.5;
                  ctx.beginPath();
                  ctx.moveTo(m.x, m.y);
                  ctx.lineTo(m.x - m.len, m.y - m.len * 0.6);
                  ctx.stroke();
                  ctx.restore();
                  return true;
              });
              
              starAnimId = requestAnimationFrame(draw);
          }
          draw();
      }
      
      function stopStarfield() {
          if (starAnimId) { cancelAnimationFrame(starAnimId); starAnimId = null; }
      }
      
      function toggleTheme() {
          const html = document.documentElement;
          const isDark = html.getAttribute('data-theme') === 'dark';
          if (isDark) {
              html.removeAttribute('data-theme');
              document.getElementById('theme_btn').innerText = '🌙';
              stopStarfield();
              localStorage.setItem('worker_theme', 'light');
          } else {
              html.setAttribute('data-theme', 'dark');
              document.getElementById('theme_btn').innerText = '☀️';
              initStarfield();
              localStorage.setItem('worker_theme', 'dark');
          }
      }

      // ================= YXIP 前端核心逻辑 =================
      const REGION_MAP = {'JP':'日本','KR':'韩国','SG':'新加坡','HK':'香港','TW':'台湾','MY':'马来西亚','TH':'泰国','VN':'越南','PH':'菲律宾','ID':'印尼','IN':'印度','AU':'澳大利亚','NZ':'新西兰','GB':'英国','UK':'英国','DE':'德国','FR':'法国','NL':'荷兰','IT':'意大利','ES':'西班牙','US':'美国','CA':'加拿大','BR':'巴西','ZA':'南非','AE':'阿联酋','RU':'俄罗斯','UA':'乌克兰','SE':'瑞典','CH':'瑞士','TR':'土耳其','AR':'阿根廷','CL':'智利','CO':'哥伦比亚','PE':'秘鲁','MX':'墨西哥','PL':'波兰','FI':'芬兰','NO':'挪威','DK':'丹麦','IE':'爱尔兰','BE':'比利时','AT':'奥地利','CZ':'捷克','HU':'匈牙利','RO':'罗马尼亚','GR':'希腊','PT':'葡萄牙'};
      function getFlagEmoji(code) { if (code === 'TW') return '🇹🇼'; if (code === 'UK') return '🇬🇧'; if (!code || code.length !== 2) return '🇺🇳'; const codePoints = code.toUpperCase().split('').map(char => 127397 + char.charCodeAt()); return String.fromCodePoint(...codePoints); }
      
      let yxipData = {};
      let yxipSelected = [];

      async function showYxipModal() {
          document.getElementById('yxip_modal').classList.remove('hidden');
          toggleYxipAccountSelect();
          if (Object.keys(yxipData).length === 0) {
              await fetchYxipRegions();
          }
      }

      
      function yxipSelectAllAccounts() {
          document.querySelectorAll('input[name="yxip_account"]:not([disabled])').forEach(c => c.checked = true);
      }
      function yxipDeselectAllAccounts() {
          document.querySelectorAll('input[name="yxip_account"]').forEach(c => c.checked = false);
      }

      function toggleYxipAccountSelect() {
          const type = document.getElementById('yxip_type').value;
          const accountArea = document.getElementById('yxip_cmliu_account_area');
          const accountList = document.getElementById('yxip_account_list');
          
          accountArea.classList.remove('hidden');
          const borderCls = type === 'cmliu' ? 'border-red-200' : 'border-blue-200';
          const txtCls = type === 'cmliu' ? 'text-red-500' : 'text-blue-500';
          const bgHoverCls = type === 'cmliu' ? 'hover:bg-red-50' : 'hover:bg-blue-50';
          const badgeBgCls = type === 'cmliu' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600';
          const targetArrName = type === 'cmliu' ? 'workers_cmliu' : 'workers_joey';
          const targetNameStr = type === 'cmliu' ? 'CMLiu' : 'Joey';
          
          const btnHtml = '<div class="col-span-full flex gap-2 mb-1"><button type="button" onclick="yxipSelectAllAccounts()" class="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">全选有效账号</button><button type="button" onclick="yxipDeselectAllAccounts()" class="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded">反选所有账号</button></div>';
          
          accountList.className = 'max-h-[150px] overflow-y-auto border rounded p-3 bg-white grid grid-cols-1 md:grid-cols-2 gap-2 shadow-inner ' + borderCls;
          accountList.innerHTML = btnHtml + accounts.map(a => {
              const targetWorkers = a[targetArrName] || [];
              const noWorker = targetWorkers.length === 0;
              const badge = noWorker ? '<span class="text-[10px] text-gray-400 ml-auto mx-1">无 ' + targetNameStr + ' 项目</span>' : '<span class="' + badgeBgCls + ' px-1.5 py-0.5 rounded text-[10px] ml-auto">' + targetWorkers.length + ' 个项目</span>';
              const opacityClass = noWorker ? 'opacity-50 grayscale' : '';
              const disabledAttr = noWorker ? 'disabled' : '';
              return '<label class="flex items-center gap-2 p-2 border rounded cursor-pointer transition-colors ' + bgHoverCls + ' ' + opacityClass + '">' +
                  '<input type="checkbox" name="yxip_account" value="' + a.accountId + '" class="' + txtCls + '" ' + disabledAttr + '>' +
                  '<span class="text-xs font-bold text-gray-700 truncate" title="' + a.email + '">' + (a.alias || a.email) + '</span>' +
                  badge +
              '</label>';
          }).join('');
      }

      async function fetchYxipRegions() {
          const container = document.getElementById('yxip_regions');
          container.innerHTML = '<div class="col-span-full text-center py-4 text-gray-400">✈️ 正在获取全球节点数据...</div>';
          try {
              const res = await fetch('/api/get_regions_data');
              const data = await res.json();
              if(data.success) {
                  yxipData = data.data;
                  renderYxipRegions();
              } else {
                  container.innerHTML = '<div class="col-span-full text-center py-4 text-red-500">❌ 获取失败: ' + data.msg + '</div>';
                  showDebugError('全球优选节点获取失败', data.msg);
              }
          } catch(e) {
              container.innerHTML = '<div class="col-span-full text-center py-4 text-red-500">❌ 网络异常，获取节点数据失败</div>';
              showDebugError('全球优选节点接口网络异常', e.message);
          }
      }

      function renderYxipRegions() {
          const container = document.getElementById('yxip_regions');
          const codes = Object.keys(yxipData).sort();
          if (codes.length === 0) {
              container.innerHTML = '<div class="col-span-full text-center py-4 text-gray-400">没有找到任何可用节点</div>';
              return;
          }
          container.innerHTML = codes.map(code => {
              const count = yxipData[code].length;
              const cname = REGION_MAP[code] || code;
              return '<label class="flex items-center gap-1.5 p-1.5 border rounded cursor-pointer hover:bg-yellow-50 transition-colors">' +
                  '<input type="checkbox" value="' + code + '" onchange="toggleYxipRegion(this)" class="text-yellow-500 accent-yellow-500 rounded">' +
                  '<span class="font-bold text-gray-700 text-sm truncate">' + cname + '</span>' +
                  '<span class="text-[10px] text-gray-400 ml-auto">' + count + '</span>' +
              '</label>';
          }).join('');
      }

      function toggleYxipRegion(checkbox) {
          if(checkbox.checked) yxipSelected.push(checkbox.value);
          else yxipSelected = yxipSelected.filter(v => v !== checkbox.value);
      }

      function yxipSelectAll() {
          document.querySelectorAll('#yxip_regions input[type="checkbox"]').forEach(cb => {
              if(!cb.checked) { cb.checked = true; yxipSelected.push(cb.value); }
          });
      }

      function yxipSelectNone() {
          document.querySelectorAll('#yxip_regions input[type="checkbox"]').forEach(cb => { cb.checked = false; });
          yxipSelected = [];
      }
      
      // Fisher-Yates shuffle
      function shuffleArray(array) {
          for (let i = array.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [array[i], array[j]] = [array[j], array[i]];
          }
          return array;
      }

      async function doYxipDeploy() {
          const type = document.getElementById('yxip_type').value;
          const limit = parseInt(document.getElementById('yxip_limit').value) || 10;
          
          if (yxipSelected.length === 0) return alert('⚠️ 请至少选择一个区域！');

          let targetAccounts = [];
          const checkedBoxes = Array.from(document.querySelectorAll('input[name="yxip_account"]:checked'));
          if (checkedBoxes.length === 0) {
               return alert(type === 'cmliu' ? '⚠️ 请至少选择一个包含有 CMLiu 项目的目标账号！' : '⚠️ 请至少选择一个包含有 Joey 项目的目标账号！');
          }
          checkedBoxes.forEach(box => {
              const acc = accounts.find(a => a.accountId === box.value);
              if (acc) targetAccounts.push(acc);
          });

          const btnIcon = document.getElementById('yxip_btn_icon');
          btnIcon.innerHTML = '<svg class="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>';
          
          const regionCounters = {};
          const results = [];
          
          for (const region of yxipSelected) {
              const ipList = shuffleArray([...yxipData[region]]);
              const toTake = Math.min(limit, ipList.length);
              
              for (let i = 0; i < toTake; i++) {
                  const item = ipList[i];
                  const code = item.code;
                  regionCounters[code] = (regionCounters[code] || 0) + 1;
                  const seqNo = regionCounters[code].toString().padStart(2, '0');
                  const flag = getFlagEmoji(code);
                  const cname = REGION_MAP[code] || code;
                  const alias = flag + ' ' + cname + ' ' + seqNo;
                  results.push(item.ipPort + '#' + alias);
              }
          }
          
          const rawContent = type.startsWith('joey') ? results.join(',') : results.join('\\\n');
          
          try {
              document.getElementById('yxip_modal').classList.add('hidden');
              openWorkbench();
              wbLog('⚡ 开始进行反代落地部署...', 'text-yellow-400');
              
              if (type === 'joey_var') {
                  const res = await fetch('/api/save_yxip', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ type: 'joey_var', rawContent })
                  });
                  const logs = await res.json();
                  logs.forEach(l => {
                      wbLog(l.msg, l.success ? 'text-green-300' : 'text-red-500');
                  });
                  
                  wbLog('🔄 开始触发变量专属重加载部署...', 'text-yellow-300');
                  try {
                      const varsRes = await fetch('/api/settings?type=joey');
                      const varsList = await varsRes.json();
                      const accIds = targetAccounts.map(a => a.accountId);
                      
                      const deployRes = await fetch('/api/deploy', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              type: 'joey',
                              variables: varsList,
                              deletedVariables: [],
                              targetAccountIds: accIds
                          })
                      });
                      const deployLogs = await deployRes.json();
                      deployLogs.forEach(l => wbLog('[' + (l.success ? '部署OK' : '报错') + '] ' + l.name + ': ' + l.msg, l.success ? 'text-green-300' : 'text-red-400'));
                  } catch (e) {
                      wbLog('⚠️ 下发变量部署失败: ' + e.message, 'text-red-500');
                      showDebugError('下发变量部署失败', e.message, { type: 'joey_var' });
                  }
              } else {
                  for (let i = 0; i < targetAccounts.length; i++) {
                      const acc = targetAccounts[i];
                      wbLog('>> 正在处理账号: ' + acc.alias, 'text-blue-300');
                      const res = await fetch('/api/save_yxip', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                              type,
                              accountId: acc.accountId,
                              email: acc.email,
                              globalKey: acc.globalKey,
                              apiToken: acc.apiToken,
                              rawContent
                          })
                      });
                      const logs = await res.json();
                      logs.forEach(l => {
                          wbLog(l.msg, l.success ? 'text-green-300' : 'text-red-500');
                      });
                  }
              }
              
              wbLog('部署流程结束！', 'text-white font-bold');
              
              if (type === 'joey') {
                  wbLog('⚡ 提示：优选参数已经作为核心配置文件「c」发送到了指定目标账号下的所有 Joey 项目所绑定的 KV 空间。一般下一次访问接口时立即可生效。', 'text-blue-500 font-bold text-xs mt-2');
              } else if (type === 'joey_var') {
                  wbLog('⚡ 提示：优选参数已更新并触发了一次目标对应工作台的重加载执行部署。请留意上方控制台的下发动态。', 'text-blue-500 font-bold text-xs mt-2');
              } else if (type === 'cmliu') {
                  wbLog('⚡ 提示：CMLiu 优选节点列表已成功注入目标空间的「ADD.txt」。一般下一次访问接口时立即可生效。', 'text-blue-500 font-bold text-xs mt-2');
              }

          } catch (e) {
              showDebugError('反代落地部署异常', e.message, { type: type });
          } finally {
              btnIcon.innerHTML = '⚡';
          }
      }

      function applyTheme() {
          const saved = localStorage.getItem('worker_theme');
          if (saved === 'dark') {
              document.documentElement.setAttribute('data-theme', 'dark');
              document.getElementById('theme_btn').innerText = '☀️';
              initStarfield();
          }
      }
      applyTheme();

      init();
    </script>
  </body></html>
    `;
}
