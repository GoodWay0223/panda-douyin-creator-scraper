// ==UserScript==
// @name         🐼 熊猫抖音创作者中心数据抓取器
// @namespace    https://www.xjl.asia/
// @version      8.2.0
// @description  抓取抖音创作者中心内容管理作品数据；保留经典界面，兼容新版独立滚动列表，支持语义解析、稳定去重、筛选及 Excel 导出。
// @author       熊猫
// @match        https://creator.douyin.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const APP_ID = 'panda-dy-scraper-v8';
    const VERSION = '8.2.0';
    const MANAGE_PATH = '/creator-micro/content/manage';
    const PAGE_STYLE_ID = APP_ID + '-page-style';
    const MAX_BOTTOM_STALLS = 10;
    const SCROLL_TICK_MS = 1000;

    const existingHost = document.getElementById(APP_ID);
    if (existingHost) {
        existingHost.dispatchEvent(new CustomEvent('panda-dy-open'));
        return;
    }

    const METRIC_ORDER = [
        '播放', '阅读', '浏览', '展现', '点赞', '评论', '分享', '收藏', '弹幕',
        '吸粉量', '封面点击率', '平均播放占比', '完播率', '2秒跳出率',
        '划走率', '文案展开率', '平均浏览图片数'
    ];
    const METRIC_LABELS = new Set(METRIC_ORDER);
    const PRIMARY_LABELS = new Set(['播放', '阅读', '浏览', '展现']);
    const METRIC_KEY = {
        '播放': 'play',
        '阅读': 'play',
        '浏览': 'play',
        '展现': 'play',
        '点赞': 'like',
        '评论': 'comment',
        '分享': 'share',
        '收藏': 'favorite',
        '弹幕': 'danmaku',
        '吸粉量': 'followers'
    };

    const state = {
        items: [],
        byKey: new Map(),
        isRunning: false,
        timer: null,
        scrollEl: null,
        originalScrollTop: 0,
        bottomStalls: 0,
        lastScrollHeight: 0,
        lastItemCount: 0,
        lastVisibleCardCount: 0,
        lastAddedAt: 0,
        expectedCount: null,
        scanScheduled: false,
        renderScheduled: false,
        currentStatus: '正在等待内容管理页面…',
        statusType: 'idle',
        includeEmpty: readSetting('includeEmpty', false),
        useEmoji: readSetting('useEmoji', true),
        showTags: readSetting('showTags', true),
        useWanUnit: readSetting('useWanUnit', false),
        restoreScroll: readSetting('restoreScroll', true),
        observer: null,
        routeTimer: null
    };

    function readSetting(key, fallback) {
        try {
            return typeof GM_getValue === 'function'
                ? GM_getValue(APP_ID + ':' + key, fallback)
                : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function writeSetting(key, value) {
        try {
            if (typeof GM_setValue === 'function') {
                GM_setValue(APP_ID + ':' + key, value);
            }
        } catch (error) {
            console.warn('[熊猫抓取器] 设置保存失败：', error);
        }
    }

    function normalizeText(value) {
        return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function escapeRegExp(value) {
        const special = '\\^$.*+?()[]{}|';
        return String(value).split('').map(function (character) {
            return special.includes(character) ? '\\' + character : character;
        }).join('');
    }

    function parseNumber(value) {
        const source = normalizeText(value).replace(/,/g, '').toLowerCase();
        if (!source || /^-+$/.test(source)) return 0;
        const match = source.match(/-?\d+(?:\.\d+)?/);
        if (!match) return 0;
        let number = Number(match[0]);
        if (!Number.isFinite(number)) return 0;
        if (source.includes('亿')) number *= 100000000;
        else if (source.includes('万') || source.includes('w')) number *= 10000;
        else if (source.includes('千') || source.includes('k')) number *= 1000;
        return Math.round(number);
    }

    function hasNumericValue(value) {
        return /\d/.test(String(value || ''));
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString('zh-CN');
    }

    function formatSummaryNumber(value) {
        const number = Number(value || 0);
        if (!state.useWanUnit || number === 0) return formatNumber(number);
        const wan = number / 10000;
        const digits = Math.abs(wan) < 1 ? 4 : 2;
        return wan.toFixed(digits).replace(/\.?0+$/, '') + '万';
    }

    function hashText(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function isManagePage() {
        return location.pathname.startsWith(MANAGE_PATH);
    }

    const pageStyle = document.createElement('style');
    pageStyle.id = PAGE_STYLE_ID;
    pageStyle.textContent = [
        '.panda-dy-card-mark {',
        '  position: relative !important;',
        '  outline: 2px solid rgba(16, 185, 129, .75) !important;',
        '  outline-offset: 1px !important;',
        '}',
        '.panda-dy-card-mark.panda-dy-card-empty {',
        '  outline-color: rgba(245, 158, 11, .72) !important;',
        '}',
        '.panda-dy-card-badge {',
        '  position: absolute !important;',
        '  top: 2px !important;',
        '  right: 4px !important;',
        '  z-index: 9999 !important;',
        '  display: inline-flex !important;',
        '  align-items: center !important;',
        '  min-width: 28px !important;',
        '  height: 20px !important;',
        '  padding: 0 7px !important;',
        '  border-radius: 999px !important;',
        '  background: #10b981 !important;',
        '  color: #04130d !important;',
        '  box-shadow: 0 2px 8px rgba(0, 0, 0, .25) !important;',
        '  font: 700 12px/20px "Microsoft YaHei", sans-serif !important;',
        '  pointer-events: none !important;',
        '}',
        '.panda-dy-card-empty > .panda-dy-card-badge {',
        '  background: #f59e0b !important;',
        '  color: #1f1300 !important;',
        '}'
    ].join('\n');
    document.head.appendChild(pageStyle);

    const host = document.createElement('div');
    host.id = APP_ID;
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    const css = [
        ':host { all: initial; position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; color-scheme: dark; }',
        '* { box-sizing: border-box; }',
        'button, input { font: inherit; }',
        '.dy-panel {',
        '  position: fixed; top: 20px; right: 20px; width: 420px; height: 90vh; overflow: hidden;',
        '  display: flex; flex-direction: column; pointer-events: auto; color: #f0f0f0;',
        '  background: rgba(18, 18, 18, .98); backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(255,255,255,.15); border-radius: 16px;',
        '  box-shadow: 0 20px 50px rgba(0,0,0,.6);',
        '  font-family: "Segoe UI Emoji", "Microsoft YaHei", sans-serif;',
        '  transition: all .3s cubic-bezier(.25,.8,.25,1);',
        '}',
        '.dy-panel.dragging { transition: none !important; opacity: .95; box-shadow: 0 25px 60px rgba(0,0,0,.8); }',
        '.dy-panel.maximized { top: 2vh !important; left: 50% !important; right: auto !important; width: 900px !important; height: 96vh !important; transform: translateX(-50%); }',
        '.dy-panel.minimized { width: 280px !important; height: 56px !important; min-height: 56px !important; overflow: hidden !important; border-radius: 16px 16px 8px 8px; }',
        '.dy-panel.minimized .dy-body { display: none !important; }',
        '.dy-panel.minimized .dy-header { border-bottom: 0; }',
        '.dy-panel.minimized .dy-title { padding-right: 0; font-size: 14px; }',
        '.dy-panel.minimized .dy-count-badge { display: none; }',
        '.dy-header { position: relative; padding: 16px; cursor: move; user-select: none; border-bottom: 1px solid rgba(255,255,255,.1); background: linear-gradient(to right, #2c3e50, #000); border-radius: 16px 16px 0 0; }',
        '.dy-title { margin: 0; padding-right: 124px; display: flex; flex-direction: column; gap: 4px; pointer-events: none; font-size: 18px; font-weight: 800; }',
        '.dy-count-badge { width: fit-content; padding: 2px 8px; border-radius: 10px; color: #fff; background: #333; font-size: 12px; }',
        '.dy-win-controls { position: absolute; top: 16px; right: 16px; z-index: 2; display: flex; gap: 8px; }',
        '.dy-win-btn { width: 24px; height: 24px; padding: 0; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 50%; cursor: pointer; user-select: none; color: #ccc; background: rgba(255,255,255,.15); font-size: 14px; font-weight: 700; transition: all .2s; }',
        '.dy-win-btn:hover { color: #fff; background: rgba(255,255,255,.4); transform: scale(1.1); }',
        '.dy-win-btn.active { color: #00ff88; background: rgba(0,255,136,.18); }',
        '.dy-win-btn.close:hover { background: #ff4d4d; }',
        '.dy-settings-menu { position: absolute; top: 50px; right: 16px; z-index: 30; width: 252px; padding: 12px; display: none; cursor: default; color: #e5e7eb; background: rgba(24,24,27,.99); border: 1px solid rgba(255,255,255,.16); border-radius: 10px; box-shadow: 0 16px 38px rgba(0,0,0,.55); }',
        '.dy-settings-menu.open { display: block; }',
        '.dy-settings-head { margin-bottom: 8px; color: #fff; font-size: 13px; font-weight: 800; }',
        '.dy-setting-row { padding: 8px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; border-top: 1px solid rgba(255,255,255,.08); }',
        '.dy-setting-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }',
        '.dy-setting-copy strong { color: #f3f4f6; font-size: 12px; font-weight: 700; }',
        '.dy-setting-copy small { color: #8b949e; font-size: 10px; line-height: 1.4; }',
        '.dy-setting-check { width: 16px; height: 16px; flex: 0 0 auto; cursor: pointer; accent-color: #10b981; }',
        '.dy-setting-actions { padding-top: 9px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1px solid rgba(255,255,255,.08); }',
        '.dy-setting-btn { padding: 7px 6px; cursor: pointer; color: #d1d5db; background: #30343b; border: 1px solid #4b5563; border-radius: 6px; font-size: 11px; }',
        '.dy-setting-btn:hover { color: #fff; background: #3f4650; }',
        '.dy-setting-btn.danger:hover { color: #fff; background: #b91c1c; border-color: #ef4444; }',
        '.dy-settings { margin-top: 10px; display: flex; gap: 8px; }',
        '.dy-toggle-label { flex: 1; padding: 6px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer; color: #aaa; background: #333; border: 1px solid #555; border-radius: 6px; font-size: 12px; transition: all .2s; }',
        '.dy-toggle-label.active { color: #00ff88; background: rgba(0,255,136,.15); border-color: #00ff88; font-weight: 700; }',
        '.dy-checkbox { display: none; }',
        '.dy-grid { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }',
        '.dy-panel.maximized .dy-grid { grid-template-columns: repeat(4,1fr); }',
        '.dy-card { padding: 8px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; }',
        '.card-play { border-left: 3px solid #00ff88; background: rgba(0,255,136,.05); }',
        '.card-like { border-left: 3px solid #ff4d4d; background: rgba(255,77,77,.05); }',
        '.card-comment { border-left: 3px solid #3498db; background: rgba(52,152,219,.05); }',
        '.card-share { border-left: 3px solid #ffa502; background: rgba(255,165,2,.05); }',
        '.dy-card-label { margin-bottom: 2px; display: flex; align-items: center; gap: 5px; opacity: .8; font-size: 12px; }',
        '.dy-card-val { font-size: 16px; font-weight: 700; }',
        '.text-play { color: #00ff88; } .text-like { color: #ff4d4d; } .text-comment { color: #3498db; } .text-share { color: #ffa502; }',
        '.dy-body { min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; }',
        '.dy-controls { padding: 15px; flex: 0 0 auto; background: rgba(0,0,0,.3); border-bottom: 1px solid rgba(255,255,255,.1); }',
        '.dy-btn { width: 100%; padding: 10px; border: 0; border-radius: 8px; cursor: pointer; color: #fff; font-size: 14px; font-weight: 600; transition: all .2s; }',
        '.btn-primary { margin-bottom: 10px; background: linear-gradient(90deg,#2563eb,#3b82f6); }',
        '.btn-primary.stop { background: linear-gradient(90deg,#dc2626,#ef4444); animation: pulse 2s infinite; }',
        '.btn-export { margin-bottom: 10px; background: linear-gradient(90deg,#10b981,#059669); }',
        '.dy-search-box { position: relative; margin-bottom: 10px; }',
        '.dy-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); opacity: .5; font-size: 14px; }',
        '.dy-search-input { width: 100%; padding: 8px 10px 8px 32px; outline: 0; color: #fff; background: #222; border: 1px solid #555; border-radius: 6px; font-size: 13px; }',
        '.dy-search-input:focus { border-color: #00ff88; }',
        '.dy-tools-row { display: flex; flex-direction: column; gap: 8px; }',
        '.dy-input-group { display: flex; align-items: center; justify-content: space-between; color: #ccc; font-size: 13px; }',
        '.dy-input { width: 50px; padding: 4px; color: #fff; background: #222; border: 1px solid #555; border-radius: 4px; text-align: center; }',
        '.dy-btn-group { display: flex; gap: 10px; }',
        '.btn-action { flex: 1; padding: 8px; cursor: pointer; color: #ccc; background: #374151; border: 1px solid #444; border-radius: 6px; font-size: 13px; transition: all .2s; }',
        '.btn-action:hover { background: #4b5563; }',
        '.btn-action.active { color: #fff; background: #059669; border-color: #34d399; font-weight: 700; box-shadow: 0 0 10px rgba(16,185,129,.3); }',
        '.dy-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 10px; }',
        '.placeholder { margin-top: 60px; color: #666; text-align: center; line-height: 1.7; }',
        '.dy-item { margin-bottom: 8px; padding: 12px; display: flex; align-items: flex-start; color: #eee; background: rgba(255,255,255,.05); border: 1px solid transparent; border-radius: 8px; }',
        '.dy-item.checked { background: rgba(0,255,136,.08); border-color: rgba(0,255,136,.3); }',
        '.dy-item.empty { opacity: .72; }',
        '.item-selector { width: 35px; flex: 0 0 35px; display: block; cursor: pointer; }',
        '.item-selector input { display: none; }',
        '.item-idx { color: #00ff88; font: 700 15px/1.2 monospace; text-shadow: 0 0 5px rgba(0,255,136,.3); }',
        '.item-info { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; }',
        '.item-title { color: #fff; font-size: 14px; font-weight: 700; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '.item-data-row { display: flex; flex-wrap: wrap; gap: 12px; color: #aaa; font-size: 12px; line-height: 1.5; }',
        '.metric-tag { display: flex; align-items: center; gap: 4px; font-weight: 500; }',
        '.dy-del { margin-left: 10px; padding: 0 5px; cursor: pointer; color: #555; background: transparent; border: 0; font-size: 16px; }',
        '.dy-del:hover { color: #ff4d4d; }',
        '.v8-hidden { display: none !important; }',
        '.launcher { position: fixed; right: 18px; bottom: 18px; display: none; height: 40px; padding: 0 14px; pointer-events: auto; cursor: pointer; color: #d1fae5; background: #064e3b; border: 1px solid rgba(52,211,153,.4); border-radius: 999px; box-shadow: 0 8px 24px rgba(0,0,0,.35); font: 700 13px "Microsoft YaHei",sans-serif; }',
        '.launcher.show { display: block; }',
        '.toast { position: absolute; left: 50%; bottom: 14px; z-index: 20; max-width: 88%; padding: 8px 12px; pointer-events: none; opacity: 0; transform: translateX(-50%) translateY(12px); color: #fff; background: rgba(3,7,18,.94); border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.38); transition: .2s; }',
        '.toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }',
        '@keyframes pulse { 50% { opacity: .8; } }',
        '::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 3px; }'
    ].join('\n');

    const html = [
        '<style>' + css + '</style>',
        '<section class="dy-panel" id="panel" aria-label="熊猫抖音后台抓取器">',
        '  <header class="dy-header" id="dragHandle">',
        '    <div class="dy-win-controls">',
        '      <button class="dy-win-btn" id="btnSettings" title="设置" aria-label="设置" type="button">⚙</button>',
        '      <button class="dy-win-btn" id="btnMin" title="最小化" type="button">−</button>',
        '      <button class="dy-win-btn" id="btnMax" title="最大化/还原" type="button">□</button>',
        '      <button class="dy-win-btn close" id="btnClose" title="关闭" type="button">×</button>',
        '    </div>',
        '    <div class="dy-settings-menu" id="settingsMenu" aria-hidden="true">',
        '      <div class="dy-settings-head">显示与工具</div>',
        '      <label class="dy-setting-row"><span class="dy-setting-copy"><strong>汇总数字显示“万”</strong><small>只影响顶部汇总和完成弹窗</small></span><input class="dy-setting-check" id="useWanUnit" type="checkbox"></label>',
        '      <label class="dy-setting-row"><span class="dy-setting-copy"><strong>结束后回到原位置</strong><small>不改变作品或后台筛选条件</small></span><input class="dy-setting-check" id="restoreScroll" type="checkbox"></label>',
        '      <div class="dy-setting-actions"><button class="dy-setting-btn" id="btnDiag" type="button">复制诊断</button><button class="dy-setting-btn danger" id="btnReset" type="button">清空本次</button></div>',
        '    </div>',
        '    <h3 class="dy-title"><span>🐼 熊猫抖音后台抓取器 V' + VERSION + '</span><span class="dy-count-badge">已抓取: <span id="selectedCount" style="color:#00ff88">0</span></span></h3>',
        '    <div class="dy-settings">',
        '      <label class="dy-toggle-label active" id="lblEmoji"><input id="useEmoji" class="dy-checkbox" type="checkbox"><span>😊 Emoji</span></label>',
        '      <label class="dy-toggle-label active" id="lblTags"><input id="showTags" class="dy-checkbox" type="checkbox"><span>🏷️ 作品序号</span></label>',
        '    </div>',
        '    <div class="dy-grid">',
        '      <div class="dy-card card-play"><div class="dy-card-label" id="lblPlay">▶ 播放/阅读</div><div class="dy-card-val text-play" id="sumPlay">0</div></div>',
        '      <div class="dy-card card-like"><div class="dy-card-label" id="lblLike">❤ 点赞</div><div class="dy-card-val text-like" id="sumLike">0</div></div>',
        '      <div class="dy-card card-comment"><div class="dy-card-label" id="lblComment">💬 评论</div><div class="dy-card-val text-comment" id="sumComment">0</div></div>',
        '      <div class="dy-card card-share"><div class="dy-card-label" id="lblShare">↗ 分享</div><div class="dy-card-val text-share" id="sumShare">0</div></div>',
        '    </div>',
        '  </header>',
        '  <div class="dy-body">',
        '    <div class="dy-controls">',
        '      <button class="dy-btn btn-primary" id="btnRun" type="button">▶ 启动自动抓取</button>',
        '      <button class="dy-btn btn-export" id="btnCopy" type="button">📋 导出数据 (粘贴至Excel)</button>',
        '      <div class="dy-search-box"><span class="dy-search-icon">🔍</span><input class="dy-search-input" id="search" type="search" placeholder="输入关键词搜索标题 (如: 领克)"></div>',
        '      <div class="dy-tools-row">',
        '        <div class="dy-input-group"><span>范围设定:</span><div><input class="dy-input" id="rangeStart" type="number" min="1" value="1"> - <input class="dy-input" id="rangeEnd" type="number" min="1" value="25"></div></div>',
        '        <div class="dy-btn-group"><button class="btn-action" id="btnRange" type="button">✅ 选中范围</button><button class="btn-action active" id="btnAll" type="button">🔁 全选列表</button></div>',
        '      </div>',
        '    </div>',
        '    <div class="dy-list" id="list"><div class="placeholder">点击 <b>“启动自动抓取”</b></div></div>',
        '  </div>',
        '  <div class="v8-hidden">',
        '    <div id="status">正在等待内容管理页面…</div><div id="diag">解析器待命</div>',
        '    <span id="foundCount">0</span><span id="expectedText"></span>',
        '    <input id="includeEmpty" type="checkbox">',
        '    <button id="btnScan" type="button">扫描当前页</button><button id="btnCsv" type="button">CSV</button><button id="btnJson" type="button">JSON</button>',
        '    <button id="btnNone" type="button">全不选</button>',
        '  </div>',
        '  <div class="toast" id="toast"></div>',
        '</section>',
        '<button class="launcher" id="launcher" type="button">🐼 抓取器</button>'
    ].join('\n');
    shadow.innerHTML = html;

    function byId(id) {
        return shadow.getElementById(id);
    }

    const panel = byId('panel');
    const launcher = byId('launcher');
    const listBox = byId('list');
    const statusBox = byId('status');
    const btnRun = byId('btnRun');

    applySavedPanelRect();
    byId('useEmoji').checked = state.useEmoji;
    byId('showTags').checked = state.showTags;
    byId('useWanUnit').checked = state.useWanUnit;
    byId('includeEmpty').checked = state.includeEmpty;
    byId('restoreScroll').checked = state.restoreScroll;
    byId('lblEmoji').classList.toggle('active', state.useEmoji);
    byId('lblTags').classList.toggle('active', state.showTags);

    function setStatus(message, type) {
        state.currentStatus = message;
        state.statusType = type || 'idle';
        statusBox.textContent = message;
        statusBox.className = 'status ' + state.statusType;
    }

    let toastTimer = null;
    function showToast(message) {
        const toast = byId('toast');
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('show');
        }, 2200);
    }

    function getInnerText(element) {
        return normalizeText(element && (element.innerText || element.textContent));
    }

    function getMetricLabelElements(scope) {
        if (!scope) return [];
        const preferred = Array.from(scope.querySelectorAll('[class*="metric-label"]'))
            .filter(function (element) {
                return METRIC_LABELS.has(getInnerText(element));
            });
        if (preferred.length) return preferred;
        return Array.from(scope.querySelectorAll('div, span'))
            .filter(function (element) {
                return element.children.length === 0 && METRIC_LABELS.has(getInnerText(element));
            });
    }

    function findTitleNode(scope) {
        if (!scope) return null;
        const preferred = scope.querySelector([
            '[class*="info-title-text"]',
            '[class*="video-title"]',
            '[class*="content-title"]',
            '[class*="item-title"]'
        ].join(','));
        if (preferred && getInnerText(preferred)) return preferred;

        const candidates = Array.from(scope.querySelectorAll('[class*="title"]'))
            .filter(function (element) {
                const text = getInnerText(element);
                return text.length >= 2
                    && !/^(内容管理|作品|编辑作品|删除作品|设置权限)$/.test(text)
                    && !element.closest('#' + APP_ID);
            })
            .sort(function (left, right) {
                return getInnerText(right).length - getInnerText(left).length;
            });
        return candidates[0] || null;
    }

    function collectCardInfos() {
        const direct = Array.from(document.querySelectorAll('[class*="video-card-info"]'))
            .filter(function (card) {
                return !host.contains(card)
                    && findTitleNode(card)
                    && getMetricLabelElements(card).some(function (label) {
                        return PRIMARY_LABELS.has(getInnerText(label));
                    });
            });
        if (direct.length) return Array.from(new Set(direct));

        const primaryNodes = Array.from(document.querySelectorAll('div, span'))
            .filter(function (element) {
                return !host.contains(element)
                    && element.children.length === 0
                    && PRIMARY_LABELS.has(getInnerText(element));
            });
        const cards = [];
        primaryNodes.forEach(function (label) {
            let current = label.parentElement;
            for (let depth = 0; current && depth < 11; depth += 1, current = current.parentElement) {
                const labels = getMetricLabelElements(current);
                if (labels.length >= 3 && findTitleNode(current)) {
                    cards.push(current);
                    break;
                }
            }
        });
        return Array.from(new Set(cards));
    }

    function findVisualCard(cardInfo) {
        let current = cardInfo;
        let best = cardInfo;
        for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
            const className = typeof current.className === 'string' ? current.className : '';
            if (/video-card/i.test(className)) best = current;
            else if (best !== cardInfo) break;
        }
        return best;
    }

    function readMetricValue(labelElement, label) {
        let sibling = labelElement.nextElementSibling;
        while (sibling) {
            const text = getInnerText(sibling);
            if (text && !METRIC_LABELS.has(text)) return text;
            sibling = sibling.nextElementSibling;
        }
        const parentText = getInnerText(labelElement.parentElement);
        const match = parentText.match(new RegExp('^' + escapeRegExp(label) + '\\s*(.+)$'));
        return match ? normalizeText(match[1]) : '';
    }

    function extractMetrics(cardInfo) {
        const raw = {};
        getMetricLabelElements(cardInfo).forEach(function (element) {
            const label = getInnerText(element);
            const value = readMetricValue(element, label);
            if (label && value && raw[label] == null) raw[label] = value;
        });
        const numeric = {
            play: 0,
            like: 0,
            comment: 0,
            share: 0,
            favorite: 0,
            danmaku: 0,
            followers: 0
        };
        Object.keys(raw).forEach(function (label) {
            const key = METRIC_KEY[label];
            if (key) numeric[key] = parseNumber(raw[label]);
        });
        const primaryLabel = Object.keys(raw).find(function (label) {
            return PRIMARY_LABELS.has(label);
        }) || '播放';
        const hasData = hasNumericValue(raw[primaryLabel]);
        return { raw: raw, numeric: numeric, primaryLabel: primaryLabel, hasData: hasData };
    }

    function extractRecord(cardInfo) {
        const titleNode = findTitleNode(cardInfo);
        const title = getInnerText(titleNode);
        if (!title) return null;

        const visualCard = findVisualCard(cardInfo);
        const cardText = getInnerText(cardInfo);
        const visualText = getInnerText(visualCard);
        const metrics = extractMetrics(cardInfo);
        if (!Object.keys(metrics.raw).length) return null;

        const dateMatch = cardText.match(/\d{4}年\d{1,2}月\d{1,2}日\s+\d{1,2}:\d{2}/);
        const publishedAt = dateMatch ? dateMatch[0] : '';
        const statusMatch = cardText.match(/定时发布中|审核中|未通过|已发布|草稿|仅自己可见|已下架/);
        const status = statusMatch ? statusMatch[0] : '';
        const prefixText = visualText.includes(title) ? visualText.split(title)[0] : '';
        const durationMatches = prefixText.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g);
        const duration = durationMatches && durationMatches.length
            ? durationMatches[durationMatches.length - 1]
            : '';
        const imageCountMatch = visualText.match(/(?:^|\s)(\d+)张(?:\s|$)/);
        let contentType = metrics.primaryLabel === '阅读' ? '文章' : '视频';
        if (imageCountMatch) contentType = '图文';
        else if (!duration && metrics.primaryLabel !== '播放') contentType = '图文/文章';

        const keySource = [normalizeText(title).toLowerCase(), publishedAt, duration].join('|');
        return {
            key: hashText(keySource),
            keySource: keySource,
            title: title,
            publishedAt: publishedAt,
            status: status,
            duration: duration,
            contentType: contentType,
            metricsRaw: metrics.raw,
            numeric: metrics.numeric,
            primaryLabel: metrics.primaryLabel,
            hasData: metrics.hasData,
            cardElement: visualCard
        };
    }

    function valuesChanged(previous, next) {
        if (!previous) return true;
        if (previous.title !== next.title
            || previous.publishedAt !== next.publishedAt
            || previous.status !== next.status
            || previous.hasData !== next.hasData) return true;
        return JSON.stringify(previous.metricsRaw) !== JSON.stringify(next.metricsRaw);
    }

    function markCard(item) {
        const card = item.cardElement;
        if (!card || !card.isConnected) return;
        card.classList.add('panda-dy-card-mark');
        card.classList.toggle('panda-dy-card-empty', !item.hasData);
        let badge = card.querySelector(':scope > .panda-dy-card-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'panda-dy-card-badge';
            card.appendChild(badge);
        }
        badge.textContent = '#' + item.id;
        badge.style.display = state.showTags ? 'inline-flex' : 'none';
    }

    function clearPageMarks() {
        document.querySelectorAll('.panda-dy-card-badge').forEach(function (badge) {
            badge.remove();
        });
        document.querySelectorAll('.panda-dy-card-mark').forEach(function (card) {
            card.classList.remove('panda-dy-card-mark', 'panda-dy-card-empty');
        });
    }

    function scanLoadedCards(options) {
        const opts = options || {};
        if (!isManagePage()) {
            if (!opts.silent) setStatus('请先进入「内容管理 → 作品」页面。', 'warn');
            updateDiagnostics(0);
            return { added: 0, updated: 0, visible: 0 };
        }

        const cards = collectCardInfos();
        let added = 0;
        let updated = 0;

        cards.forEach(function (card) {
            const record = extractRecord(card);
            if (!record) return;
            const existing = state.byKey.get(record.key);
            if (existing) {
                if (valuesChanged(existing, record)) updated += 1;
                const becameValid = !existing.hasData && record.hasData;
                existing.title = record.title;
                existing.publishedAt = record.publishedAt;
                existing.status = record.status;
                existing.duration = record.duration;
                existing.contentType = record.contentType;
                existing.metricsRaw = record.metricsRaw;
                existing.numeric = record.numeric;
                existing.primaryLabel = record.primaryLabel;
                existing.hasData = record.hasData;
                existing.cardElement = record.cardElement;
                if (becameValid) existing.selected = true;
                markCard(existing);
                return;
            }

            const item = Object.assign(record, {
                id: state.items.length + 1,
                selected: record.hasData || state.includeEmpty,
                deleted: false
            });
            state.items.push(item);
            state.byKey.set(item.key, item);
            added += 1;
            markCard(item);
        });

        if (added > 0) state.lastAddedAt = Date.now();
        state.lastVisibleCardCount = cards.length;
        state.expectedCount = detectExpectedCount();
        scheduleRender();
        updateDiagnostics(cards.length);

        if (!opts.silent) {
            if (cards.length === 0) {
                setStatus('没有识别到作品卡片。请确认当前位于「内容管理 → 作品」。', 'error');
            } else {
                setStatus('当前已识别 ' + state.items.length + ' 条，新增 ' + added + ' 条。', added ? 'success' : 'idle');
            }
        }
        return { added: added, updated: updated, visible: cards.length };
    }

    function detectExpectedCount() {
        const buttons = Array.from(document.querySelectorAll('button'));
        for (let index = 0; index < buttons.length; index += 1) {
            const text = getInnerText(buttons[index]);
            const match = text.match(/^作品\s*[（(]\s*(\d+)\s*[）)]$/);
            if (match) return Number(match[1]);
        }
        return null;
    }

    function getScrollTop(element) {
        if (!element) return 0;
        if (element === document.scrollingElement || element === document.documentElement || element === document.body) {
            return window.scrollY || document.documentElement.scrollTop || 0;
        }
        return element.scrollTop || 0;
    }

    function setScrollTop(element, top) {
        if (!element) return;
        if (element === document.scrollingElement || element === document.documentElement || element === document.body) {
            window.scrollTo({ top: top, behavior: 'auto' });
        } else if (typeof element.scrollTo === 'function') {
            element.scrollTo({ top: top, behavior: 'auto' });
        } else {
            element.scrollTop = top;
        }
    }

    function getScrollInfo(element) {
        if (!element) return { top: 0, height: 0, client: 0, max: 0 };
        const isDocument = element === document.scrollingElement
            || element === document.documentElement
            || element === document.body;
        const height = isDocument
            ? Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
            : element.scrollHeight;
        const client = isDocument ? window.innerHeight : element.clientHeight;
        const top = getScrollTop(element);
        return { top: top, height: height, client: client, max: Math.max(0, height - client) };
    }

    function findScrollContainer() {
        const cards = collectCardInfos();
        const candidates = new Set();
        document.querySelectorAll('[class*="list-scroll"]').forEach(function (element) {
            candidates.add(element);
        });
        cards.slice(0, 4).forEach(function (card) {
            let current = card.parentElement;
            for (let depth = 0; current && depth < 12; depth += 1, current = current.parentElement) {
                candidates.add(current);
            }
        });

        let best = null;
        let bestScore = -Infinity;
        candidates.forEach(function (element) {
            if (!element || host.contains(element)) return;
            const style = getComputedStyle(element);
            const cardCount = element.querySelectorAll('[class*="video-card-info"]').length;
            const overflow = /(auto|scroll)/.test(style.overflowY) ? 1 : 0;
            const scrollable = element.scrollHeight > element.clientHeight + 20 ? 1 : 0;
            const className = typeof element.className === 'string' ? element.className : '';
            const listHint = /list-scroll/i.test(className) ? 1 : 0;
            const score = cardCount * 1000 + scrollable * 500 + overflow * 250 + listHint * 800 + Math.min(element.clientHeight, 1000);
            if (cardCount > 0 && score > bestScore) {
                best = element;
                bestScore = score;
            }
        });

        if (best) return best;
        const documentScroller = document.scrollingElement || document.documentElement;
        return documentScroller.scrollHeight > window.innerHeight + 40 ? documentScroller : null;
    }

    function updateDiagnostics(visibleCount) {
        const scrollElement = state.scrollEl && state.scrollEl.isConnected
            ? state.scrollEl
            : findScrollContainer();
        const info = getScrollInfo(scrollElement);
        const className = scrollElement && typeof scrollElement.className === 'string'
            ? scrollElement.className.split(/\s+/)[0]
            : scrollElement ? 'document' : '未找到';
        byId('diag').textContent = [
            '卡片 ' + (visibleCount == null ? state.lastVisibleCardCount : visibleCount),
            '容器 ' + className,
            '位置 ' + Math.round(info.top) + '/' + Math.round(info.max),
            '高度 ' + Math.round(info.height)
        ].join('｜');
    }

    function buildDiagnosticReport() {
        const cards = collectCardInfos();
        const scrollElement = findScrollContainer();
        const info = getScrollInfo(scrollElement);
        const className = scrollElement && typeof scrollElement.className === 'string'
            ? scrollElement.className
            : scrollElement ? 'document' : '';
        return [
            '熊猫抖音抓取器诊断报告',
            'version: ' + VERSION,
            'time: ' + new Date().toISOString(),
            'url: ' + location.href,
            'isManagePage: ' + isManagePage(),
            'recognizedItems: ' + state.items.length,
            'visibleCards: ' + cards.length,
            'legacyMetricSelectorCount: ' + document.querySelectorAll('.metric-value-k4R5P_').length,
            'semanticMetricLabelCount: ' + getMetricLabelElements(document).length,
            'scrollContainerClass: ' + className,
            'scrollTop: ' + Math.round(info.top),
            'scrollMax: ' + Math.round(info.max),
            'scrollHeight: ' + Math.round(info.height),
            'clientHeight: ' + Math.round(info.client),
            'running: ' + state.isRunning,
            'bottomStalls: ' + state.bottomStalls,
            'status: ' + state.currentStatus
        ].join('\n');
    }

    function scheduleScan() {
        if (state.scanScheduled) return;
        state.scanScheduled = true;
        setTimeout(function () {
            state.scanScheduled = false;
            if (isManagePage()) scanLoadedCards({ silent: true });
        }, 120);
    }

    function startRun() {
        if (state.isRunning) {
            stopRun(false, '已暂停抓取，可再次点击继续。');
            return;
        }
        if (!isManagePage()) {
            setStatus('请先进入「内容管理 → 作品」页面。', 'warn');
            return;
        }

        scanLoadedCards({ silent: true });
        state.scrollEl = findScrollContainer();
        if (!state.scrollEl) {
            setStatus('未找到作品列表滚动区域。请复制诊断信息反馈。', 'error');
            updateDiagnostics(0);
            return;
        }

        state.originalScrollTop = getScrollTop(state.scrollEl);
        state.bottomStalls = 0;
        state.lastScrollHeight = 0;
        state.lastItemCount = state.items.length;
        state.isRunning = true;
        btnRun.textContent = '⏹ 正在抓取... 点击停止';
        btnRun.classList.add('stop');
        setStatus('正在从列表顶部开始抓取…', 'running');
        setScrollTop(state.scrollEl, 0);
        clearTimeout(state.timer);
        state.timer = setTimeout(runTick, 350);
    }

    function runTick() {
        if (!state.isRunning) return;
        if (!isManagePage()) {
            stopRun(false, '页面已离开内容管理，抓取已暂停。', 'warn');
            return;
        }
        if (!state.scrollEl || !state.scrollEl.isConnected) {
            state.scrollEl = findScrollContainer();
        }
        if (!state.scrollEl) {
            stopRun(false, '作品列表滚动区域已消失，请刷新页面后重试。', 'error');
            return;
        }

        const result = scanLoadedCards({ silent: true });
        const info = getScrollInfo(state.scrollEl);
        const itemCount = state.items.length;
        const grew = info.height > state.lastScrollHeight + 2 || itemCount > state.lastItemCount;
        const atBottom = info.top >= info.max - 8;

        if (grew || result.added > 0) {
            state.bottomStalls = 0;
        } else if (atBottom) {
            state.bottomStalls += 1;
        } else {
            state.bottomStalls = 0;
        }

        const expected = state.expectedCount ? ' / 页面显示 ' + state.expectedCount : '';
        if (atBottom) {
            btnRun.textContent = '⏳ 补漏中 (' + state.bottomStalls + '/' + MAX_BOTTOM_STALLS + ')...';
            setStatus(
                '已识别 ' + itemCount + expected + '，正在等待下一批… (' + state.bottomStalls + '/' + MAX_BOTTOM_STALLS + ')',
                'running'
            );
            if (state.bottomStalls >= MAX_BOTTOM_STALLS) {
                finishRun();
                return;
            }
            if (state.bottomStalls % 3 === 0 && info.max > 90) {
                setScrollTop(state.scrollEl, Math.max(0, info.max - 90));
                requestAnimationFrame(function () {
                    if (state.isRunning) setScrollTop(state.scrollEl, info.height + 100);
                });
            } else {
                setScrollTop(state.scrollEl, info.height + 100);
            }
        } else {
            btnRun.textContent = '⏹ 正在抓取... 点击停止';
            setStatus('正在抓取：' + itemCount + expected + '，继续向下加载…', 'running');
            const step = Math.max(360, Math.floor(info.client * 0.86));
            setScrollTop(state.scrollEl, Math.min(info.max, info.top + step));
        }

        state.lastScrollHeight = info.height;
        state.lastItemCount = itemCount;
        updateDiagnostics(result.visible);
        state.timer = setTimeout(runTick, SCROLL_TICK_MS);
    }

    function finishRun() {
        scanLoadedCards({ silent: true });
        const total = state.items.length;
        if (total === 0) {
            stopRun(true, '抓取结束，但没有识别到作品。请复制诊断信息反馈。', 'error');
            return;
        }
        stopRun(
            true,
            '抓取完成：识别 ' + total + ' 条，已选 ' + getSelectedItems().length + ' 条。',
            'success'
        );
        showFinalResult();
    }

    function showFinalResult() {
        const selected = getSelectedItems();
        const sums = selected.reduce(function (result, item) {
            result.play += item.numeric.play || 0;
            result.like += item.numeric.like || 0;
            result.comment += item.numeric.comment || 0;
            result.share += item.numeric.share || 0;
            return result;
        }, { play: 0, like: 0, comment: 0, share: 0 });

        alert([
            '🎉 抓取完成！',
            '',
            '📹 有效作品：' + selected.length + ' 个',
            '------------------------------',
            '▶ 播放总量：' + formatSummaryNumber(sums.play),
            '❤️ 点赞总量：' + formatSummaryNumber(sums.like),
            '💬 评论总量：' + formatSummaryNumber(sums.comment),
            '↗ 分享总量：' + formatSummaryNumber(sums.share),
            '------------------------------',
            '点击 [导出数据 (粘贴至Excel)] 保存结果。'
        ].join('\n'));
    }

    function stopRun(completed, message, type) {
        clearTimeout(state.timer);
        state.timer = null;
        state.isRunning = false;
        btnRun.textContent = '▶ 启动自动抓取';
        btnRun.classList.remove('stop');
        if (state.restoreScroll && state.scrollEl && state.scrollEl.isConnected) {
            setScrollTop(state.scrollEl, state.originalScrollTop);
        }
        if (message) setStatus(message, type || (completed ? 'success' : 'idle'));
        updateDiagnostics();
    }

    function getSelectedItems() {
        return state.items.filter(function (item) {
            return item.selected && !item.deleted;
        });
    }

    function scheduleRender() {
        if (state.renderScheduled) return;
        state.renderScheduled = true;
        setTimeout(function () {
            state.renderScheduled = false;
            render();
        }, 80);
    }

    function updateEmojiLabels() {
        byId('lblPlay').textContent = state.useEmoji ? '▶ 播放/阅读' : '播放/阅读';
        byId('lblLike').textContent = state.useEmoji ? '❤ 点赞' : '点赞总量';
        byId('lblComment').textContent = state.useEmoji ? '💬 评论' : '评论总量';
        byId('lblShare').textContent = state.useEmoji ? '↗ 分享' : '分享总量';
    }

    function render() {
        const selected = getSelectedItems();
        const available = state.items.filter(function (item) {
            return !item.deleted;
        });
        const sums = selected.reduce(function (result, item) {
            result.play += item.numeric.play || 0;
            result.like += item.numeric.like || 0;
            result.comment += item.numeric.comment || 0;
            result.share += item.numeric.share || 0;
            return result;
        }, { play: 0, like: 0, comment: 0, share: 0 });

        byId('sumPlay').textContent = formatSummaryNumber(sums.play);
        byId('sumLike').textContent = formatSummaryNumber(sums.like);
        byId('sumComment').textContent = formatSummaryNumber(sums.comment);
        byId('sumShare').textContent = formatSummaryNumber(sums.share);
        byId('foundCount').textContent = String(available.length);
        byId('selectedCount').textContent = String(selected.length);
        byId('expectedText').textContent = state.expectedCount ? '页面计数 ' + state.expectedCount : '';
        updateEmojiLabels();

        const keyword = normalizeText(byId('search').value).toLowerCase();
        const filtered = available.filter(function (item) {
            if (!keyword) return true;
            return [item.title, item.status, item.publishedAt, item.contentType]
                .join(' ')
                .toLowerCase()
                .includes(keyword);
        });

        if (!filtered.length) {
            listBox.innerHTML = available.length
                ? '<div class="placeholder">没有匹配当前搜索条件的作品。</div>'
                : '<div class="placeholder">点击 <b>“启动自动抓取”</b></div>';
            return;
        }

        listBox.innerHTML = filtered.map(function (item) {
            const primaryRaw = item.metricsRaw[item.primaryLabel] || '—';
            const playLabel = state.useEmoji
                ? (item.primaryLabel === '播放' ? '▶' : '👁')
                : item.primaryLabel + ':';
            const likeLabel = state.useEmoji ? '❤' : '点赞:';
            const commentLabel = state.useEmoji ? '💬' : '评论:';
            const shareLabel = state.useEmoji ? '↗' : '分享:';
            return [
                '<article class="dy-item ' + (item.selected ? 'checked ' : '') + (!item.hasData ? 'empty' : '') + '" data-id="' + item.id + '">',
                '  <label class="item-selector"><input class="item-check" type="checkbox" data-id="' + item.id + '" ' + (item.selected ? 'checked' : '') + '><span class="item-idx">' + item.id + '</span></label>',
                '  <div class="item-info">',
                '    <div class="item-title" title="' + escapeHtml(item.title) + '">' + escapeHtml(item.title) + '</div>',
                '    <div class="item-data-row">',
                '      <span class="metric-tag" style="color:#00ff88">' + playLabel + ' ' + escapeHtml(primaryRaw) + '</span>',
                '      <span class="metric-tag" style="color:#ff4d4d">' + likeLabel + ' ' + formatNumber(item.numeric.like) + '</span>',
                '      <span class="metric-tag" style="color:#3498db">' + commentLabel + ' ' + formatNumber(item.numeric.comment) + '</span>',
                '      <span class="metric-tag" style="color:#ffa502">' + shareLabel + ' ' + formatNumber(item.numeric.share) + '</span>',
                '    </div>',
                '  </div>',
                '  <button class="dy-del" data-action="delete" title="从本次列表移除" type="button">✕</button>',
                '</article>'
            ].join('');
        }).join('');
    }

    function getExportColumns(items) {
        const present = new Set();
        items.forEach(function (item) {
            Object.keys(item.metricsRaw).forEach(function (label) {
                present.add(label);
            });
        });
        const ordered = METRIC_ORDER.filter(function (label) {
            return present.has(label);
        });
        Array.from(present).sort().forEach(function (label) {
            if (!ordered.includes(label)) ordered.push(label);
        });
        return ordered;
    }

    function getExportData() {
        const items = getSelectedItems();
        const metricColumns = getExportColumns(items);
        const headers = ['序号', '作品标题', '发布时间', '状态', '内容类型', '时长'].concat(metricColumns);
        const rows = items.map(function (item) {
            return [
                item.id,
                item.title,
                item.publishedAt,
                item.status,
                item.contentType,
                item.duration
            ].concat(metricColumns.map(function (label) {
                const raw = item.metricsRaw[label] || '';
                return METRIC_KEY[label] ? parseNumber(raw) : raw;
            }));
        });
        return { items: items, headers: headers, rows: rows, metricColumns: metricColumns };
    }

    async function copyText(text) {
        if (typeof GM_setClipboard === 'function') {
            GM_setClipboard(text, 'text');
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
    }

    function csvCell(value) {
        const text = String(value == null ? '' : value).replace(/\r?\n/g, ' ');
        return '"' + text.replace(/"/g, '""') + '"';
    }

    function safeTsvCell(value) {
        return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ');
    }

    function filenameStamp() {
        const now = new Date();
        function pad(number) {
            return String(number).padStart(2, '0');
        }
        return [
            now.getFullYear(),
            pad(now.getMonth() + 1),
            pad(now.getDate()),
            '-',
            pad(now.getHours()),
            pad(now.getMinutes()),
            pad(now.getSeconds())
        ].join('');
    }

    function downloadBlob(content, mimeType, extension) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '熊猫抖音作品数据-' + filenameStamp() + '.' + extension;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(function () {
            URL.revokeObjectURL(url);
        }, 1500);
    }

    function selectItems(predicate) {
        state.items.forEach(function (item) {
            item.selected = Boolean(predicate(item));
        });
        scheduleRender();
    }

    byId('btnRun').addEventListener('click', startRun);
    byId('btnScan').addEventListener('click', function () {
        scanLoadedCards();
    });
    byId('search').addEventListener('input', scheduleRender);
    listBox.addEventListener('change', function (event) {
        const checkbox = event.target.closest('.item-check');
        if (!checkbox) return;
        const item = state.items.find(function (candidate) {
            return candidate.id === Number(checkbox.dataset.id);
        });
        if (!item) return;
        item.selected = checkbox.checked;
        scheduleRender();
    });
    listBox.addEventListener('click', function (event) {
        const row = event.target.closest('.dy-item');
        if (!row) return;
        const item = state.items.find(function (candidate) {
            return candidate.id === Number(row.dataset.id);
        });
        if (!item) return;
        if (event.target.closest('.dy-del')) {
            item.deleted = true;
            item.selected = false;
            scheduleRender();
            return;
        }
        if (event.target.closest('.item-selector')) return;
        item.selected = !item.selected;
        scheduleRender();
    });

    byId('useEmoji').addEventListener('change', function (event) {
        state.useEmoji = event.target.checked;
        writeSetting('useEmoji', state.useEmoji);
        byId('lblEmoji').classList.toggle('active', state.useEmoji);
        scheduleRender();
    });
    byId('showTags').addEventListener('change', function (event) {
        state.showTags = event.target.checked;
        writeSetting('showTags', state.showTags);
        byId('lblTags').classList.toggle('active', state.showTags);
        document.querySelectorAll('.panda-dy-card-badge').forEach(function (badge) {
            badge.style.display = state.showTags ? 'inline-flex' : 'none';
        });
    });
    byId('useWanUnit').addEventListener('change', function (event) {
        state.useWanUnit = event.target.checked;
        writeSetting('useWanUnit', state.useWanUnit);
        scheduleRender();
    });
    byId('includeEmpty').addEventListener('change', function (event) {
        state.includeEmpty = event.target.checked;
        writeSetting('includeEmpty', state.includeEmpty);
        state.items.forEach(function (item) {
            if (!item.hasData) item.selected = state.includeEmpty;
        });
        scheduleRender();
    });
    byId('restoreScroll').addEventListener('change', function (event) {
        state.restoreScroll = event.target.checked;
        writeSetting('restoreScroll', state.restoreScroll);
    });

    byId('btnAll').addEventListener('click', function () {
        byId('btnAll').classList.add('active');
        byId('btnRange').classList.remove('active');
        selectItems(function (item) {
            return !item.deleted && (item.hasData || state.includeEmpty);
        });
    });
    byId('btnNone').addEventListener('click', function () {
        selectItems(function () {
            return false;
        });
    });
    byId('btnRange').addEventListener('click', function () {
        byId('btnRange').classList.add('active');
        byId('btnAll').classList.remove('active');
        const start = Math.max(1, Number(byId('rangeStart').value) || 1);
        const end = Math.max(start, Number(byId('rangeEnd').value) || start);
        byId('rangeStart').value = String(start);
        byId('rangeEnd').value = String(end);
        selectItems(function (item) {
            return !item.deleted && item.id >= start && item.id <= end;
        });
    });

    byId('btnCopy').addEventListener('click', async function () {
        const data = getExportData();
        if (!data.items.length) {
            showToast('没有已选中的作品');
            return;
        }
        const tsv = [data.headers].concat(data.rows)
            .map(function (row) {
                return row.map(safeTsvCell).join('\t');
            })
            .join('\n');
        try {
            await copyText(tsv);
            showToast('已复制 ' + data.items.length + ' 条，可直接粘贴到 Excel');
        } catch (error) {
            console.error('[熊猫抓取器] 复制失败：', error);
            showToast('复制失败，请改用 CSV 导出');
        }
    });

    byId('btnCsv').addEventListener('click', function () {
        const data = getExportData();
        if (!data.items.length) {
            showToast('没有已选中的作品');
            return;
        }
        const csv = '\ufeff' + [data.headers].concat(data.rows)
            .map(function (row) {
                return row.map(csvCell).join(',');
            })
            .join('\r\n');
        downloadBlob(csv, 'text/csv;charset=utf-8', 'csv');
        showToast('已导出 CSV：' + data.items.length + ' 条');
    });

    byId('btnJson').addEventListener('click', function () {
        const data = getExportData();
        if (!data.items.length) {
            showToast('没有已选中的作品');
            return;
        }
        const payload = {
            schema: 'panda-douyin-creator-scraper/v1',
            scraperVersion: VERSION,
            exportedAt: new Date().toISOString(),
            sourceUrl: location.href,
            count: data.items.length,
            items: data.items.map(function (item) {
                return {
                    index: item.id,
                    title: item.title,
                    publishedAt: item.publishedAt,
                    status: item.status,
                    contentType: item.contentType,
                    duration: item.duration,
                    primaryMetric: item.primaryLabel,
                    metrics: item.metricsRaw,
                    metricsNumeric: item.numeric
                };
            })
        };
        downloadBlob('\ufeff' + JSON.stringify(payload, null, 2), 'application/json;charset=utf-8', 'json');
        showToast('已导出 JSON：' + data.items.length + ' 条');
    });

    byId('btnDiag').addEventListener('click', async function () {
        try {
            await copyText(buildDiagnosticReport());
            showToast('诊断信息已复制（不含作品标题）');
        } catch (error) {
            showToast('诊断信息复制失败');
        }
    });

    byId('btnReset').addEventListener('click', function () {
        if (!confirm('只清空抓取器本次识别的数据和页面标记，不会删除抖音作品。确定继续吗？')) return;
        stopRun(false, '本次抓取数据已清空。', 'idle');
        state.items = [];
        state.byKey.clear();
        state.expectedCount = detectExpectedCount();
        clearPageMarks();
        scheduleRender();
    });

    const settingsMenu = byId('settingsMenu');
    function setSettingsOpen(open) {
        settingsMenu.classList.toggle('open', open);
        settingsMenu.setAttribute('aria-hidden', open ? 'false' : 'true');
        byId('btnSettings').classList.toggle('active', open);
    }
    byId('btnSettings').addEventListener('click', function (event) {
        event.stopPropagation();
        setSettingsOpen(!settingsMenu.classList.contains('open'));
    });
    settingsMenu.addEventListener('click', function (event) {
        event.stopPropagation();
    });
    shadow.addEventListener('click', function () {
        setSettingsOpen(false);
    });

    byId('btnClose').addEventListener('click', function () {
        setSettingsOpen(false);
        hidePanel();
    });
    byId('btnMin').addEventListener('click', function () {
        setSettingsOpen(false);
        panel.classList.toggle('minimized');
        byId('btnMin').textContent = panel.classList.contains('minimized') ? '+' : '−';
    });
    let beforeMaxRect = null;
    byId('btnMax').addEventListener('click', function () {
        setSettingsOpen(false);
        if (!panel.classList.contains('maximized')) {
            beforeMaxRect = panel.getBoundingClientRect();
            panel.classList.remove('minimized');
            byId('btnMin').textContent = '−';
            panel.classList.add('maximized');
        } else {
            panel.classList.remove('maximized');
            if (beforeMaxRect) {
                setPanelRect(beforeMaxRect.left, beforeMaxRect.top, beforeMaxRect.width, beforeMaxRect.height);
            }
        }
    });
    launcher.addEventListener('click', showPanel);
    host.addEventListener('panda-dy-open', showPanel);

    function hidePanel() {
        panel.style.display = 'none';
        launcher.classList.add('show');
    }

    function showPanel() {
        panel.style.display = 'flex';
        launcher.classList.remove('show');
    }

    function setPanelRect(left, top, width, height) {
        const maxLeft = Math.max(0, window.innerWidth - Math.min(width, window.innerWidth));
        const maxTop = Math.max(0, window.innerHeight - 54);
        panel.style.left = Math.max(0, Math.min(left, maxLeft)) + 'px';
        panel.style.top = Math.max(0, Math.min(top, maxTop)) + 'px';
        panel.style.right = 'auto';
        if (width) panel.style.width = Math.min(width, window.innerWidth) + 'px';
        if (height) panel.style.height = Math.min(height, window.innerHeight) + 'px';
    }

    function savePanelRect() {
        if (panel.classList.contains('maximized') || panel.classList.contains('minimized')) return;
        const rect = panel.getBoundingClientRect();
        writeSetting('panelRect', {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        });
    }

    function applySavedPanelRect() {
        const rect = readSetting('panelRect', null);
        if (!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return;
        requestAnimationFrame(function () {
            setPanelRect(rect.left, rect.top, 420, Math.round(window.innerHeight * 0.9));
        });
    }

    let drag = null;
    byId('dragHandle').addEventListener('pointerdown', function (event) {
        if (event.target.closest('button, input, label, .dy-settings-menu') || panel.classList.contains('maximized')) return;
        const rect = panel.getBoundingClientRect();
        drag = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
        };
        panel.classList.add('dragging');
        event.currentTarget.setPointerCapture(event.pointerId);
    });
    byId('dragHandle').addEventListener('pointermove', function (event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const rect = panel.getBoundingClientRect();
        setPanelRect(event.clientX - drag.offsetX, event.clientY - drag.offsetY, rect.width, rect.height);
    });
    byId('dragHandle').addEventListener('pointerup', function (event) {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag = null;
        panel.classList.remove('dragging');
        savePanelRect();
    });
    byId('dragHandle').addEventListener('pointercancel', function () {
        drag = null;
        panel.classList.remove('dragging');
    });

    if (typeof ResizeObserver === 'function') {
        const resizeObserver = new ResizeObserver(function () {
            clearTimeout(resizeObserver.saveTimer);
            resizeObserver.saveTimer = setTimeout(savePanelRect, 250);
        });
        resizeObserver.observe(panel);
    }

    window.addEventListener('resize', function () {
        const rect = panel.getBoundingClientRect();
        if (rect.right < 40 || rect.bottom < 40 || rect.left > window.innerWidth - 40 || rect.top > window.innerHeight - 40) {
            setPanelRect(12, 12, Math.min(rect.width, window.innerWidth - 24), Math.min(rect.height, window.innerHeight - 24));
        }
    });

    state.observer = new MutationObserver(function (mutations) {
        const relevant = mutations.some(function (mutation) {
            return Array.from(mutation.addedNodes).some(function (node) {
                return node.nodeType === Node.ELEMENT_NODE && !host.contains(node);
            });
        });
        if (relevant) scheduleScan();
    });
    state.observer.observe(document.body, { childList: true, subtree: true });

    let lastUrl = location.href;
    state.routeTimer = setInterval(function () {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            if (state.isRunning && !isManagePage()) stopRun(false, '页面已切换，抓取已暂停。', 'warn');
            setTimeout(function () {
                if (isManagePage()) {
                    scanLoadedCards({ silent: true });
                    setStatus('已进入内容管理，可开始完整抓取。', 'idle');
                } else {
                    setStatus('请进入「内容管理 → 作品」页面。', 'warn');
                }
            }, 700);
        }
    }, 1200);

    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('打开熊猫抖音抓取器', showPanel);
        GM_registerMenuCommand('扫描当前已加载作品', function () {
            showPanel();
            scanLoadedCards();
        });
    }

    setTimeout(function () {
        if (isManagePage()) {
            const result = scanLoadedCards({ silent: true });
            if (result.visible > 0) {
                setStatus('已识别当前加载的 ' + state.items.length + ' 条；点击“开始完整抓取”加载全部。', 'idle');
            } else {
                setStatus('页面已打开，正在等待作品列表加载…', 'idle');
                setTimeout(function () {
                    const retry = scanLoadedCards({ silent: true });
                    if (retry.visible === 0) {
                        setStatus('未识别到作品卡片，请确认选择了「作品」标签页。', 'warn');
                    }
                }, 1800);
            }
        } else {
            setStatus('请进入「内容管理 → 作品」页面。', 'warn');
        }
        render();
    }, 650);

    console.info('[熊猫抖音抓取器] V' + VERSION + ' 已加载。');
})();
