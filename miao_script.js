// ==UserScript==
// @name         喵喵日志·周志自动填写助手
// @namespace    https://m.xybsyw.com/
// @version      1.0.0
// @description  校友邦日报/周志自动填写脚本
// @author       iami233
// @homepage     https://github.com/5ime/miaomiao-script
// @supportURL   https://github.com/5ime/miaomiao-script/issues
// @license      GPL-3.0
// @match        https://m.xybsyw.com/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  const MODES = {
    daily: {
      logTag: '喵喵日志助手',
      listUrl: 'https://m.xybsyw.com/personal/#/dailyJournal',
      startTime: '2026-01-01',
      endTime: '2026-12-31',
      uploadCount: 3,
      runningFlagKey: '__xyb_daily_journal_running__',
      unsavedDialogSnippet: '你上次有未保存的日志内容，是否继续填写？',
      localFetchLabel: '本地日志文本'
    },
    weekly: {
      logTag: '喵喵周志助手',
      listUrl: 'https://m.xybsyw.com/personal/#/weeklyJounal',
      startWeek: 1,
      endWeek: 5,
      uploadCount: 3,
      runningFlagKey: '__xyb_weekly_journal_running__',
      unsavedDialogSnippet: '你上次有未保存的周志内容，是否继续填写？',
      localFetchLabel: '本地周志文本'
    }
  };

  const BASE_CONFIG = {
    localTextBaseUrl: 'http://127.0.0.1/',
    waitTimeout: 20000,
    waitInterval: 300,
    retryCount: 3,
    finalAction: 'draft'
  };

  /** @returns {'提交' | '保存草稿箱'} */
  function resolveFinalButtonLabel(cfg) {
    const v = String(cfg.finalAction != null ? cfg.finalAction : 'draft')
      .trim()
      .toLowerCase();
    if (v === 'submit') return '提交';
    if (v === 'draft') return '保存草稿箱';
    console.warn('[喵喵助手] finalAction 仅支持 draft、submit，已按 draft 处理：', cfg.finalAction);
    return '保存草稿箱';
  }

  const modeState = {
    daily: { successCount: 0 },
    weekly: { successCount: 0 }
  };

  function getModeConfig(mode) {
    return { ...BASE_CONFIG, ...MODES[mode] };
  }

  function parseConfigDate(s) {
    if (!s || typeof s !== 'string') return null;
    const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    const d = Number(m[3]);
    const dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  function formatDateYMD(d) {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${mo}-${day}`;
  }

  function inclusiveDaySpan(start, end) {
    const dayMs = 24 * 60 * 60 * 1000;
    const a = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const b = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.floor((b - a) / dayMs) + 1;
  }

  function resolveDailyUploadTarget(cfg) {
    const n = Number(cfg.uploadCount);
    if (!Number.isFinite(n) || n < 1) throw new Error('日志 uploadCount 无效');
    const start = parseConfigDate(cfg.startTime);
    const end = parseConfigDate(cfg.endTime);
    if (!start || !end) return n;
    if (start > end) {
      console.warn(`[${cfg.logTag}] startTime > endTime，忽略范围仅按 uploadCount=${n}`);
      return n;
    }
    const span = inclusiveDaySpan(start, end);
    const target = Math.min(n, span);
    if (target < n) {
      console.log(
        `[${cfg.logTag}] 日期范围 ${cfg.startTime}–${cfg.endTime} 共 ${span} 天，本次上传篇数由 ${n} 收敛为 ${target}`
      );
    }
    return target;
  }

  function resolveDailyDateStr(cfg, fileIndex) {
    const start = parseConfigDate(cfg.startTime);
    if (!start) throw new Error('日志 startTime 无效，请使用 YYYY-MM-DD');
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    d.setDate(d.getDate() + (fileIndex - 1));
    const ds = formatDateYMD(d);
    const end = parseConfigDate(cfg.endTime);
    if (end) {
      const cur = parseConfigDate(ds);
      if (cur && cur > end) {
        throw new Error(`第 ${fileIndex} 篇对应日期 ${ds}，已超过结束日期 ${cfg.endTime}`);
      }
    }
    return ds;
  }

  function resolveWeeklyUploadTarget(cfg) {
    const start = Number(cfg.startWeek);
    const end = Number(cfg.endWeek);
    const n = Number(cfg.uploadCount);
    if (!Number.isFinite(n) || n < 1) throw new Error('周志 uploadCount 无效');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return n;
    if (start > end) {
      console.warn(`[${cfg.logTag}] startWeek(${start}) > endWeek(${end})，忽略范围仅按 uploadCount=${n}`);
      return n;
    }
    const span = end - start + 1;
    const target = Math.min(n, span);
    if (target < n) {
      console.log(`[${cfg.logTag}] 周次范围 ${start}–${end} 共 ${span} 周，本次上传篇数由 ${n} 收敛为 ${target}`);
    }
    return target;
  }

  function resolveWeeklyWeekNum(cfg, fileIndex) {
    const start = Number(cfg.startWeek);
    const end = Number(cfg.endWeek);
    const weekNum = Number.isFinite(start) ? start + (fileIndex - 1) : fileIndex;
    if (Number.isFinite(start) && Number.isFinite(end) && weekNum > end) {
      throw new Error(`第 ${fileIndex} 篇对应第 ${weekNum} 周，已超过结束周次 ${end}`);
    }
    return weekNum;
  }

  function makeLoggers(tag) {
    return {
      log: (...args) => console.log(`[${tag}]`, ...args),
      warn: (...args) => console.warn(`[${tag}]`, ...args),
      error: (...args) => console.error(`[${tag}]`, ...args)
    };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForElement(selector, options = {}) {
    const {
      timeout = BASE_CONFIG.waitTimeout,
      interval = BASE_CONFIG.waitInterval,
      root = document,
      visible = false
    } = options;

    const start = Date.now();

    while (Date.now() - start < timeout) {
      const el = root.querySelector(selector);
      if (el) {
        if (!visible) return el;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0) {
          return el;
        }
      }
      await sleep(interval);
    }

    throw new Error(`等待元素超时：${selector}`);
  }

  async function waitForCondition(predicate, options = {}) {
    const {
      timeout = BASE_CONFIG.waitTimeout,
      interval = BASE_CONFIG.waitInterval
    } = options;

    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const result = predicate();
        if (result) return result;
      } catch {
      }
      await sleep(interval);
    }
    throw new Error('等待条件超时');
  }

  function clickElement(el) {
    if (!el) return false;

    try {
      if (typeof el.click === 'function') {
        el.click();
        return true;
      }
    } catch (e) {
      console.log('[喵喵助手] 原生 click() 失败，改用事件模拟：', e);
    }

    try {
      const evtInit = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };

      const downEvt = new MouseEvent('mousedown', evtInit);
      const upEvt = new MouseEvent('mouseup', evtInit);
      const clickEvt = new MouseEvent('click', evtInit);

      el.dispatchEvent(downEvt);
      el.dispatchEvent(upEvt);
      el.dispatchEvent(clickEvt);
      return true;
    } catch (e) {
      console.log('[喵喵助手] 事件模拟点击失败：', e);
      return false;
    }
  }

  function setNativeValue(el, value) {
    if (!el) return false;

    const tagName = (el.tagName || '').toUpperCase();
    const type = (el.type || '').toLowerCase();

    if (tagName === 'INPUT' && type === 'file') {
      console.log('[喵喵助手] 跳过 file input，不能程序化赋值');
      return false;
    }

    try {
      const proto = tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (valueSetter) {
        valueSetter.call(el, value);
      } else {
        el.value = value;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } catch (err) {
      console.error('[喵喵助手] setNativeValue 失败：', err);
      return false;
    }
  }

  function setContentEditableValue(el, text, warn) {
    if (!el) throw new Error('setContentEditableValue 参数为空');

    const t = String(text ?? '');

    el.focus();
    el.scrollIntoView({ block: 'center', inline: 'center' });

    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {
      warn('设置光标失败，继续写入正文：', e);
    }

    try {
      el.innerHTML = '<p><span data-slate-zero-width="z">\uFEFF</span></p>';
    } catch {
    }

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, t);
    } catch (e) {
      inserted = false;
    }

    if (!inserted) {
      try {
        el.innerHTML = `<p><span data-slate-leaf="true"><span>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span></span></p>`;
      } catch (e) {
        el.textContent = t;
      }
    }

    el.dispatchEvent(new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: t
    }));
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: t
    }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function fetchLocalText(url, log, label) {
    log(`开始请求${label}:`, url);

    return await new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) {
            resolve(res.responseText || '');
          } else {
            reject(new Error(`本地文本请求失败，状态码：${res.status}`));
          }
        },
        onerror: () => reject(new Error('本地文本请求网络错误')),
        ontimeout: () => reject(new Error('本地文本请求超时')),
        timeout: 15000
      });
    });
  }

  function parseTextDaily(text) {
    const source = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!source) throw new Error('本地文本为空');

    const titleMatch = source.match(/标题\s*[:：]\s*([^\n]+)/);
    const contentMatch = source.match(/内容\s*[:：]\s*([\s\S]*)$/);

    const title = titleMatch ? titleMatch[1].trim() : '';
    const content = contentMatch ? contentMatch[1].trim() : '';

    if (!title) throw new Error('未解析到标题');
    if (!content) throw new Error('未解析到内容');

    return { title, content };
  }

  function parseTextWeekly(text, weekNum) {
    const source = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!source) throw new Error('本地文本为空');

    const titleMatch = source.match(/标题\s*[:：]\s*([^\n]+)/);
    const contentMatch = source.match(/内容\s*[:：]\s*([\s\S]*)$/);

    const title = titleMatch ? titleMatch[1].trim() : '';
    const content = contentMatch ? contentMatch[1].trim() : '';

    const n = Number(weekNum);
    if (!Number.isFinite(n) || n < 1) throw new Error(`目标周次无效：${weekNum}`);
    const week = `第${n}周`;

    if (!title) throw new Error('未解析到标题');
    if (!content) throw new Error('未解析到内容');

    return { title, week, content };
  }

  async function waitPageReady() {
    await waitForCondition(() => document.readyState === 'complete', {
      timeout: 15000,
      interval: 200
    });
    await sleep(800);
  }

  function installUrlChangeListener(callback) {
    const wrapHistoryMethod = (methodName) => {
      const original = history[methodName];
      history[methodName] = function (...args) {
        const ret = original.apply(this, args);
        window.dispatchEvent(new Event('urlchange'));
        return ret;
      };
    };

    wrapHistoryMethod('pushState');
    wrapHistoryMethod('replaceState');
    window.addEventListener('popstate', () => window.dispatchEvent(new Event('urlchange')));
    window.addEventListener('urlchange', callback);
  }

  function isEditJournalPage() {
    return location.href.includes('/personal/#/editJournal');
  }

  async function handleUnsavedDialog(cfg, log) {
    const candidates = Array.from(document.querySelectorAll('button, div, span, a'));

    const dialogExists = candidates.some((el) => (el.innerText || el.textContent || '').includes(cfg.unsavedDialogSnippet));
    if (!dialogExists) {
      log('未检测到未保存弹窗，继续执行后续流程');
      return false;
    }

    log('检测到未保存弹窗，尝试点击“重新填写”');
    const btn = candidates.find((el) => (el.innerText || el.textContent || '').trim() === '重新填写');
    if (!btn) throw new Error('检测到弹窗但未找到“重新填写”按钮');

    clickElement(btn);
    await sleep(1000);
    return true;
  }

  async function clickNewJournalButton(cfg, log) {
    log('寻找“新建”按钮...');
    const btn = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('div.text_link'));
      return nodes.find((el) => (el.innerText || el.textContent || '').trim() === '新建');
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    log('找到“新建”按钮，执行点击');
    if (!clickElement(btn)) {
      throw new Error('“新建”按钮点击失败');
    }
  }

  async function gotoListPage(cfg, log) {
    if (!location.href.startsWith(cfg.listUrl)) {
      log('跳转到列表页:', cfg.listUrl);
      location.href = cfg.listUrl;
      await waitForCondition(() => location.href.startsWith(cfg.listUrl), {
        timeout: 15000,
        interval: 200
      });
    }
  }

  async function fillDailyForm(cfg, state, log, warn, localTextUrl, dateStr) {
    const localText = await fetchLocalText(localTextUrl, log, cfg.localFetchLabel);
    const { title, content } = parseTextDaily(localText);
    log('解析成功:', { title, date: dateStr, contentLength: content.length });

    const titleInput = await waitForCondition(() => {
      const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      return candidates.find((el) => {
        const tagName = (el.tagName || '').toUpperCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const cls = (el.className || '').toString();
        const visible = (() => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })();

        if (!visible) return false;
        if (tagName === 'INPUT' && type === 'file') return false;

        return (
          placeholder === '请输入日志标题1-40字' ||
          placeholder.includes('日志标题') ||
          aria.includes('日志标题') ||
          cls.includes('el-input__inner')
        );
      });
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    log('填写标题');
    if (titleInput?.tagName === 'INPUT' || titleInput?.tagName === 'TEXTAREA') {
      if (!setNativeValue(titleInput, title)) {
        throw new Error('标题输入失败');
      }
    } else if (titleInput?.isContentEditable) {
      setContentEditableValue(titleInput, title, warn);
    } else {
      throw new Error('标题输入框类型不支持');
    }

    async function selectCycleDate(targetDateStr) {
      const target = new Date(targetDateStr);
      if (Number.isNaN(target.getTime())) throw new Error(`日期格式不正确：${targetDateStr}`);

      const targetYear = target.getFullYear();
      const targetMonth = target.getMonth() + 1;
      const targetDay = target.getDate();

      const getCalendar = () => document.querySelector('.cc-calendar.calendar');
      const getHeadText = () => getCalendar()?.querySelector('.calendar-headDate')?.textContent?.trim() || '';
      const parseHead = (text) => {
        const m1 = text.match(/(\d{1,4})\s*年\s*(\d{1,2})\s*月/);
        if (m1) return { year: Number(m1[1]), month: Number(m1[2]) };

        const m2 = text.match(/(\d{1,2})\s*月\s*(\d{1,4})/);
        if (m2) return { year: Number(m2[2]), month: Number(m2[1]) };

        return null;
      };

      const clickVisible = (selector) => {
        const el = Array.from(document.querySelectorAll(selector)).find((node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        if (el) {
          clickElement(el);
          return true;
        }
        return false;
      };

      for (let i = 0; i < 24; i++) {
        const head = parseHead(getHeadText());
        if (head && head.year === targetYear && head.month === targetMonth) break;

        const current = head ? new Date(head.year, head.month - 1, 1) : null;
        const targetMonthStart = new Date(targetYear, targetMonth - 1, 1);
        const goPrev = current ? current > targetMonthStart : false;

        if (goPrev) {
          if (!clickVisible('.el-date-picker__prev-btn, .calendar-prev')) throw new Error('找不到日历上一个月按钮');
        } else {
          if (!clickVisible('.el-date-picker__next-btn, .calendar-next')) throw new Error('找不到日历下一个月按钮');
        }
        await sleep(250);
      }

      const cal = getCalendar();
      if (!cal) throw new Error('日历弹层未出现');

      const popupRoot = cal.closest('div[style*="box-shadow"]') || cal.parentElement || cal;

      const dateNode = Array.from(cal.querySelectorAll('.date-view')).find((node) => {
        const dayEl = node.querySelector('.date-day');
        if (!dayEl) return false;
        const dayText = (dayEl.textContent || '').trim();
        if (Number(dayText) !== targetDay) return false;
        return !node.classList.contains('month-class') && !dayEl.classList.contains('opacity-class');
      });

      if (!dateNode) throw new Error(`未找到目标日期：${targetDateStr}`);
      clickElement(dateNode);
      await sleep(300);

      const confirmBtn = Array.from(popupRoot.querySelectorAll('span, div, button')).find((el) => {
        const text = (el.textContent || '').replace(/\s+/g, '').trim();
        return text === '确定';
      });
      if (!confirmBtn) throw new Error('未找到日历“确定”按钮');
      clickElement(confirmBtn);
      await sleep(300);

      const afterText = getHeadText();
      log('日历确认后当前月份：', afterText);
    }

    const cycleTrigger = await waitForCondition(() => {
      const icon = document.querySelector('span.day_icon');
      if (!icon) return null;
      const rect = icon.getBoundingClientRect();
      const style = window.getComputedStyle(icon);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' ? icon : null;
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    if (cycleTrigger) {
      log('点击 day_icon 打开日历');
      clickElement(cycleTrigger);
      await sleep(700);
      await selectCycleDate(dateStr);
    } else {
      log('未找到 day_icon，跳过关联周期');
    }

    const editor = await waitForCondition(() => {
      const el = document.querySelector('[data-w-e-textarea="true"] [contenteditable="true"][role="textarea"]')
        || document.querySelector('[data-w-e-textarea="true"] [contenteditable="true"]')
        || document.querySelector('#w-e-textarea-2[contenteditable="true"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' ? el : null;
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    log('填写正文内容');
    setContentEditableValue(editor, content, warn);

    log('设置阅读权限：仅老师和好友可见');
    const permissionTrigger = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('input[readonly="readonly"], input[readonly], div, button, span'));
      return nodes.find((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const placeholder = (el.getAttribute && el.getAttribute('placeholder')) ? el.getAttribute('placeholder') : '';
        return text.includes('阅读权限') || placeholder === '请选择';
      });
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(permissionTrigger);
    await sleep(500);

    const permissionOption = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('li, div, span, p'));
      return nodes.find((el) => (el.innerText || el.textContent || '').trim() === '仅老师和好友可见');
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(permissionOption);
    await sleep(500);

    const finalLabel = resolveFinalButtonLabel(cfg);
    log(`点击「${finalLabel}」`);
    const actionButton = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('button, div, span, a'));
      return nodes.find((el) => (el.innerText || el.textContent || '').trim() === finalLabel);
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(actionButton);

    log(`「${finalLabel}」操作已触发`);

    const successDetected = await waitForCondition(() => {
      const popup = Array.from(document.querySelectorAll('.submitResultPop'))
        .find((el) => (el.querySelector('.sRPT_title')?.textContent || '').trim() === '提交成功！');
      return popup || null;
    }, { timeout: 3500, interval: 120 }).catch(() => false);

    if (successDetected) {
      state.successCount += 1;
      log(`提交成功！当前成功了 ${state.successCount} 篇`);
      log(`本次计划上传总篇数：${cfg.__uploadTarget ?? cfg.uploadCount}`);
      if (state.successCount < (cfg.__uploadTarget ?? cfg.uploadCount)) {
        await sleep(3500);
        log('成功弹窗已确认，准备继续下一篇');
      }
    }
  }

  async function fillWeeklyForm(cfg, state, log, warn, localTextUrl, fileIndex, weekNum) {
    const localText = await fetchLocalText(localTextUrl, log, cfg.localFetchLabel);
    const { title, week, content } = parseTextWeekly(localText, weekNum);
    log('解析成功:', { title, week, weekNum, contentLength: content.length, fileIndex });

    const titleInput = await waitForCondition(() => {
      const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
      return candidates.find((el) => {
        const tagName = (el.tagName || '').toUpperCase();
        const type = (el.getAttribute('type') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').trim();
        const aria = (el.getAttribute('aria-label') || '').trim();
        const cls = (el.className || '').toString();
        const visible = (() => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })();

        if (!visible) return false;
        if (tagName === 'INPUT' && type === 'file') return false;

        return (
          placeholder === '请输入周志标题1-40字' ||
          placeholder.includes('周志标题') ||
          aria.includes('周志标题') ||
          cls.includes('el-input__inner')
        );
      });
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    log('填写标题');
    if (titleInput?.tagName === 'INPUT' || titleInput?.tagName === 'TEXTAREA') {
      if (!setNativeValue(titleInput, title)) {
        throw new Error('标题输入失败');
      }
    } else if (titleInput?.isContentEditable) {
      setContentEditableValue(titleInput, title, warn);
    } else {
      throw new Error('标题输入框类型不支持');
    }

    async function selectCycleWeek(targetWeek) {
      const weekIndex = Number(String(targetWeek).replace(/[^\d]/g, ''));
      if (!Number.isFinite(weekIndex) || weekIndex < 1) {
        throw new Error(`周次格式不正确：${targetWeek}`);
      }

      const getPopup = () => {
        const nodes = Array.from(document.querySelectorAll('div'));
        return nodes.find((node) => {
          const text = (node.textContent || '').replace(/\s+/g, '');
          return text.includes('提交要求：每周至少1篇') && text.includes('确定');
        }) || null;
      };

      const isVisible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };

      const findVisible = (root, selector, matcher) => {
        const nodes = Array.from((root || document).querySelectorAll(selector));
        return nodes.find((el) => isVisible(el) && matcher(el)) || null;
      };

      const parseYearMonth = (text) => {
        const normalized = String(text || '').replace(/\s+/g, '');
        const yearMatch = normalized.match(/(20\d{2})年/);
        const monthMatch = normalized.match(/(\d{1,2})月/);
        return {
          year: yearMatch ? Number(yearMatch[1]) : null,
          month: monthMatch ? Number(monthMatch[1]) : null
        };
      };

      const getSelectDisplayText = (trigger) => {
        if (!trigger) return '';
        const select = trigger.closest('.el-select') || trigger.parentElement?.closest('.el-select');
        if (!select) return '';
        const selected = select.querySelector('.el-select-dropdown__item.selected span');
        if (selected) return (selected.textContent || '').trim();
        const input = select.querySelector('input[readonly]');
        return (input?.value || input?.getAttribute('value') || input?.getAttribute('placeholder') || '').trim();
      };

      const getSelectTrigger = (popup, placeholderText) => {
        const input = Array.from(popup.querySelectorAll('input[readonly], input[readonly="readonly"]'))
          .find((el) => (el.getAttribute('placeholder') || '').trim() === placeholderText);
        if (input) return input;
        return findVisible(popup, '.el-select', (el) => {
          const text = (el.innerText || el.textContent || '').trim();
          return text.includes(placeholderText);
        });
      };

      const getCurrentYearMonth = (popup) => {
        const yearTrigger = getSelectTrigger(popup, '年份');
        const monthTrigger = getSelectTrigger(popup, '月份');
        const yearInfo = parseYearMonth(getSelectDisplayText(yearTrigger));
        const monthInfo = parseYearMonth(getSelectDisplayText(monthTrigger));
        return {
          year: yearInfo.year || new Date().getFullYear(),
          month: monthInfo.month || (new Date().getMonth() + 1),
          yearTrigger,
          monthTrigger
        };
      };

      const openAndChoose = async (trigger, optionText) => {
        if (!trigger) throw new Error(`未找到可点击控件：${optionText}`);
        clickElement(trigger);
        await sleep(300);
        const dropdown = await waitForCondition(() => {
          const pools = Array.from(document.querySelectorAll('.el-select-dropdown'));
          return pools.find((el) => isVisible(el)) || null;
        }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });
        const option = await waitForCondition(() => {
          const items = Array.from(dropdown.querySelectorAll('.el-select-dropdown__item'));
          return items.find((el) => {
            const text = (el.innerText || el.textContent || '').trim();
            return isVisible(el) && text === optionText;
          }) || null;
        }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });
        clickElement(option);
        await sleep(500);
      };

      const chooseYearMonth = async (popup, year, month) => {
        const yearTrigger = getSelectTrigger(popup, '年份');
        const monthTrigger = getSelectTrigger(popup, '月份');

        const yearText = `${year}年`;
        const monthText = `${month}月`;
        const currentYearText = getSelectDisplayText(yearTrigger);
        const currentMonthText = getSelectDisplayText(monthTrigger);

        if (currentYearText !== yearText) {
          log(`切换年份到 ${yearText}`);
          await openAndChoose(yearTrigger, yearText);
        }
        if (currentMonthText !== monthText) {
          log(`切换月份到 ${monthText}`);
          await openAndChoose(monthTrigger, monthText);
        }
      };

      const getWeekItems = (popup) => Array.from(popup.querySelectorAll('.data_item'))
        .filter((el) => isVisible(el));

      const findWeekItem = (popup, idx) => getWeekItems(popup)
        .find((el) => (el.innerText || el.textContent || '').includes(`第${idx}周`)) || null;

      const getMaxWeekInPopup = (popup) => getWeekItems(popup)
        .reduce((max, el) => {
          const match = (el.innerText || el.textContent || '').match(/第(\d+)周/);
          return match ? Math.max(max, Number(match[1])) : max;
        }, 0);

      const popup = await waitForCondition(() => getPopup(), {
        timeout: cfg.waitTimeout,
        interval: cfg.waitInterval
      });

      let current = getCurrentYearMonth(popup);
      const maxRounds = 24;

      for (let round = 0; round < maxRounds; round += 1) {
        const weekItem = findWeekItem(popup, weekIndex);
        if (weekItem) {
          log(`选择周次：第${weekIndex}周`);
          clickElement(weekItem);
          await sleep(300);

          const confirmBtn = await waitForCondition(() => {
            const nodes = Array.from(popup.querySelectorAll('span, div, button'));
            return nodes.find((el) => (el.textContent || '').replace(/\s+/g, '').trim() === '确定');
          }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });
          log('点击确定');
          clickElement(confirmBtn);
          await sleep(300);
          return;
        }

        const maxWeek = getMaxWeekInPopup(popup);
        const nextMonth = current.month === 12 ? 1 : current.month + 1;
        const nextYear = current.month === 12 ? current.year + 1 : current.year;

        if (maxWeek > 0 && weekIndex <= maxWeek) {
          throw new Error(`当前月份已显示第1-${maxWeek}周，但仍未找到第${weekIndex}周`);
        }

        log(`当前仅显示第1-${maxWeek || '?'}周，目标为第${weekIndex}周，切换到 ${nextYear}年${nextMonth}月`);
        await chooseYearMonth(popup, nextYear, nextMonth);
        current = { year: nextYear, month: nextMonth };
      }

      throw new Error(`连续切换 ${maxRounds} 次后仍未找到第${weekIndex}周`);
    }

    const cycleTrigger = await waitForCondition(() => {
      const icon = document.querySelector('span.day_icon');
      if (!icon) return null;
      const rect = icon.getBoundingClientRect();
      const style = window.getComputedStyle(icon);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' ? icon : null;
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    if (cycleTrigger) {
      log('点击 day_icon 打开周志选择器');
      clickElement(cycleTrigger);
      await sleep(700);
      await selectCycleWeek(week);
    } else {
      log('未找到 day_icon，跳过关联周次');
    }

    const editor = await waitForCondition(() => {
      const el = document.querySelector('[data-w-e-textarea="true"] [contenteditable="true"][role="textarea"]')
        || document.querySelector('[data-w-e-textarea="true"] [contenteditable="true"]')
        || document.querySelector('#w-e-textarea-1[contenteditable="true"]')
        || document.querySelector('#w-e-textarea-2[contenteditable="true"]')
        || document.querySelector('.w-e-text-container [contenteditable="true"]')
        || document.querySelector('[contenteditable="true"][data-slate-editor="true"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' ? el : null;
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    log('填写正文内容');
    try {
      editor.scrollIntoView({ block: 'center', inline: 'center' });
    } catch {
    }
    editor.focus();
    editor.click();
    await sleep(120);
    setContentEditableValue(editor, content, warn);

    log('设置阅读权限：仅老师和好友可见');
    const permissionTrigger = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('input[readonly="readonly"], input[readonly], div, button, span'));
      return nodes.find((el) => {
        const text = (el.innerText || el.textContent || '').trim();
        const placeholder = (el.getAttribute && el.getAttribute('placeholder')) ? el.getAttribute('placeholder') : '';
        return text.includes('阅读权限') || placeholder === '请选择';
      });
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(permissionTrigger);
    await sleep(500);

    const permissionOption = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('li, div, span, p'));
      return nodes.find((el) => (el.innerText || el.textContent || '').trim() === '仅老师和好友可见');
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(permissionOption);
    await sleep(500);

    const finalLabel = resolveFinalButtonLabel(cfg);
    log(`点击「${finalLabel}」`);
    const actionButton = await waitForCondition(() => {
      const nodes = Array.from(document.querySelectorAll('button, div, span, a'));
      return nodes.find((el) => (el.innerText || el.textContent || '').trim() === finalLabel);
    }, { timeout: cfg.waitTimeout, interval: cfg.waitInterval });

    clickElement(actionButton);

    log(`「${finalLabel}」操作已触发`);

    const successDetected = await waitForCondition(() => {
      const popup = Array.from(document.querySelectorAll('.submitResultPop'))
        .find((el) => (el.querySelector('.sRPT_title')?.textContent || '').trim() === '提交成功！');
      return popup || null;
    }, { timeout: 3500, interval: 120 }).catch(() => false);

    if (successDetected) {
      state.successCount += 1;
      log(`提交成功！当前成功了 ${state.successCount} 篇`);
      log(`本次计划上传总篇数：${cfg.__uploadTarget ?? cfg.uploadCount}`);
      if (state.successCount < (cfg.__uploadTarget ?? cfg.uploadCount)) {
        await sleep(3500);
        log('成功弹窗已确认，准备继续下一篇');
      }
    }
  }

  async function runAutomation(mode) {
    const cfg = getModeConfig(mode);
    const { log, warn, error } = makeLoggers(cfg.logTag);
    const state = modeState[mode];

    if (window[cfg.runningFlagKey]) {
      warn('自动流程正在执行中，已忽略重复触发');
      return;
    }

    window[cfg.runningFlagKey] = true;

    try {
      log('自动流程开始');
      log(`末步按钮：${resolveFinalButtonLabel(cfg)}（finalAction: draft | submit）`);
      if (mode === 'daily' && !parseConfigDate(cfg.startTime)) {
        throw new Error('请配置 daily.startTime 为 YYYY-MM-DD（关联周期由配置推算）');
      }
      await gotoListPage(cfg, log);
      await waitPageReady();
      await clickNewJournalButton(cfg, log);

      await waitForCondition(() => isEditJournalPage(), {
        timeout: 20000,
        interval: 300
      });

      await waitPageReady();
      await sleep(1200);

      await handleUnsavedDialog(cfg, log);

      await sleep(1000);

      const uploadTarget =
        mode === 'weekly' ? resolveWeeklyUploadTarget(cfg) : resolveDailyUploadTarget(cfg);
      cfg.__uploadTarget = uploadTarget;

      if (mode === 'weekly') {
        log(
          `周志周次：第 ${cfg.startWeek}–${cfg.endWeek} 周；本次上传 ${uploadTarget} 篇（本地 txt 文件名与周次一致：第${cfg.startWeek}周→${cfg.startWeek}.txt，依此类推）`
        );
      }
      if (mode === 'daily') {
        log(
          `日志关联日期：${cfg.startTime} 起每天一篇至 ${cfg.endTime}；本次上传 ${uploadTarget} 篇（txt 内无需再写「时间：」）`
        );
      }

      while (state.successCount < uploadTarget) {
        const fileIndex = state.successCount + 1;
        const weekNum = mode === 'weekly' ? resolveWeeklyWeekNum(cfg, fileIndex) : null;
        const txtKey = mode === 'weekly' ? weekNum : fileIndex;
        const localTextUrl = `${cfg.localTextBaseUrl}${txtKey}.txt`;
        const dateStr = mode === 'daily' ? resolveDailyDateStr(cfg, fileIndex) : null;

        let lastErr = null;
        for (let i = 1; i <= cfg.retryCount; i++) {
          try {
            log(
              mode === 'weekly'
                ? `第 ${fileIndex} 篇 txt → 目标第 ${weekNum} 周，第 ${i}/${cfg.retryCount} 次尝试 → ${localTextUrl}`
                : mode === 'daily'
                  ? `第 ${fileIndex} 篇 txt → 关联日期 ${dateStr}，第 ${i}/${cfg.retryCount} 次尝试 → ${localTextUrl}`
                  : `第 ${fileIndex} 篇 txt，第 ${i}/${cfg.retryCount} 次尝试 → ${localTextUrl}`
            );
            if (mode === 'daily') {
              await fillDailyForm(cfg, state, log, warn, localTextUrl, dateStr);
            } else {
              await fillWeeklyForm(cfg, state, log, warn, localTextUrl, fileIndex, weekNum);
            }
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            warn(`第 ${i} 次填写失败：`, err);
            await sleep(1500);
          }
        }

        if (lastErr) throw lastErr;

        if (state.successCount < uploadTarget) {
          await sleep(500);
          await waitPageReady();
          await sleep(800);
          await clickNewJournalButton(cfg, log);
          await waitForCondition(() => isEditJournalPage(), {
            timeout: 20000,
            interval: 300
          });
          await waitPageReady();
          await sleep(1200);
          await handleUnsavedDialog(cfg, log);
          await sleep(1000);
        }
      }

      log('自动流程完成');
    } catch (err) {
      error('自动流程执行失败：', err);
      alert(`自动流程失败：\n${err?.message || err}`);
    } finally {
      window[cfg.runningFlagKey] = false;
    }
  }

  function installHotkey() {
    window.addEventListener('keydown', (e) => {
      try {
        if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;

        if (e.key === '1' || e.code === 'Digit1') {
          e.preventDefault();
          e.stopPropagation();
          console.log('[喵喵助手] Alt+1 → 日志');
          runAutomation('daily');
          return;
        }

        if (e.key === '2' || e.code === 'Digit2') {
          e.preventDefault();
          e.stopPropagation();
          console.log('[喵喵助手] Alt+2 → 周志');
          runAutomation('weekly');
        }
      } catch (err) {
        console.error('[喵喵助手] 快捷键处理异常：', err);
      }
    }, true);
  }

  function onUrlChanged() {
    try {
      console.log('[喵喵助手] URL 变化：', location.href);
      if (isEditJournalPage()) {
        console.log('[喵喵助手] 当前处于编辑页');
      }
    } catch (err) {
      console.error('[喵喵助手] URL 变化处理异常：', err);
    }
  }

  function init() {
    installHotkey();
    installUrlChangeListener(onUrlChanged);
    console.log('[喵喵助手] 已加载：Alt+1 日志 | Alt+2 周志');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
