/**
 * Cloudflare Worker 多项目部署管理器 (V10.2.1 - Starfield Theme)
 * 更新日志 (V10.2.1)：
 * 1. [Fix] 修复 coreDeployLogic 中 targetSha='latest' 被当作 git ref 导致自动更新代码下载失败。
 * 2. [Fix] 修复部署后 deploy config 被错误锁定为 fixed 模式，导致后续自动更新永远跳过。
 * 3. [Fix] 修复历史版本 "Always Latest" 部署触发同样的 URL 构造错误。
 *
 * 更新日志 (V10.2.0)：
 * 1. [Feature] 新增暗黑星空模式 / 明亮模式主题切换。
 * 2. [Feature] Canvas 动态星空背景（闪烁星星 + 流星 + 星云光晕）。
 * 3. [Feature] 卡片毛玻璃半透明效果，全组件暗黑模式适配。
 * 4. [Feature] 主题选择通过 localStorage 持久化。
 *
 * 更新日志 (V10.1.0)：
 * 1. [Feature] 管理弹窗新增修改账号 workers.dev 子域名前缀功能。
 * 2. [Feature] 新增 /api/get_subdomain 和 /api/change_subdomain 后端 API。
 * 3. [Improve] 管理弹窗并行加载 Workers 列表和子域名信息，提升加载速度。
 * 4. [UX] 修改子域名带二次确认对话框，防止误操作。
 *
 * 更新日志 (V10.0.0)：
 * 1. [Security] 登录改为 POST，密码不再通过 URL 明文传递；Cookie 增加 Secure 标志。
 * 2. [Security] API 增加 HTTP 方法校验，POST 请求增加 CSRF Origin 检查。
 * 3. [Fix] 修复 serverSideObfuscate 正则误删 URL 的严重 bug。
 * 4. [Fix] 修复前端 checkUpdate catch 变量名冲突导致错误不显示的 bug。
 * 5. [Fix] 修复编辑账号时 stats 被重置的问题。
 * 6. [Improve] 熔断和自动更新改为动态模板识别，不再硬编码。
 * 7. [Improve] 统一错误响应；前后端模板数据由后端注入，消除重复。
 * 8. [Improve] compatibility_date 自动使用当前日期。
 */

// ==========================================
// 1. 后端配置与逻辑
// ==========================================
const TEMPLATES = {
    'cmliu': {
        name: "CMliu - EdgeTunnel",
        ghUser: "cmliu",
        ghRepo: "edgetunnel",
        ghBranch: "beta2.0",
        ghPath: "_worker.js",
        defaultVars: ["UUID", "PROXYIP", "DOH", "PATH", "URL", "KEY", "ADMIN"],
        uuidField: "UUID",
        description: "CMliu (beta2.0) - 建议开启 KV"
    },
    'joey': {
        name: "Joey - 少年你相信光吗",
        ghUser: "byJoey",
        ghRepo: "cfnew",
        ghBranch: "main",
        ghPath: "少年你相信光吗",
        defaultVars: ["u", "d", "p"],
        uuidField: "u",
        description: "Joey (自动修复) - KV 可选"
    },
    'ech': {
        name: "ECH - WebSocket Proxy",
        ghUser: "hc990275",
        ghRepo: "ech-wk",
        ghBranch: "main",
        ghPath: "_worker.js",
        defaultVars: ["PROXYIP"],
        uuidField: "",
        description: "ECH (无需频繁更新)"
    }
};

const ECH_PROXIES = [
    { group: "Global", list: ["ProxyIP.CMLiussss.net", "ProxyIP.Aliyun.CMLiussss.net", "ProxyIP.Oracle.CMLiussss.net"] },
    { group: "HK (香港)", list: ["ProxyIP.HK.CMLiussss.net", "ProxyIP.Aliyun.HK.CMLiussss.net", "ProxyIP.Oracle.HK.CMLiussss.net"] },
    { group: "JP (日本)", list: ["ProxyIP.JP.CMLiussss.net", "ProxyIP.Aliyun.JP.CMLiussss.net", "ProxyIP.Oracle.JP.CMLiussss.net"] },
    { group: "SG (新加坡)", list: ["ProxyIP.SG.CMLiussss.net", "ProxyIP.Aliyun.SG.CMLiussss.net", "ProxyIP.Oracle.SG.CMLiussss.net"] },
    { group: "KR (韩国)", list: ["ProxyIP.KR.CMLiussss.net", "ProxyIP.Oracle.KR.CMLiussss.net"] },
    { group: "US (美国)", list: ["ProxyIP.US.CMLiussss.net", "ProxyIP.Aliyun.US.CMLiussss.net", "ProxyIP.Oracle.US.CMLiussss.net"] },
    { group: "Europe", list: ["ProxyIP.DE.CMLiussss.net (德国)", "ProxyIP.UK.CMLiussss.net (英国)", "ProxyIP.FR.CMLiussss.net (法国)", "ProxyIP.NL.CMLiussss.net (荷兰)", "ProxyIP.RU.CMLiussss.net (俄罗斯)"] },
    { group: "Others", list: ["ProxyIP.TW.CMLiussss.net (台湾)", "ProxyIP.AU.CMLiussss.net (澳洲)", "ProxyIP.IN.CMLiussss.net (印度)"] }
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
                const { type, variables, deletedVariables, targetSha } = await request.json();
                return await handleManualDeploy(env, type, variables, deletedVariables, ACCOUNTS_KEY, targetSha);
            }
            if (url.pathname === "/api/batch_deploy" && request.method === "POST") {
                const data = await request.json();
                return await handleBatchDeploy(env, data, ACCOUNTS_KEY);
            }
            if (url.pathname === "/api/zones" && request.method === "POST") {
                const { accountId, email, globalKey } = await request.json();
                return await handleGetZones(accountId, email, globalKey);
            }
            if (url.pathname === "/api/all_workers" && request.method === "POST") {
                const { accountId, email, globalKey } = await request.json();
                return await handleGetAllWorkers(accountId, email, globalKey);
            }
            if (url.pathname === "/api/delete_worker" && request.method === "POST") {
                const { accountId, email, globalKey, workerName, deleteKv } = await request.json();
                return await handleDeleteWorker(env, accountId, email, globalKey, workerName, deleteKv);
            }
            if (url.pathname === "/api/stats" && request.method === "GET") return await handleStats(env, ACCOUNTS_KEY);
            if (url.pathname === "/api/fetch_bindings" && request.method === "POST") {
                const { accountId, email, globalKey, workerName } = await request.json();
                return await handleFetchBindings(accountId, email, globalKey, workerName);
            }
            if (url.pathname === "/api/get_subdomain" && request.method === "POST") {
                const { accountId, email, globalKey } = await request.json();
                return await handleGetSubdomain(accountId, email, globalKey);
            }
            if (url.pathname === "/api/change_subdomain" && request.method === "POST") {
                const { accountId, email, globalKey, newSubdomain } = await request.json();
                return await handleChangeSubdomain(accountId, email, globalKey, newSubdomain);
            }

            return new Response(mainHtml(), { headers: { "Content-Type": "text/html;charset=UTF-8" } });

        } catch (err) {
            return new Response(JSON.stringify({ success: false, msg: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
        }
    }
};

// ================= 后端辅助函数 =================

function getGithubUrls(type, sha = null) {
    const t = TEMPLATES[type];
    const safePath = t.ghPath.split('/').map(p => encodeURIComponent(p)).join('/');
    const apiUrl = `https://api.github.com/repos/${t.ghUser}/${t.ghRepo}/commits`;
    const ref = sha || t.ghBranch;
    const scriptUrl = `https://raw.githubusercontent.com/${t.ghUser}/${t.ghRepo}/${ref}/${safePath}`;
    return { apiUrl, scriptUrl, branch: t.ghBranch };
}

function getAuthHeaders(email, key) {
    return { "X-Auth-Email": email, "X-Auth-Key": key, "Content-Type": "application/json" };
}

function getUploadHeaders(email, key) {
    return { "X-Auth-Email": email, "X-Auth-Key": key };
}

// [服务器端轻量混淆] 供自动更新/熔断使用，避免依赖 heavy libraries
function serverSideObfuscate(code) {
    // 1. 注入 Window Polyfill
    if (!code.includes('var window = globalThis')) {
        code = 'var window = globalThis;\n' + code;
    }
    // 2. 移除块注释 /* ... */ （安全）
    code = code.replace(/\/\*[\s\S]*?\*\//g, '');
    // 3. 仅移除行首单行注释（避免误删 URL 中的 //）
    code = code.replace(/^\s*\/\/.*$/gm, '');
    // 4. 压缩空白
    code = code.replace(/^\s+|\s+$/gm, '').replace(/\n{2,}/g, '\n');
    return code;
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
    // 读取自动混淆配置
    const autoObfuscate = !!config.obfuscate;

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
                    await rotateUUIDAndDeploy(env, ft, accounts, ACCOUNTS_KEY, autoObfuscate);
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
            checkAndDeployUpdate(env, type, accounts, ACCOUNTS_KEY, autoObfuscate)
        ));
    }

    config.lastCheck = now;
    await env.CONFIG_KV.put(GLOBAL_CONFIG_KEY, JSON.stringify(config));
}

async function checkAndDeployUpdate(env, type, accounts, accountsKey, doObfuscate) {
    try {
        const deployConfig = JSON.parse(await env.CONFIG_KV.get(`DEPLOY_CONFIG_${type}`) || '{"mode":"latest"}');
        if (deployConfig.mode === 'fixed') return;

        const res = await handleCheckUpdate(env, type, 'latest');
        const checkData = await res.json();

        if (checkData.remote && (!checkData.local || checkData.remote.sha !== checkData.local.sha)) {
            const varsStr = await env.CONFIG_KV.get(`VARS_${type}`);
            const variables = varsStr ? JSON.parse(varsStr) : [];
            // 传入 doObfuscate
            await coreDeployLogic(env, type, variables, [], accountsKey, 'latest', doObfuscate);
        }
    } catch (e) { console.error(`[Update Error] ${type}: ${e.message}`); }
}

async function rotateUUIDAndDeploy(env, type, accounts, accountsKey, doObfuscate) {
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
    // 传入 doObfuscate
    await coreDeployLogic(env, type, variables, [], accountsKey, targetSha, doObfuscate);
}

async function handleGetCode(env, type) {
    try {
        const { scriptUrl } = getGithubUrls(type);
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
        const { apiUrl, branch } = getGithubUrls(type);

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
            mode: deployConfig.mode
        }), { headers: { "Content-Type": "application/json" } });

    } catch (e) { return new Response(JSON.stringify({ error: e.message }), { status: 500 }); }
}

async function handleManualDeploy(env, type, variables, deletedVariables, accountsKey, targetSha) {
    // 手动部署时暂不自动应用服务器端混淆，依赖前端传参
    const result = await coreDeployLogic(env, type, variables, deletedVariables, accountsKey, targetSha);
    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
}

async function handleBatchDeploy(env, reqData, accountsKey) {
    const { template, workerName, kvName, config, targetAccounts, disableWorkersDev, customDomainPrefix, enableKV, customCode } = reqData;
    const allAccounts = JSON.parse(await env.CONFIG_KV.get(accountsKey) || "[]");

    const accountsToDeploy = allAccounts.filter(a => targetAccounts.includes(a.alias));
    if (accountsToDeploy.length === 0) return new Response(JSON.stringify([{ name: "错误", success: false, msg: "未选择有效账号" }]), { headers: { "Content-Type": "application/json" } });

    let scriptContent = "";
    if (customCode) {
        scriptContent = customCode;
        if (!scriptContent.includes('var window = globalThis') && !scriptContent.includes('import ')) {
            scriptContent = 'var window = globalThis;\n' + scriptContent;
        }
    } else {
        const { scriptUrl } = getGithubUrls(template);
        try {
            const codeRes = await fetch(scriptUrl);
            if (!codeRes.ok) throw new Error("代码拉取失败");
            scriptContent = await codeRes.text();
            if (template === 'joey') scriptContent = 'var window = globalThis;\n' + scriptContent;
        } catch (e) {
            return new Response(JSON.stringify([{ name: "网络错误", success: false, msg: e.message }]), { headers: { "Content-Type": "application/json" } });
        }
    }

    const logs = [];
    let updatedAccounts = false;

    for (const acc of accountsToDeploy) {
        const log = { name: `${acc.alias} -> [${workerName}]`, success: false, msg: "" };
        try {
            const jsonHeaders = getAuthHeaders(acc.email, acc.globalKey);

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

            const metadata = { main_module: "index.js", bindings: bindings, compatibility_date: new Date().toISOString().split('T')[0] };
            const formData = new FormData();
            formData.append("metadata", JSON.stringify(metadata));
            formData.append("script", new Blob([scriptContent], { type: "application/javascript+module" }), "index.js");

            const uploadHeaders = getUploadHeaders(acc.email, acc.globalKey);
            const deployRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${workerName}`, {
                method: "PUT", headers: uploadHeaders, body: formData
            });

            if (deployRes.ok) {
                log.success = true;
                let msgs = [];
                if (customDomainPrefix && acc.defaultZoneId && acc.defaultZoneName) {
                    const hostname = `${customDomainPrefix}.${acc.defaultZoneName}`;
                    const domainRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/domains`, {
                        method: "PUT", headers: jsonHeaders,
                        body: JSON.stringify({ hostname: hostname, service: workerName, zone_id: acc.defaultZoneId })
                    });
                    if (domainRes.ok) msgs.push(`✅ 绑定: https://${hostname}`);
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
                    msgs.push(`✅ 默认: https://${workerName}.${prefix}.workers.dev`);
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

// 核心部署逻辑 (支持服务器端混淆)
async function coreDeployLogic(env, type, variables, deletedVariables, accountsKey, targetSha, enableServerObfuscate = false) {
    try {
        // 规范化：'latest' 和空值统一视为“跟随最新”
        const isLatestMode = !targetSha || targetSha === 'latest';
        const shaForFetch = isLatestMode ? null : targetSha;

        const accounts = JSON.parse(await env.CONFIG_KV.get(accountsKey) || "[]");
        if (accounts.length === 0) return [{ name: "提示", success: false, msg: "无账号配置" }];

        const { scriptUrl, apiUrl } = getGithubUrls(type, shaForFetch);
        let githubScriptContent = "";
        let deployedSha = shaForFetch;

        try {
            const codeRes = await fetch(scriptUrl + `?t=${Date.now()}`);
            if (!codeRes.ok) throw new Error(`代码下载失败: ${codeRes.status}`);
            githubScriptContent = await codeRes.text();

            if (!deployedSha) {
                const headers = { "User-Agent": "CF-Worker" };
                if (env.GITHUB_TOKEN) headers["Authorization"] = `token ${env.GITHUB_TOKEN}`;
                const apiRes = await fetch(apiUrl + `?sha=${TEMPLATES[type].ghBranch}&per_page=1`, { headers });
                if (apiRes.ok) {
                    const commitData = (await apiRes.json())[0];
                    deployedSha = commitData.sha;
                }
            }
        } catch (e) { return [{ name: "网络错误", success: false, msg: e.message }]; }

        if (type === 'joey') githubScriptContent = 'var window = globalThis;\n' + githubScriptContent;
        if (type === 'ech') {
            const proxyVar = variables ? variables.find(v => v.key === 'PROXYIP') : null;
            const targetIP = proxyVar && proxyVar.value ? proxyVar.value.trim() : 'ProxyIP.CMLiussss.net';
            const regex = /const\s+CF_FALLBACK_IPS\s*=\s*\[.*?\];/s;
            githubScriptContent = githubScriptContent.replace(regex, `const CF_FALLBACK_IPS = ['${targetIP}'];`);
        }

        // [核心] 如果是自动部署/熔断，且启用了混淆，则执行服务器端混淆
        if (enableServerObfuscate) {
            githubScriptContent = serverSideObfuscate(githubScriptContent);
        }

        const logs = [];
        for (const acc of accounts) {
            const targetWorkers = acc[`workers_${type}`] || [];
            for (const wName of targetWorkers) {
                const logItem = { name: `${acc.alias} -> [${wName}]`, success: false, msg: "" };
                try {
                    const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${acc.accountId}/workers/scripts/${wName}`;
                    const jsonHeaders = getAuthHeaders(acc.email, acc.globalKey);

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

                    const metadata = { main_module: "index.js", bindings: currentBindings, compatibility_date: new Date().toISOString().split('T')[0] };
                    const formData = new FormData();
                    formData.append("metadata", JSON.stringify(metadata));
                    formData.append("script", new Blob([githubScriptContent], { type: "application/javascript+module" }), "index.js");

                    const uploadHeaders = getUploadHeaders(acc.email, acc.globalKey);
                    const updateRes = await fetch(baseUrl, { method: "PUT", headers: uploadHeaders, body: formData });

                    if (updateRes.ok) {
                        logItem.success = true;
                        logItem.msg = `✅ Ver: ${deployedSha ? deployedSha.substring(0, 7) : 'Unknown'}${enableServerObfuscate ? ' (Obfuscated)' : ''}`;
                    } else {
                        logItem.msg = `❌ ${(await updateRes.json()).errors?.[0]?.message}`;
                    }
                } catch (err) { logItem.msg = `❌ ${err.message}`; }
                logs.push(logItem);
            }
        }

        if (deployedSha) {
            const DEPLOY_CONFIG_KEY = `DEPLOY_CONFIG_${type}`;
            const mode = isLatestMode ? 'latest' : 'fixed';
            await env.CONFIG_KV.put(DEPLOY_CONFIG_KEY, JSON.stringify({ mode: mode, currentSha: deployedSha, deployTime: new Date().toISOString() }));
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
                method: "POST", headers: getAuthHeaders(acc.email, acc.globalKey),
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

async function handleFetchBindings(accountId, email, key, workerName) {
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${workerName}/bindings`, {
            headers: getAuthHeaders(email, key)
        });
        const data = await res.json();
        const bindings = data.result
            .filter(b => b.type === "plain_text" || b.type === "secret_text")
            .map(b => ({ key: b.name, value: b.type === "plain_text" ? b.text : "" }));
        return new Response(JSON.stringify({ success: true, data: bindings }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleGetZones(accountId, email, key) {
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones?account.id=${accountId}&per_page=50`, {
            headers: getAuthHeaders(email, key)
        });
        const data = await res.json();
        const zones = data.result.map(z => ({ id: z.id, name: z.name }));
        return new Response(JSON.stringify({ success: true, zones: zones }), { headers: { "Content-Type": "application/json" } });
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleGetAllWorkers(accountId, email, key) {
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`, {
            headers: getAuthHeaders(email, key)
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

async function handleDeleteWorker(env, accountId, email, key, workerName, deleteKv) {
    try {
        const headers = getAuthHeaders(email, key);

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

async function handleGetSubdomain(accountId, email, key) {
    try {
        const headers = getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers });
        const data = await res.json();
        if (data.success) {
            return new Response(JSON.stringify({ success: true, subdomain: data.result?.subdomain || '' }), { headers: { "Content-Type": "application/json" } });
        } else {
            return new Response(JSON.stringify({ success: false, msg: data.errors?.[0]?.message || '查询失败' }), { headers: { "Content-Type": "application/json" } });
        }
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
}

async function handleChangeSubdomain(accountId, email, key, newSubdomain) {
    try {
        const headers = getAuthHeaders(email, key);
        const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
            method: 'PUT',
            headers,
            body: JSON.stringify({ subdomain: newSubdomain })
        });
        const data = await res.json();
        if (data.success) {
            return new Response(JSON.stringify({ success: true, subdomain: data.result?.subdomain || newSubdomain }), { headers: { "Content-Type": "application/json" } });
        } else {
            return new Response(JSON.stringify({ success: false, msg: data.errors?.[0]?.message || '修改失败' }), { headers: { "Content-Type": "application/json" } });
        }
    } catch (e) { return new Response(JSON.stringify({ success: false, msg: e.message }), { status: 500 }); }
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
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="manifest" href="/manifest.json">
    <title>Worker 智能中控 (V10.2.1)</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>
    <script src="https://cdn.jsdelivr.net/npm/javascript-obfuscator/dist/index.browser.js"></script>
    <style>
      :root {
        --bg-page: #f1f5f9; --bg-card: #ffffff; --bg-card-alt: #f8fafc; --bg-input: #ffffff;
        --bg-header: #ffffff; --bg-toolbar: #f8fafc;
        --text-primary: #1e293b; --text-secondary: #475569; --text-muted: #94a3b8;
        --border-color: #e2e8f0; --border-light: #f1f5f9;
        --shadow-color: rgba(0,0,0,0.08);
        --table-header-bg: #f8fafc; --table-row-hover: #f8fafc;
      }
      [data-theme="dark"] {
        --bg-page: transparent; --bg-card: rgba(15,23,42,0.75); --bg-card-alt: rgba(30,41,59,0.7); --bg-input: rgba(30,41,59,0.8);
        --bg-header: rgba(15,23,42,0.8); --bg-toolbar: rgba(30,41,59,0.6);
        --text-primary: #e2e8f0; --text-secondary: #cbd5e1; --text-muted: #94a3b8;
        --border-color: rgba(71,85,105,0.5); --border-light: rgba(51,65,85,0.5);
        --shadow-color: rgba(0,0,0,0.3);
        --table-header-bg: rgba(30,41,59,0.8); --table-row-hover: rgba(51,65,85,0.4);
      }
      body { background: var(--bg-page); color: var(--text-primary); transition: background 0.4s, color 0.4s; }
      [data-theme="dark"] body { background: transparent; }
      #starfield { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; background: #0f172a; display: none; }
      [data-theme="dark"] #starfield { display: block; }
      [data-theme="dark"] .bg-white, [data-theme="dark"] .project-card,
      [data-theme="dark"] .bg-slate-100 {
        background: var(--bg-card) !important; backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--border-color) !important;
      }
      [data-theme="dark"] header, [data-theme="dark"] .bg-white.rounded.shadow {
        background: var(--bg-header) !important; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      }
      [data-theme="dark"] .bg-slate-50, [data-theme="dark"] .bg-gray-50 {
        background: var(--bg-card-alt) !important;
      }
      [data-theme="dark"] .text-slate-800, [data-theme="dark"] .text-gray-700,
      [data-theme="dark"] .text-slate-700, [data-theme="dark"] .text-gray-600 {
        color: var(--text-primary) !important;
      }
      [data-theme="dark"] .text-gray-500, [data-theme="dark"] .text-gray-400,
      [data-theme="dark"] .text-gray-300 {
        color: var(--text-muted) !important;
      }
      [data-theme="dark"] .border-slate-200, [data-theme="dark"] .border-gray-100,
      [data-theme="dark"] .border-gray-200 {
        border-color: var(--border-color) !important;
      }
      [data-theme="dark"] .input-field {
        background: var(--bg-input) !important; color: var(--text-primary) !important;
        border-color: var(--border-color) !important;
      }
      [data-theme="dark"] .input-field::placeholder { color: var(--text-muted) !important; }
      [data-theme="dark"] .compact-table th { background: var(--table-header-bg) !important; color: var(--text-muted) !important; }
      [data-theme="dark"] .compact-table td { border-bottom-color: var(--border-light) !important; color: var(--text-secondary) !important; }
      [data-theme="dark"] .compact-table tr:hover { background: var(--table-row-hover) !important; }
      [data-theme="dark"] .bg-red-50    { background: rgba(127,29,29,0.2) !important; }
      [data-theme="dark"] .bg-blue-50   { background: rgba(30,58,138,0.2) !important; }
      [data-theme="dark"] .bg-green-50  { background: rgba(20,83,45,0.2) !important; }
      [data-theme="dark"] .bg-purple-50 { background: rgba(88,28,135,0.15) !important; }
      [data-theme="dark"] .bg-orange-50 { background: rgba(124,45,18,0.2) !important; }
      [data-theme="dark"] .bg-indigo-50 { background: rgba(49,46,129,0.2) !important; }
      [data-theme="dark"] .border-red-100   { border-color: rgba(127,29,29,0.3) !important; }
      [data-theme="dark"] .border-blue-100  { border-color: rgba(30,58,138,0.3) !important; }
      [data-theme="dark"] .border-green-100 { border-color: rgba(20,83,45,0.3) !important; }
      [data-theme="dark"] .border-purple-100 { border-color: rgba(88,28,135,0.3) !important; }
      [data-theme="dark"] .border-orange-100,.border-orange-200 { border-color: rgba(124,45,18,0.3) !important; }
      [data-theme="dark"] .border-indigo-100 { border-color: rgba(49,46,129,0.3) !important; }
      [data-theme="dark"] select, [data-theme="dark"] input[type="number"],
      [data-theme="dark"] input[type="text"], [data-theme="dark"] input[type="password"] {
        background: var(--bg-input) !important; color: var(--text-primary) !important;
        border-color: var(--border-color) !important;
      }
      [data-theme="dark"] .shadow { box-shadow: 0 2px 8px var(--shadow-color) !important; }
      /* Modal dark overrides */
      [data-theme="dark"] #batch_deploy_modal > div > div:first-child,
      [data-theme="dark"] #account_manage_modal > div,
      [data-theme="dark"] #history_modal > div > div,
      [data-theme="dark"] #sync_select_modal > div {
        background: rgba(15,23,42,0.95) !important; backdrop-filter: blur(20px);
        border: 1px solid var(--border-color) !important;
      }
      [data-theme="dark"] #batch_deploy_modal .p-4,
      [data-theme="dark"] #account_manage_modal .p-4 {
        color: var(--text-primary);
      }
      /* Theme toggle button */
      .theme-toggle { cursor: pointer; font-size: 18px; width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--border-color);
        display: flex; align-items: center; justify-content: center; transition: all 0.3s; background: var(--bg-card); }
      .theme-toggle:hover { transform: scale(1.1); box-shadow: 0 0 12px rgba(139,92,246,0.4); }
      /* Original styles */
      .input-field { border: 1px solid #cbd5e1; padding: 0.25rem 0.5rem; width:100%; border-radius: 4px; font-size: 0.8rem; } 
      .input-field:focus { border-color:#3b82f6; outline:none; }
      .toggle-checkbox:checked { right: 0; border-color: #68D391; }
      .toggle-checkbox:checked + .toggle-label { background-color: #68D391; }
      .compact-table th, .compact-table td { padding: 8px; font-size: 13px; border-bottom: 1px solid #f1f5f9; white-space: nowrap; }
      .compact-table th { background-color: #f8fafc; color: #64748b; font-weight: 600; text-align: left; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
      .animate-fade-in { animation: fadeIn 0.3s ease-out; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes twinkle { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
    </style>
  </head>
  <body class="bg-slate-100 p-2 md:p-4 min-h-screen text-slate-700">
    <canvas id="starfield"></canvas>
    <div class="max-w-7xl mx-auto space-y-4">
      
      <header class="bg-white px-4 py-3 md:px-6 md:py-4 rounded shadow flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div class="flex-none">
              <h1 class="text-xl font-bold text-slate-800 flex items-center gap-2">🚀 Worker 部署中控 <span class="text-xs bg-purple-600 text-white px-2 py-0.5 rounded ml-2">V10.2.1</span></h1>
              <div class="text-[10px] text-gray-400 mt-1">安全加固 · 熔断混淆 · 子域名管理 · 星空主题</div>
          </div>
          <div id="logs" class="bg-slate-900 text-green-400 p-2 rounded text-xs font-mono hidden max-h-[80px] lg:max-h-[50px] overflow-y-auto shadow-inner w-full lg:flex-1 lg:mx-4 order-2 lg:order-none"></div>
          
          <div class="flex flex-wrap items-center gap-2 md:gap-3 bg-slate-50 p-2 rounded border border-slate-200 w-full lg:w-auto flex-none text-xs">
               <button onclick="toggleTheme()" class="theme-toggle" id="theme_btn" title="切换主题">🌙</button>
               <div class="w-px h-4 bg-gray-300 mx-0"></div>
               <button onclick="openBatchDeployModal()" class="bg-indigo-600 text-white px-2 py-1 rounded hover:bg-indigo-700 font-bold">✨ 批量部署</button>
               <div class="w-px h-4 bg-gray-300 mx-1"></div>
               
               <div class="flex items-center gap-1">
                  <span>自动:</span>
                  <div class="relative inline-block w-8 align-middle select-none">
                      <input type="checkbox" id="auto_update_toggle" class="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-4 appearance-none cursor-pointer border-gray-300"/>
                      <label for="auto_update_toggle" class="toggle-label block overflow-hidden h-4 rounded-full bg-gray-300 cursor-pointer"></label>
                  </div>
               </div>
               <div class="flex items-center gap-1">
                  <span>自动混淆:</span>
                  <input type="checkbox" id="auto_obfuscate_toggle" class="w-4 h-4 text-purple-600 border-gray-300 rounded"/>
               </div>
               <div class="flex items-center gap-1">
                  <input type="number" id="auto_update_interval" value="30" class="w-8 text-center border rounded py-0.5"><span>分</span>
               </div>
               <div class="flex items-center gap-1">
                  <span class="text-red-600 font-bold">熔断:</span>
                  <input type="number" id="fuse_threshold" value="0" placeholder="0" class="w-8 text-center border border-red-300 bg-red-50 rounded py-0.5 font-bold text-red-600">
               </div>
               <button onclick="saveAutoConfig()" class="bg-slate-700 text-white px-2 py-1 rounded hover:bg-slate-800 font-bold ml-1">保存</button>
          </div>
      </header>
      
      <div id="layout_container" class="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div id="section_accounts" class="lg:col-span-7 space-y-4">
            <div class="bg-white p-4 rounded shadow flex-1">
              <div class="flex justify-between items-center mb-3">
                   <h2 class="font-bold text-gray-700 text-sm">📡 账号列表</h2>
                   <div class="flex gap-2">
                       <button onclick="loadStats()" id="btn_stats" class="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded font-bold hover:bg-indigo-100">🔄 刷新用量</button>
                       <button onclick="resetFormForAdd()" class="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded">➕ 添加账号</button>
                   </div>
              </div>
              
              <div id="account_form" class="hidden bg-slate-50 p-3 mb-3 border rounded text-xs space-y-3">
                 <div class="flex gap-2">
                    <input id="in_alias" placeholder="备注 (Alias)" class="input-field w-1/3">
                    <input id="in_id" placeholder="Account ID" class="input-field w-2/3">
                 </div>
                 <div class="flex gap-2">
                    <input id="in_email" placeholder="Login Email" class="input-field w-1/2">
                    <input id="in_gkey" type="password" placeholder="Global API Key" class="input-field w-1/2">
                 </div>
                 <div class="bg-purple-50 p-2 rounded border border-purple-100 flex gap-2 items-center">
                    <span class="text-purple-700 font-bold w-20">预设域名:</span>
                    <select id="in_zone_select" class="input-field w-full" onchange="updateZoneInfo()">
                        <option value="">(请先填写API信息后点击读取)</option>
                    </select>
                    <input type="hidden" id="in_zone_name">
                    <input type="hidden" id="in_zone_id">
                    <button onclick="fetchZonesForAccount()" class="bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 flex-none w-20">☁️ 读取</button>
                 </div>

                 <div class="grid grid-cols-3 gap-2">
                    <input id="in_workers_cmliu" placeholder="🔴 CMliu Worker (选填)" class="input-field bg-red-50">
                    <input id="in_workers_joey" placeholder="🔵 Joey Worker (选填)" class="input-field bg-blue-50">
                    <input id="in_workers_ech" placeholder="🟢 ECH Worker (选填)" class="input-field bg-green-50">
                 </div>
                 <div class="flex gap-2 pt-2">
                    <button onclick="saveAccount()" id="btn_save_acc" class="flex-1 bg-slate-700 text-white py-1.5 rounded font-bold">💾 保存账号</button>
                    <button onclick="deleteFromEdit()" id="btn_del_edit" class="hidden flex-none bg-red-100 text-red-600 px-3 py-1.5 rounded">🗑️</button>
                    <button onclick="cancelEdit()" class="flex-none bg-gray-200 text-gray-600 px-3 py-1.5 rounded">❌</button>
                 </div>
              </div>
              
              <div id="account_list_container" class="overflow-x-auto min-h-[300px]">
                  <table class="w-full compact-table">
                      <thead>
                          <tr><th>备注</th><th>预设域名</th><th>Worker</th><th>流量</th><th>占比</th><th class="text-right">操作</th></tr>
                      </thead>
                      <tbody id="account_body"></tbody>
                  </table>
              </div>
            </div>
        </div>
  
        <div id="section_projects" class="lg:col-span-5 space-y-4">
            <div class="bg-white rounded shadow border-t-4 border-red-500 project-card">
                <div class="bg-red-50 px-4 py-2 flex justify-between items-center border-b border-red-100">
                    <div class="flex items-center gap-2"><span class="text-sm font-bold text-red-700">🔴 CMliu 配置</span><span id="badge_cmliu" class="text-[9px] px-1.5 py-0.5 rounded text-white bg-gray-400">Loading</span></div>
                    <button onclick="openVersionHistory('cmliu')" class="text-[10px] bg-white border border-red-200 text-red-600 px-2 py-0.5 rounded hover:bg-red-50">📜 历史/收藏</button>
                </div>
                <div class="p-3">
                    <div id="ver_cmliu" class="text-[10px] font-mono text-gray-500 mb-2 border-b border-gray-100 pb-2 space-y-1">Checking...</div>
                    <details class="group bg-slate-50 rounded border mb-2">
                        <summary class="bg-slate-100 px-2 py-1 text-xs font-bold text-gray-600 flex justify-between"><span>📝 变量列表</span><span>▼</span></summary>
                        <div id="vars_cmliu" class="p-2 space-y-1 max-h-[200px] overflow-y-auto"></div>
                    </details>
                    <div class="flex gap-2 mb-2">
                        <button onclick="addVarRow('cmliu')" class="flex-1 bg-dashed border text-gray-400 text-xs py-1 rounded hover:text-gray-600">➕ 变量</button>
                        <button onclick="selectSyncAccount('cmliu')" class="flex-none bg-orange-50 text-orange-600 border border-orange-200 text-xs px-2 py-1 rounded">🔄 同步</button>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="refreshUUID('cmliu')" class="flex-1 bg-gray-100 text-gray-600 text-xs py-1.5 rounded">🎲 刷 UUID</button>
                        <button onclick="deploy('cmliu')" id="btn_deploy_cmliu" class="flex-[2] bg-red-600 text-white text-xs py-1.5 rounded font-bold hover:bg-red-700">🚀 部署更新</button>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded shadow border-t-4 border-blue-500 project-card">
                <div class="bg-blue-50 px-4 py-2 flex justify-between items-center border-b border-blue-100">
                    <div class="flex items-center gap-2"><span class="text-sm font-bold text-blue-700">🔵 Joey 配置</span><span id="badge_joey" class="text-[9px] px-1.5 py-0.5 rounded text-white bg-gray-400">Loading</span></div>
                    <button onclick="openVersionHistory('joey')" class="text-[10px] bg-white border border-blue-200 text-blue-600 px-2 py-0.5 rounded hover:bg-blue-50">📜 历史/收藏</button>
                </div>
                <div class="p-3">
                    <div id="ver_joey" class="text-[10px] font-mono text-gray-500 mb-2 border-b border-gray-100 pb-2 space-y-1">Checking...</div>
                    <details class="group bg-slate-50 rounded border mb-2">
                        <summary class="bg-slate-100 px-2 py-1 text-xs font-bold text-gray-600 flex justify-between"><span>📝 变量列表</span><span>▼</span></summary>
                        <div id="vars_joey" class="p-2 space-y-1 max-h-[200px] overflow-y-auto"></div>
                    </details>
                    <div class="flex gap-2 mb-2">
                        <button onclick="addVarRow('joey')" class="flex-1 bg-dashed border text-gray-400 text-xs py-1 rounded hover:text-gray-600">➕ 变量</button>
                        <button onclick="selectSyncAccount('joey')" class="flex-none bg-orange-50 text-orange-600 border border-orange-200 text-xs px-2 py-1 rounded">🔄 同步</button>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="refreshUUID('joey')" class="flex-1 bg-gray-100 text-gray-600 text-xs py-1.5 rounded">🎲 刷 UUID</button>
                        <button onclick="deploy('joey')" id="btn_deploy_joey" class="flex-[2] bg-blue-600 text-white text-xs py-1.5 rounded font-bold hover:bg-blue-700">🚀 部署更新</button>
                    </div>
                </div>
            </div>

            <div class="bg-white rounded shadow border-t-4 border-green-500 project-card">
                <div class="bg-green-50 px-4 py-2 flex justify-between items-center border-b border-green-100"><span class="text-sm font-bold text-green-700">🟢 ECH 配置</span><span class="text-[9px] px-1.5 py-0.5 rounded text-white bg-green-500">Stable</span></div>
                <div class="p-3">
                    <div class="mb-2 p-2 bg-slate-50 border rounded text-xs"><div id="ech_proxy_selector_container" class="mb-2"></div><div id="vars_ech" class="space-y-1"></div></div>
                    <div class="flex gap-2">
                        <button onclick="selectSyncAccount('ech')" class="flex-1 bg-orange-50 text-orange-600 border border-orange-200 text-xs px-2 py-1 rounded hover:bg-orange-100">🔄 同步</button>
                        <button onclick="deploy('ech')" id="btn_deploy_ech" class="flex-[2] bg-green-600 text-white text-xs py-1.5 rounded hover:bg-green-700 font-bold">🚀 部署 ECH</button>
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>

    <div id="batch_deploy_modal" class="hidden fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
        <div class="bg-white rounded-lg w-[600px] shadow-2xl overflow-hidden animate-fade-in">
            <div class="bg-indigo-600 p-3 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm">✨ 批量部署 (Obfuscator Pro)</h3>
                <button onclick="document.getElementById('batch_deploy_modal').classList.add('hidden')" class="hover:text-gray-200">×</button>
            </div>
            <div class="p-4 text-xs space-y-3">
                <div class="grid grid-cols-2 gap-3">
                    <div><label class="block text-gray-500 mb-1">Worker 名称</label><input id="bd_name" class="input-field font-bold text-indigo-700" placeholder="例如: new-proxy-01"></div>
                    <div><label class="block text-gray-500 mb-1">选择模板</label><select id="bd_template" onchange="toggleBatchInputs()" class="input-field bg-gray-50"><option value="cmliu">🔴 CMliu (EdgeTunnel)</option><option value="joey">🔵 Joey (相信光)</option></select></div>
                </div>
                
                <div class="grid grid-cols-2 gap-3 items-end">
                    <div><label class="block text-gray-500 mb-1">KV 空间名称</label><input id="bd_kv_name" class="input-field" placeholder="自动创建/使用同名 KV"></div>
                    <div class="flex flex-col gap-2 pb-1">
                         <div class="flex items-center gap-2">
                            <input type="checkbox" id="bd_enable_kv" class="w-4 h-4 text-indigo-600 border-gray-300 rounded" checked>
                            <label for="bd_enable_kv" class="font-bold text-gray-700">绑定 KV 存储</label>
                         </div>
                         <div class="flex items-center gap-2">
                            <input type="checkbox" id="bd_obfuscate" class="w-4 h-4 text-red-600 border-gray-300 rounded" onchange="toggleObfuscatePanel()">
                            <label for="bd_obfuscate" class="font-bold text-red-600">⚡ 启用代码混淆 (前端)</label>
                         </div>
                    </div>
                </div>
                
                <div id="obfuscate_panel" class="hidden bg-gray-800 text-green-400 p-2 rounded text-[10px] font-mono border border-gray-600">
                    <div class="flex justify-between items-center mb-1">
                        <span>自定义混淆代码 (留空则自动拉取并混淆):</span>
                        <button onclick="document.getElementById('bd_custom_code').value=''" class="text-gray-400 hover:text-white">清空</button>
                    </div>
                    <textarea id="bd_custom_code" class="w-full h-24 bg-gray-900 border-0 p-1 text-xs focus:ring-0" placeholder="// 在此粘贴 obfuscator.io 的结果，或者保持空白由系统自动混淆..."></textarea>
                </div>

                <div class="bg-slate-50 p-2 rounded border">
                    <div class="flex items-center gap-2 mb-2">
                         <input type="checkbox" id="bd_disable_workers_dev" class="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500">
                         <label for="bd_disable_workers_dev" class="font-bold text-gray-700">🚫 禁用默认 *.workers.dev 域名</label>
                    </div>
                    <div class="border-t pt-2">
                        <label class="block text-purple-700 font-bold mb-1">🌐 自定义域名 (自动绑定)</label>
                        <div class="flex gap-1 items-center">
                            <input id="bd_domain_prefix" class="input-field w-1/3" placeholder="仅输入前缀">
                            <span class="text-gray-400">.</span>
                            <span class="text-gray-500 text-xs italic">[使用账号预设域名]</span>
                        </div>
                    </div>
                </div>

                <div id="bd_config_cmliu" class="bg-red-50 p-2 rounded border border-red-100">
                    <label class="block text-red-700 font-bold mb-1">设置 ADMIN 密码</label>
                    <input id="bd_admin_pass" class="input-field bg-white" placeholder="登录后台的密码">
                </div>
                <div id="bd_config_joey" class="hidden bg-blue-50 p-2 rounded border border-blue-100">
                    <label class="block text-blue-700 font-bold mb-1">设置用户 UUID (u)</label>
                    <div class="flex gap-2">
                        <input id="bd_uuid" class="input-field bg-white font-mono" placeholder="UUID">
                        <button onclick="document.getElementById('bd_uuid').value = crypto.randomUUID()" class="bg-blue-600 text-white px-2 rounded">🎲</button>
                    </div>
                </div>
                <div>
                    <label class="block text-gray-500 mb-1">选择目标账号</label>
                    <div id="bd_account_list" class="max-h-[100px] overflow-y-auto border rounded p-2 bg-gray-50 grid grid-cols-2 gap-2"></div>
                </div>
                <div class="pt-2 border-t flex justify-end gap-2">
                    <button onclick="document.getElementById('batch_deploy_modal').classList.add('hidden')" class="px-3 py-1.5 bg-gray-100 text-gray-600 rounded">取消</button>
                    <button onclick="doBatchDeploy()" id="btn_do_batch" class="px-3 py-1.5 bg-indigo-600 text-white rounded font-bold hover:bg-indigo-700">🚀 开始部署</button>
                </div>
            </div>
        </div>
    </div>

    <div id="account_manage_modal" class="hidden fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
        <div class="bg-white rounded-lg w-[650px] shadow-2xl max-h-[85vh] flex flex-col">
            <div class="bg-slate-700 p-3 flex justify-between items-center text-white">
                <h3 class="font-bold text-sm" id="manage_modal_title">📂 账号管理</h3>
                <button onclick="document.getElementById('account_manage_modal').classList.add('hidden')" class="hover:text-gray-200">×</button>
            </div>
            <div class="p-2 border-b bg-gray-50 text-[10px] text-gray-500 space-y-1">
                <div>⚠️ 警告：删除逻辑为 [解绑 Worker -> 删除 Worker -> 删除 KV]。</div>
                <div class="flex items-center gap-2 bg-indigo-50 p-1.5 rounded border border-indigo-100">
                    <span class="text-indigo-700 font-bold flex-none">🌐 子域名:</span>
                    <span id="manage_subdomain_display" class="font-mono text-indigo-600 text-[11px]">加载中...</span>
                    <span class="text-gray-400">.workers.dev</span>
                    <button onclick="promptChangeSubdomain()" class="ml-auto flex-none bg-indigo-600 text-white px-2 py-0.5 rounded hover:bg-indigo-700 font-bold">✏️ 修改</button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                <div id="manage_loading" class="text-center py-4 text-gray-400">正在加载 Workers 列表...</div>
                <table class="w-full compact-table hidden" id="manage_table">
                    <thead><tr><th>Worker 名称</th><th>创建时间</th><th>修改时间</th><th class="text-right">操作</th></tr></thead>
                    <tbody id="manage_list_body"></tbody>
                </table>
            </div>
        </div>
    </div>

    <div id="history_modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div class="bg-white rounded-lg w-[450px] shadow-xl max-h-[85vh] flex flex-col overflow-hidden">
            <div class="p-3 border-b bg-gray-50 flex justify-between items-center">
                <h3 class="text-sm font-bold text-gray-700">📜 版本管理</h3>
                <div class="flex gap-2">
                    <button onclick="openFavoritesPanel()" class="text-xs bg-orange-100 text-orange-600 px-2 py-1 rounded font-bold border border-orange-200 hover:bg-orange-200">⭐ 查看收藏</button>
                    <button onclick="document.getElementById('history_modal').classList.add('hidden')" class="text-gray-400 hover:text-gray-600 text-lg">×</button>
                </div>
            </div>
            
            <div id="fav_panel_view" class="hidden flex-col h-full bg-orange-50">
                <div class="p-2 border-b border-orange-200 flex justify-between items-center">
                    <span class="text-xs font-bold text-orange-800">⭐ 我的收藏版本</span>
                    <button onclick="closeFavoritesPanel()" class="text-[10px] bg-white border px-2 py-0.5 rounded">返回历史</button>
                </div>
                <div id="fav_full_list" class="flex-1 overflow-y-auto p-2 space-y-1"></div>
            </div>

            <div id="history_panel_view" class="flex flex-col h-full">
                <div class="bg-gray-50 p-2 border-b flex justify-between items-center text-xs">
                    <span>显示条数:</span>
                    <input type="number" id="history_limit_input" value="10" class="w-12 text-center border rounded" onchange="refreshHistory()">
                </div>
                <div class="flex-1 overflow-y-auto bg-slate-50 p-2 space-y-3">
                    <div>
                        <div class="flex justify-between items-end px-1 mb-1">
                            <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">🕒 最近提交</div>
                        </div>
                        <div id="history_list" class="space-y-1 min-h-[100px]"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <div id="sync_select_modal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div class="bg-white rounded-lg p-4 w-80 shadow-xl max-h-[80vh] flex flex-col">
            <h3 class="text-sm font-bold mb-3 text-gray-700">📥 选择同步源</h3>
            <div id="sync_list" class="space-y-1 overflow-y-auto flex-1 mb-3"></div>
            <button onclick="document.getElementById('sync_select_modal').classList.add('hidden')" class="w-full bg-gray-200 text-gray-600 text-xs py-1.5 rounded">取消</button>
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
  
      async function init() {
          renderProxySelector();
          await loadAccounts();
          await Promise.all(['cmliu','joey','ech'].map(t => loadVars(t)));
          await loadGlobalConfig();
          loadStats();
          ['cmliu','joey'].forEach(t => { checkDeployConfig(t); checkUpdate(t); });
      }

      async function fetchZonesForAccount() {
          const email = document.getElementById('in_email').value;
          const key = document.getElementById('in_gkey').value;
          const id = document.getElementById('in_id').value;
          const select = document.getElementById('in_zone_select');

          if (!email || !key) return Swal.fire('提示', '请先填写 Email, API Key', 'warning');

          select.innerHTML = '<option>Loading...</option>';
          try {
              const res = await fetch('/api/zones', {
                  method: 'POST',
                  body: JSON.stringify({ accountId: id, email: email, globalKey: key })
              });
              const d = await res.json();
              if (d.success) {
                  select.innerHTML = '<option value="">-- 请选择预设域名 --</option>' + 
                      d.zones.map(z => \`<option value="\${z.id}" data-name="\${z.name}">\${z.name}</option>\`).join('');
              } else {
                  select.innerHTML = '<option>读取失败</option>';
                  Swal.fire('错误', d.msg, 'error');
              }
          } catch(e) { select.innerHTML = '<option>网络错误</option>'; }
      }

      function updateZoneInfo() {
          const sel = document.getElementById('in_zone_select');
          if(sel.selectedIndex > 0) {
              document.getElementById('in_zone_id').value = sel.value;
              document.getElementById('in_zone_name').value = sel.options[sel.selectedIndex].dataset.name;
          }
      }

      // 批量部署逻辑（核心：包含混淆与 RuntimeFix）
      async function doBatchDeploy() {
          const btn = document.getElementById('btn_do_batch');
          const t = document.getElementById('bd_template').value;
          const name = document.getElementById('bd_name').value;
          const kvName = document.getElementById('bd_kv_name').value;
          const enableKV = document.getElementById('bd_enable_kv').checked;
          const enableObfuscate = document.getElementById('bd_obfuscate').checked;
          let customCode = document.getElementById('bd_custom_code').value;

          if (!name) return Swal.fire('提示', 'Worker名称必填', 'warning');
          if (enableKV && !kvName) return Swal.fire('提示', '开启 KV 绑定时必须填写 KV 名称', 'warning');
          
          btn.disabled = true;
          btn.innerText = "⏳ 准备中...";
          const logBox = document.getElementById('logs');
          logBox.classList.remove('hidden');
          
          try {
             if (enableObfuscate && !customCode.trim()) {
                 logBox.innerHTML = '<div class="text-yellow-300">⚡ 1. Fetching Code...</div>';
                 const r = await fetch(\`/api/get_code?type=\${t}\`);
                 const d = await r.json();
                 if(!d.success) throw new Error(d.msg);
                 
                 let sourceCode = d.code;
                 
                 // [智能注入 window polyfill]
                 if (sourceCode.includes('import ') || sourceCode.includes('export ')) {
                     logBox.innerHTML += '<div class="text-blue-300">💉 2. Injecting Polyfill (Module Mode)...</div>';
                     const lines = sourceCode.split('\\n');
                     let lastImportIndex = -1;
                     lines.forEach((line, index) => {
                         if (line.trim().startsWith('import ')) lastImportIndex = index;
                     });
                     if (lastImportIndex !== -1) {
                         lines.splice(lastImportIndex + 1, 0, 'var window = globalThis;');
                         sourceCode = lines.join('\\n');
                     } else {
                         sourceCode = 'var window = globalThis;\\n' + sourceCode;
                     }
                 } else {
                     sourceCode = 'var window = globalThis;\\n' + sourceCode;
                 }

                 logBox.innerHTML += '<div class="text-purple-300">🔒 3. Obfuscating (High Compatibility)...</div>';
                 
                 // [V9.9.5 修复] 禁用控制台拦截，确保兼容 Worker 环境
                 const obfuscationResult = JavaScriptObfuscator.obfuscate(sourceCode, {
                    target: 'service-worker', 
                    compact: true,
                    controlFlowFlattening: true,
                    controlFlowFlatteningThreshold: 0.75,
                    deadCodeInjection: true,
                    deadCodeInjectionThreshold: 0.4,
                    debugProtection: false,   
                    disableConsoleOutput: false, 
                    identifierNamesGenerator: 'hexadecimal',
                    log: false,
                    renameGlobals: false,
                    rotateStringArray: true,
                    selfDefending: false,     
                    stringArray: true,
                    stringArrayEncoding: ['base64', 'rc4'],
                    stringArrayThreshold: 0.75,
                    unicodeEscapeSequence: false
                });
                customCode = obfuscationResult.getObfuscatedCode();
                logBox.innerHTML += '<div class="text-green-300">✅ Obfuscation Complete!</div>';
             }

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
                      customCode: customCode 
                  })
              });
              const logs = await res.json();
              logBox.innerHTML = logs.map(l => {
                  if (l.success && l.msg.startsWith('✅')) return \`<div>✅ <span class="text-white">\${l.msg.replace('✅ ', '')}</span></div>\`;
                  return \`<div>[\${l.success ? 'OK' : 'ERR'}] \${l.name}: <span class="text-gray-400">\${l.msg}</span></div>\`;
              }).join('');
              
              document.getElementById('batch_deploy_modal').classList.add('hidden');
              await loadAccounts(); 
              Swal.fire('完成', '操作完成，请查看日志', 'success');

          } catch(e) { 
              Swal.fire('错误', '部署失败: ' + e.message, 'error'); 
              logBox.innerHTML += \`<div class="text-red-500">❌ Error: \${e.message}</div>\`;
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

      function toggleObfuscatePanel() {
          const chk = document.getElementById('bd_obfuscate').checked;
          document.getElementById('obfuscate_panel').classList.toggle('hidden', !chk);
      }

      let currentManageAccIndex = -1;

      async function openAccountManage(i) {
          currentManageAccIndex = i;
          const acc = accounts[i];
          if (!acc.globalKey) return Swal.fire('无法管理', '请先配置 Global API Key', 'error');

          const modal = document.getElementById('account_manage_modal');
          const table = document.getElementById('manage_table');
          const tbody = document.getElementById('manage_list_body');
          const loading = document.getElementById('manage_loading');
          const subDisplay = document.getElementById('manage_subdomain_display');
          
          document.getElementById('manage_modal_title').innerText = \`📂 管理账号: \${acc.alias}\`;
          subDisplay.innerText = '加载中...';
          modal.classList.remove('hidden');
          table.classList.add('hidden');
          loading.classList.remove('hidden');
          tbody.innerHTML = '';

          // 并行加载 Workers 列表和子域名
          try {
              const [workersRes, subRes] = await Promise.all([
                  fetch('/api/all_workers', {
                      method: 'POST',
                      body: JSON.stringify({ accountId: acc.accountId, email: acc.email, globalKey: acc.globalKey })
                  }),
                  fetch('/api/get_subdomain', {
                      method: 'POST',
                      body: JSON.stringify({ accountId: acc.accountId, email: acc.email, globalKey: acc.globalKey })
                  })
              ]);
              
              // 处理子域名
              const subData = await subRes.json();
              if (subData.success && subData.subdomain) {
                  subDisplay.innerText = subData.subdomain;
              } else {
                  subDisplay.innerText = subData.msg || '未设置';
              }

              // 处理 Workers 列表
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
                  table.classList.remove('hidden');
              }
          } catch(e) { loading.innerText = "网络错误"; }
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
              html: \`确定将子域名从 <b>\${currentSub}</b> 改为 <b>\${newSub}</b> 吗？<br><span class="text-xs text-red-500">此操作会影响所有使用 workers.dev 域名的 Worker！</span>\`,
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
                  body: JSON.stringify({ accountId: acc.accountId, email: acc.email, globalKey: acc.globalKey, newSubdomain: newSub })
              });
              const data = await res.json();
              if (data.success) {
                  document.getElementById('manage_subdomain_display').innerText = data.subdomain || newSub;
                  Swal.fire('修改成功', \`子域名已更新为: \${data.subdomain || newSub}.workers.dev\`, 'success');
              } else {
                  Swal.fire('修改失败', data.msg || '未知错误', 'error');
              }
          } catch(e) {
              Swal.fire('错误', '网络错误: ' + e.message, 'error');
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
                          workerName: workerId,
                          deleteKv: deleteKv 
                      })
                  }).then(response => response.json()).then(data => {
                      if (!data.success) throw new Error(data.msg);
                      return data;
                  }).catch(error => Swal.showValidationMessage(\`删除失败: \${error}\`));
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
          if (accounts.length === 0) { tb.innerHTML = '<tr><td colspan="6" class="text-center text-gray-300 py-4">无数据</td></tr>'; return; }
          const sortedAccounts = [...accounts].sort((a, b) => b.stats.total - a.stats.total);
          tb.innerHTML = sortedAccounts.map((a) => {
              const originalIndex = accounts.findIndex(acc => acc.alias === a.alias);
              const count = (a.workers_cmliu||[]).length + (a.workers_joey||[]).length + (a.workers_ech||[]).length;
              const percent = ((a.stats.total / a.stats.max) * 100).toFixed(1);
              let barColor = 'bg-green-500'; if (percent > 80) barColor = 'bg-orange-500'; if (percent >= 100) barColor = 'bg-red-600';
              const zoneBadge = a.defaultZoneName ? \`<span class="bg-purple-100 text-purple-600 text-[10px] px-1 rounded">\${a.defaultZoneName}</span>\` : '<span class="text-gray-300">-</span>';
              return \`<tr class="hover:bg-gray-50 border-b">
                  <td class="font-medium">\${a.alias}</td>
                  <td>\${zoneBadge}</td>
                  <td><span class="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">\${count} 个</span></td>
                  <td>\${a.stats.total}</td>
                  <td><div class="flex items-center gap-2"><div class="w-12 bg-gray-200 rounded-full h-1.5 overflow-hidden"><div class="\${barColor} h-1.5" style="width: \${Math.min(percent, 100)}%"></div></div><span class="text-[10px]">\${percent}%</span></div></td>
                  <td class="text-right">
                      <button onclick="openAccountManage(\${originalIndex})" class="text-purple-600 mr-2 text-xs font-bold hover:bg-purple-50 px-1 rounded">📂 管理</button>
                      <button onclick="editAccount(\${originalIndex})" class="text-blue-500 mr-2 text-xs">✎</button>
                      <button onclick="delAccount(\${originalIndex})" class="text-red-500 text-xs">×</button>
                  </td>
              </tr>\`;
          }).join('');
      }

      async function loadAccounts() { try { const r = await fetch('/api/accounts'); accounts = await r.json(); accounts.forEach(a => a.stats = a.stats || {total:0,max:100000}); renderTable(); } catch(e){} }
      
      async function saveAccount() { 
          const o={
              alias:document.getElementById('in_alias').value,
              accountId:document.getElementById('in_id').value,
              email:document.getElementById('in_email').value,
              globalKey:document.getElementById('in_gkey').value,
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
          document.getElementById('in_alias').value=a.alias; 
          document.getElementById('in_id').value=a.accountId; 
          document.getElementById('in_email').value=a.email||""; 
          document.getElementById('in_gkey').value=a.globalKey||""; 
          document.getElementById('in_zone_name').value=a.defaultZoneName||""; 
          document.getElementById('in_zone_id').value=a.defaultZoneId||""; 
          
          const select = document.getElementById('in_zone_select');
          if(a.defaultZoneName) { select.innerHTML = \`<option value="\${a.defaultZoneId}" data-name="\${a.defaultZoneName}" selected>\${a.defaultZoneName}</option>\`; } else { select.innerHTML = '<option value="">(请点击读取)</option>'; }

          ['cmliu','joey','ech'].forEach(t=>document.getElementById('in_workers_'+t).value=(a['workers_'+t]||[]).join(',')); 
          document.getElementById('account_form').classList.remove('hidden'); 
      }

      async function delAccount(i){ if(confirm('删除账号配置？')){ accounts.splice(i,1); await fetch('/api/accounts',{method:'POST',body:JSON.stringify(accounts)}); renderTable(); } }
      function resetFormForAdd(){ editingIndex=-1; document.querySelectorAll('#account_form input').forEach(i=>i.value=''); document.getElementById('in_zone_select').innerHTML='<option value="">(请先填写API信息后点击读取)</option>'; document.getElementById('account_form').classList.remove('hidden'); }
      function cancelEdit(){ document.getElementById('account_form').classList.add('hidden'); }
      async function deleteFromEdit(){ if(editingIndex>=0)delAccount(editingIndex); cancelEdit(); }
      async function loadStats(){ const b=document.getElementById('btn_stats'); b.disabled=true; try{ const r=await fetch('/api/stats'); const d=await r.json(); accounts.forEach(a=>{ const s=d.find(x=>x.alias===a.alias); a.stats=s&&!s.error?s:{total:0,max:100000}; }); renderTable(); }catch(e){} b.disabled=false; }
      
      async function deploy(t, sha='') {
         const btn = document.getElementById(\`btn_deploy_\${t}\`); const ot = btn.innerText; btn.innerText = "⏳ 部署中..."; btn.disabled = true;
         const vars = []; document.querySelectorAll(\`.var-row-\${t}\`).forEach(r => { const k = r.querySelector('.key').value; const v = r.querySelector('.val').value; if(k) vars.push({key: k, value: v}); });
         await fetch(\`/api/settings?type=\${t}\`, {method: 'POST', body: JSON.stringify(vars)});
         const logBox = document.getElementById('logs'); logBox.classList.remove('hidden'); logBox.innerHTML = \`<div class="text-yellow-400">⚡ Deploying \${t}...</div>\`;
         try { const res = await fetch(\`/api/deploy?type=\${t}\`, { method: 'POST', body: JSON.stringify({ type: t, variables: vars, deletedVariables: deletedVars[t], targetSha: sha }) }); const logs = await res.json(); logBox.innerHTML += logs.map(l => \`<div>[\${l.success ? 'OK' : 'ERR'}] \${l.name}: <span class="text-gray-400">\${l.msg}</span></div>\`).join(''); deletedVars[t] = []; setTimeout(() => { checkUpdate(t); checkDeployConfig(t); }, 1000); } catch(e) { logBox.innerHTML += \`<div class="text-red-500">Error: \${e.message}</div>\`; }
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
              body: JSON.stringify({ accountId: a.accountId, email: a.email, globalKey: a.globalKey, workerName: n })
          });
          const d = await r.json();
          if (d.success) {
              const c = document.getElementById(\`vars_\${t}\`);
              c.innerHTML = ''; deletedVars[t] = [];
              d.data.forEach(v => addVarRow(t, v.key, v.value));
              Swal.fire('同步成功', '变量已更新', 'success');
          } else { Swal.fire('同步失败', d.msg, 'error'); }
      }

      function renderProxySelector(){ const c=document.getElementById('ech_proxy_selector_container'); let h='<select id="ech_proxy_select" onchange="applyEchProxy()" class="w-full text-xs border rounded p-1 mb-1"><option value="">-- Select ProxyIP --</option>'; ECH_PROXIES.forEach(g=>{ h+=\`<optgroup label="\${g.group}">\`; g.list.forEach(i=>h+=\`<option value="\${i.split(' ')[0]}">\${i}</option>\`); h+='</optgroup>'; }); c.innerHTML=h+'</select>'; }
      function applyEchProxy(){ const v=document.getElementById('ech_proxy_select').value; if(v)addVarRow('ech','PROXYIP',v); }
      function addVarRow(t,k='',v=''){ const c=document.getElementById(\`vars_\${t}\`); const d=document.createElement('div'); d.className=\`flex gap-1 items-center mb-1 var-row-\${t}\`; let h=''; if(t==='cmliu'&&(k==='PROXYIP'||k==='DOH')){ const options=k==='DOH'?["https://dns.jhb.ovh/joeyblog","https://doh.cmliussss.com/CMLiussss","cloudflare-ech.com"]:ECH_PROXIES.flatMap(g=>g.list); h=\`<select onchange="this.previousElementSibling.value=this.value" class="w-4 border rounded text-[8px] bg-gray-50 cursor-pointer"><option>▼</option>\${options.map(u=>\`<option value="\${u.split(' ')[0]}">\${u}</option>\`).join('')}</select>\`; } d.innerHTML=\`<input class="input-field w-1/3 key font-bold" placeholder="Key" value="\${k}"><input class="input-field w-2/3 val" placeholder="Val" value="\${v}">\${h}<button onclick="removeVarRow(this,'\${t}')" class="text-gray-300 hover:text-red-500 px-1 font-bold">×</button>\`; c.appendChild(d); }
      function removeVarRow(b,t){ const k=b.parentElement.querySelector('.key').value; if(k)deletedVars[t].push(k); b.parentElement.remove(); }
      async function loadVars(t){ const c=document.getElementById(\`vars_\${t}\`); c.innerHTML='<div class="text-center text-gray-300">...</div>'; try{ const r=await fetch(\`/api/settings?type=\${t}\`); const v=await r.json(); const m=new Map(); if(Array.isArray(v))v.forEach(x=>m.set(x.key,x.value)); TEMPLATES[t].defaultVars.forEach(k=>{ if(!m.has(k))m.set(k,k===TEMPLATES[t].uuidField?crypto.randomUUID():'') }); c.innerHTML=''; deletedVars[t]=[]; m.forEach((val,key)=>addVarRow(t,key,val)); }catch(e){ c.innerHTML='Load Error'; } }
      
      // Auto Config 包含混淆开关
      async function loadGlobalConfig(){ try{ const r=await fetch('/api/auto_config'); const c=await r.json(); document.getElementById('auto_update_toggle').checked=!!c.enabled; document.getElementById('auto_obfuscate_toggle').checked=!!c.obfuscate; document.getElementById('auto_update_interval').value=c.interval||30; document.getElementById('fuse_threshold').value=c.fuseThreshold||0; }catch(e){} }
      async function saveAutoConfig(){ await fetch('/api/auto_config',{method:'POST',body:JSON.stringify({enabled:document.getElementById('auto_update_toggle').checked, obfuscate:document.getElementById('auto_obfuscate_toggle').checked, interval:document.getElementById('auto_update_interval').value, fuseThreshold:document.getElementById('fuse_threshold').value})}); alert('已保存配置'); }
      
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

      // 历史记录 & 收藏 (新版逻辑)
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
            
            // 收藏夹渲染逻辑移到 openFavoritesPanel
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
          }catch(e){hList.innerHTML='<div class="text-red-400 text-xs">网络错误: ' + e.message + '</div>';}
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
          // 刷新数据
          const r = await fetch(\`/api/favorites?type=\${type}\`);
          window.currentFavData = await r.json();
          // 如果在收藏面板，重新渲染收藏列表；如果在历史面板，刷新历史
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
          
          // 生成星星
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

          // 流星
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
              // 深空渐变背景
              const grad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 0, canvas.width/2, canvas.height/2, canvas.width*0.7);
              grad.addColorStop(0, '#0f172a');
              grad.addColorStop(0.5, '#0c1222');
              grad.addColorStop(1, '#020617');
              ctx.fillStyle = grad;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              
              // 星云光晕
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

              // 绘制星星
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
              
              // 流星
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
              document.getElementById('theme_btn').innerText = '\ud83c\udf19';
              stopStarfield();
              localStorage.setItem('worker_theme', 'light');
          } else {
              html.setAttribute('data-theme', 'dark');
              document.getElementById('theme_btn').innerText = '\u2600\ufe0f';
              initStarfield();
              localStorage.setItem('worker_theme', 'dark');
          }
      }
      
      function applyTheme() {
          const saved = localStorage.getItem('worker_theme');
          if (saved === 'dark') {
              document.documentElement.setAttribute('data-theme', 'dark');
              document.getElementById('theme_btn').innerText = '\u2600\ufe0f';
              initStarfield();
          }
      }
      applyTheme();

      init();
    </script>
  </body></html>
    `;
}
